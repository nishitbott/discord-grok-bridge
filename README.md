# Discord Grok Bridge

Next.js bridge that accepts the Discord `/grok` slash command, checks the caller has the AI role, and forwards the question to a wake endpoint (Discord Digest). The admin console shows bridge health, recent interactions, and hashed API keys.

## Architecture

1. Discord sends every interaction to `POST /api/interactions`.
2. The route verifies the Ed25519 signature (`x-signature-ed25519` over `timestamp + raw body`) with `DISCORD_PUBLIC_KEY` and `tweetnacl`. Missing or invalid signatures return **401**. The raw body is read before JSON parsing.
3. A PING (`type: 1`) responds with `{ "type": 1 }`.
4. An `APPLICATION_COMMAND` named `grok` checks `member.roles` for `AI_ROLE_ID` (default `1555107644518301717`).
   - No role: ephemeral reply (`type: 4`, `flags: 64`) saying `You need the ai role to use /grok.`, and the interaction is stored as `rejected`.
   - Has the role: the route returns `{ "type": 5 }` immediately (public defer, no flags). The wake call runs in `after()` so Discord gets the ack inside the 3 second window.
5. The forwarder `POST`s the payload below to `DISCORD_WAKE_URL` with `Authorization: Bearer <DISCORD_WAKE_KEY>` and `X-Automation-Key: <DISCORD_WAKE_KEY>`. A non-2xx response or a network error is retried once after about 1.5 seconds. Each attempt is stored as `ok`, `retrying`, or `failed`, and the interaction `wake_status` is updated to match.
6. If both attempts fail, the bridge `PATCH`es `https://discord.com/api/v10/webhooks/{application_id}/{interaction_token}/messages/@original` with `Couldn't reach Grok, try again in a minute.`
7. Interaction records live in a Redis list capped at 200 (`LPUSH` + `LTRIM`) and a hash keyed by interaction id so later attempts can update the same row. The interaction token is sent to the wake endpoint and used for the failure `PATCH`. It is not written to Redis. The wake key is never stored.

`/api/interactions` is public so Discord can call it. Every other page is behind the admin cookie. Middleware redirects anonymous requests to `/login`. The login action compares the submitted key to `ADMIN_KEY` with a timing-safe compare and sets an `httpOnly`, `secure`, `sameSite=lax` cookie containing `sha256(ADMIN_KEY)`.

Discord Digest replies itself. It uses `application_id` and `interaction_token` from the wake payload to `PATCH` the original deferred message inside Discord's **15 minute** interaction token window. This bridge does not wait for that answer.

## Payload contract

`POST` body:

```json
{
  "source": "slash",
  "command": "grok",
  "question": "What changed in the deploy?",
  "user_id": "user snowflake",
  "username": "display name from member.user",
  "channel_id": "channel snowflake",
  "guild_id": "guild snowflake",
  "has_ai_role": true,
  "application_id": "application snowflake",
  "interaction_token": "discord interaction token",
  "interaction_id": "interaction snowflake",
  "received_at": "2026-10-09T19:33:00.000Z"
}
```

`user_id` and `username` come from `member.user`. `received_at` is UTC ISO-8601.

Headers:

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `Authorization` | `Bearer ${DISCORD_WAKE_KEY}` |
| `X-Automation-Key` | `${DISCORD_WAKE_KEY}` |

## Environment variables

Copy `.env.example` to `.env.local`. Placeholders only; do not commit real values.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DISCORD_PUBLIC_KEY` | Runtime | Ed25519 public key from the Discord application. |
| `DISCORD_APPLICATION_ID` | Runtime and register | Application id. Also used if a payload omits `application_id`. |
| `DISCORD_BOT_TOKEN` | Register only | `Authorization: Bot …` when registering `/grok`. |
| `DISCORD_GUILD_ID` | Register | Guild to register the command in. Defaults to `1141656332609527838`. |
| `AI_ROLE_ID` | Optional | Role allowed to run `/grok`. Defaults to `1555107644518301717`. |
| `DISCORD_WAKE_URL` | Runtime | Wake endpoint (Discord Digest). |
| `DISCORD_WAKE_KEY` | Runtime | Bearer token and `X-Automation-Key`. |
| `ADMIN_KEY` | Console | Password for `/login`. The cookie stores its SHA-256, not the key. |
| `UPSTASH_REDIS_REST_URL` | Optional | Upstash REST URL. |
| `UPSTASH_REDIS_REST_TOKEN` | Optional | Upstash REST token. |
| `KV_REST_API_URL` | Optional | Fallback URL if the Upstash names are unset. |
| `KV_REST_API_TOKEN` | Optional | Fallback token if the Upstash names are unset. |

The status page reports **Env OK** when the public key, application id, wake URL, wake key, and admin key are set. It lists every variable above as set or not set, and never renders the values.

Without Redis credentials the bridge still verifies, defers, and forwards. History and API keys no-op and return empty.

## Upstash (Vercel Marketplace)

1. In the Vercel project, open **Storage** (or **Integrations → Marketplace**) and add **Upstash Redis**.
2. Or from a linked project: `vercel integration add upstash`.
3. Connect the database to this project. Vercel injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
4. Redeploy so the functions pick up the variables.
5. If an older integration wrote `KV_REST_API_URL` and `KV_REST_API_TOKEN` instead, those names are used when the `UPSTASH_*` pair is absent.

The client is `@upstash/redis`. Interactions are a list capped at 200 plus a hash per interaction id. API keys store the SHA-256 hash, an 8-character prefix, name, `createdAt`, and `revoked`. The raw `dgb_` + 32-byte hex key is returned once from the create action and is not written to Redis.

## Discord Developer Portal

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and select (or create) the application.
2. **General Information**: copy the Application ID into `DISCORD_APPLICATION_ID` and the Public Key into `DISCORD_PUBLIC_KEY`.
3. **Bot**: reset the token into `DISCORD_BOT_TOKEN`. This token is only used by `npm run register`.
4. Invite the bot to the guild with the `bot` and `applications.commands` scopes.
5. Copy the guild id into `DISCORD_GUILD_ID` and the AI role id into `AI_ROLE_ID`.
6. Deploy this app, then set **Interactions Endpoint URL** to `https://<app>/api/interactions`. Discord sends a PING; a valid signature must get `{ "type": 1 }` or the URL will not save.

## Register `/grok`

With `.env.local` (or the variables already exported):

```bash
npm run register
```

That runs `scripts/register-commands.ts`, which loads `.env.local` when the file exists (`process.loadEnvFile`) and `PUT`s the guild command:

```json
[
  {
    "name": "grok",
    "description": "Ask Grok",
    "type": 1,
    "options": [
      {
        "type": 3,
        "name": "question",
        "description": "Your question",
        "required": true
      }
    ]
  }
]
```

`PUT https://discord.com/api/v10/applications/{DISCORD_APPLICATION_ID}/guilds/{DISCORD_GUILD_ID}/commands` with `Authorization: Bot ${DISCORD_BOT_TOKEN}`.

## Vercel deploy

1. Import this repository as a Next.js project (App Router, Node.js runtime).
2. Add the environment variables from the table. Use the Marketplace integration for Upstash rather than pasting tokens into git.
3. Deploy.
4. Set the Discord Interactions Endpoint URL to `https://<deployment-domain>/api/interactions`.
5. Run `npm run register` from a machine that has the bot token and application id.

## Local development

```bash
cp .env.example .env.local
npm run dev
```

Open `/login` and sign in with `ADMIN_KEY`. `/` is the status page. `/settings` creates and revokes API keys.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint (Next.js core web vitals + TypeScript) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run register` | Register the guild `/grok` command |
