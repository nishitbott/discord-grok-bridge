# Discord Mention Bridge

A Discord @mention bridge. An always-on listener on Railway watches the guild gateway. When a qualified mention or reply arrives, it shows a typing indicator and wakes Discord Digest. Discord Digest posts the reply in the channel itself. The listener never sends message text. A Next.js dashboard on Vercel stores listener heartbeats, mention events, and hashed API keys.

## Architecture

```
Discord Gateway
  -> mention listener (Railway, discord.js)
      -> POST Discord Digest wake webhook
          -> Discord Digest replies in the channel
      -> POST dashboard /api/ingest/heartbeat and /api/ingest/events (Vercel)
```

The dashboard does not talk to Discord. It checks an admin cookie for the console and a Bearer API key for ingest. `/api/ingest/*` is public to the cookie middleware and rejected with **401** unless the bearer token hashes to a non-revoked key.

## Qualification

A message is qualified only when every condition is true:

1. The bot user is @mentioned, or the message is a reply whose referenced message author id is the bot id.
2. The author is not a bot.
3. The author's guild member roles include `AI_ROLE_ID` (default `1555107644518301717`). The listener fetches the member when it is not cached.
4. Text is non-empty after removing `<@BOTID>` and `<@!BOTID>` tokens and trimming.

`BOT_USER_ID` defaults to `1555106101828259891`. When that env var is unset, the listener uses the logged-in bot id, then the default. `DISCORD_GUILD_ID` defaults to `1141656332609527838`. Messages outside that guild are ignored.

On qualify the listener calls `sendTyping` in the channel and does not post a message. It then wakes Discord Digest once.

## Wake payload

`POST` to `DISCORD_WAKE_URL` (alias `BRIDGE_WAKE_URL`) with:

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `Authorization` | `Bearer ${DISCORD_WAKE_KEY}` |
| `X-Automation-Key` | `${DISCORD_WAKE_KEY}` |

`DISCORD_WAKE_KEY` accepts `BRIDGE_WAKE_KEY` as an alias. The key is never written to the dashboard or to logs.

Body:

```json
{
  "message_id": "message snowflake",
  "channel_id": "channel snowflake",
  "guild_id": "guild snowflake",
  "author_id": "author snowflake",
  "author": "username",
  "text": "message text with the bot mention removed",
  "ts": "2026-10-10T07:30:00.000Z",
  "has_ai_role": true
}
```

`author` is the Discord username. `ts` is the message `createdAt` in UTC ISO-8601. `has_ai_role` is always `true` because unqualified authors are not woken.

When the message is a reply to the bot, the body also includes:

```json
{
  "is_reply_to_bot": true,
  "replied_to_message_id": "referenced message snowflake",
  "replied_to_content": "first 1500 characters of the referenced message"
}
```

When the message was found by backfill, the body also includes `"backfill": true`.

## Retry, queue, dedupe, backfill, watchdog

**Immediate retry.** A wake is retried once after 2 seconds on HTTP 400, 429, 5xx, or a network error. The listener logs the response body with the wake key, wake URL, bot token, and dashboard credentials redacted. Other secrets are not logged.

**Queue.** If the wake is still failing, it is appended to `DATA_DIR/pending.jsonl` (default `./data/pending.jsonl`). The file is drained every 60 seconds with exponential backoff (60s, 120s, … capped at 30 minutes). After about 10 POST attempts the item is marked failed and left in the file. Dashboard reporting failures never crash the process.

**Dedupe.** Woken message ids are stored in `DATA_DIR/woken.json`, capped at about 5000. A message id is never woken twice. Queue drains are retries of the same wake, not a second wake.

**Last seen.** Every message seen in the guild updates `DATA_DIR/last_seen.json` with the newest message id for that channel.

**Backfill.** On ready, and again on reconnect or resume, the listener walks each text and announcement channel in the guild. A channel with no `last_seen` entry only stores the latest message id and does not replay history. A channel with `last_seen` fetches messages after that id, not older than 24 hours (snowflake floor) and not more than 500 messages, oldest first. Those messages use the same qualification, dedupe, and typing behavior, and the wake body sets `backfill` to `true`.

**Watchdog.** Every 30 seconds the listener reads `client.ws.ping` and the shard heartbeat ACK (`lastPingTimestamp`) plus ready/resume activity. If there has been no ACK or ready activity for more than 90 seconds, or the socket stays disconnected / reconnecting and looks zombie, the client is destroyed and logs in again.

## Dashboard ingest

Every 30 seconds, and once when the gateway becomes ready, the listener posts:

`POST ${DASHBOARD_URL}/api/ingest/heartbeat`

```json
{
  "uptime_s": 120,
  "ws_ping": 42,
  "guilds": 1,
  "queue_depth": 0,
  "version": "0.1.0",
  "ts": "2026-10-10T07:30:00.000Z"
}
```

`POST ${DASHBOARD_URL}/api/ingest/events` with batches:

```json
{
  "events": [
    {
      "type": "mention",
      "message_id": "snowflake",
      "channel_id": "snowflake",
      "author": "username",
      "text_preview": "up to 120 characters",
      "wake_status": "ok",
      "http_status": 200,
      "attempts": 1,
      "ts": "2026-10-10T07:30:00.000Z"
    }
  ]
}
```

`type` is `mention`, `wake`, `error`, `backfill`, or `reconnect`. `wake_status` is `ok`, `retrying`, `failed`, or `queued`. Optional fields are omitted when they do not apply. The auth header is `Authorization: Bearer ${LISTENER_API_KEY}`.

The dashboard hashes that key with SHA-256 and loads `dgb:api-key:<hash>`. Missing, unknown, and revoked keys return **401**. A match updates `lastUsedAt`. The latest heartbeat is stored with the time it was received. Events are an Upstash list capped at 500. The status page treats the listener as online when that heartbeat is less than 90 seconds old.

## Deploy the dashboard on Vercel

1. Import this repository as a Next.js App Router project. The `listener/` directory is excluded from the Next build, TypeScript project, and root ESLint run.
2. Set `ADMIN_KEY` in the Vercel project environment.
3. Add **Upstash Redis** from the Vercel Marketplace (**Storage** or **Integrations → Marketplace**, or `vercel integration add upstash` on a linked project) and connect it to this project. Vercel injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. If an older integration wrote `KV_REST_API_URL` and `KV_REST_API_TOKEN` instead, those names are used when the `UPSTASH_*` pair is absent.
4. Redeploy so the functions see the variables.
5. Open `/login`, sign in with `ADMIN_KEY`, and create a listener key on `/settings`. The raw `dgb_` key is shown once. It is not stored; Redis keeps the SHA-256 hash, an 8-character prefix, the name, `createdAt`, `lastUsedAt`, and `revoked`.

Without Redis the console still loads. Heartbeats, events, and API keys are empty, and ingest returns **401**.

The status page shows listener online/offline, last heartbeat time, websocket ping, and queue depth, plus the 20 most recent mentions and a wake-status badge. Configuration checks are booleans only (`ADMIN_KEY` and the Upstash variable names). Listener secrets are not part of the Vercel project.

## Deploy the listener on Railway

The listener is its own Node package in `listener/`. Railway should use that directory as the service root.

1. Create a Railway service from this repo with **root directory** `listener/`.
2. `listener/railway.json` selects the Dockerfile builder (`dockerfilePath`: `Dockerfile`) and restart policy `ALWAYS`.
3. The image is a multi-stage `node:20-alpine` build: `npm ci`, `tsc`, `npm prune --omit=dev`, then `node dist/index.js`.
4. Add a volume mounted at `/app/data`. The image declares `VOLUME /app/data` and defaults `DATA_DIR` to that path. The queue, dedupe set, and last-seen map live on the volume so restarts do not wake the same messages twice or lose pending retries.
5. Set:

| Variable | Purpose |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Bot token from the Discord Developer Portal |
| `BOT_USER_ID` | Optional. Default `1555106101828259891`, otherwise the logged-in bot id |
| `AI_ROLE_ID` | Optional. Default `1555107644518301717` |
| `DISCORD_GUILD_ID` | Optional. Default `1141656332609527838` |
| `DISCORD_WAKE_URL` | Discord Digest wake URL (`BRIDGE_WAKE_URL` alias) |
| `DISCORD_WAKE_KEY` | Wake bearer token (`BRIDGE_WAKE_KEY` alias) |
| `DASHBOARD_URL` | Vercel origin, no path, such as `https://your-app.vercel.app` |
| `LISTENER_API_KEY` | Raw key created on `/settings` |
| `DATA_DIR` | Optional. Default `./data`; use `/app/data` on Railway |

Copy `listener/.env.example`. Placeholders only; do not commit real values.

### Fly.io

From `listener/`, a Docker Machine can run the same image. Create a persistent volume and mount it at `/app/data`. Set the same environment variables. No public HTTP port is required; this is a worker process.

```toml
[mounts]
  source = "listener_data"
  destination = "/app/data"
```

### Render

Create a **Background Worker** using the `listener/` Dockerfile. Add a persistent disk mounted at `/app/data` and set the same environment variables. The worker does not need a public URL.

## Discord Developer Portal

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and select the application.
2. **Bot**: reset the token into `DISCORD_BOT_TOKEN` on Railway.
3. **Privileged Gateway Intents**: enable **Message Content Intent** and **Server Members Intent**. Both are required. Without them the listener cannot read mention text or role membership.
4. **Interactions Endpoint URL**: clear it and save. This bridge does not receive slash-command interactions. Leaving the old `/api/interactions` URL in place makes Discord keep posting to a route that no longer exists.
5. Invite the bot with the `bot` scope and permission integer **68608**:

```
https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&permissions=68608&scope=bot
```

That integer is View Channels (`1024`) + Send Messages (`2048`) + Read Message History (`65536`). Send Messages is what allows the typing indicator. The listener still never posts message content.

6. Create the listener API key in the dashboard `/settings` page and set `LISTENER_API_KEY` on the listener host.

## Local development

Dashboard:

```bash
cp .env.example .env.local
npm run dev
```

Open `/login` and sign in with `ADMIN_KEY`. `/` is the status page. `/settings` creates and revokes API keys.

Listener (Node.js 20+):

```bash
cd listener
cp .env.example .env
npm install
npm run build
node --env-file=.env dist/index.js
```

`npm start` runs `node dist/index.js` and expects the environment to already be injected, which is how Railway, Fly, and Render run it.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` | Production dashboard build |
| `npm run lint` | ESLint for the dashboard (ignores `listener/`) |
| `npm run typecheck` | `tsc --noEmit` for the dashboard |
| `cd listener && npm run build` | Compile the listener to `listener/dist` |
| `cd listener && npm start` | Run `node dist/index.js` |
| `cd listener && npm run lint` | ESLint for the listener |
