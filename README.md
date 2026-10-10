# Discord Mention Bridge

A Discord @mention bridge. The primary listener is the Next.js app on Vercel: a Fluid Compute function holds one Discord gateway session for about 285 seconds, then starts the next session. When a qualified mention or reply arrives, it shows a typing indicator and wakes Discord Digest. Discord Digest posts the reply in the channel itself. The listener never sends message text.

`listener/` is the always-on alternative for Railway, Fly, or Render. It is the same qualify, wake, dedupe, and backfill behavior, with state on a disk volume and heartbeats posted over HTTP.

## Architecture

```
Discord Gateway
  -> Vercel /api/gateway/run (discord.js, ~285s window, self-chain)
      -> POST Discord Digest wake webhook
          -> Discord Digest replies in the channel
      -> Upstash Redis (heartbeat, events, woken ids, last_seen, retry queue, lock)

Daily cron or the dashboard "Start gateway now" button
  -> GET/POST /api/gateway/run   (kickstart if the chain has stopped)

Alternative:
Discord Gateway
  -> listener/ on Railway, Fly, or Render
      -> POST Discord Digest wake webhook
      -> POST dashboard /api/ingest/heartbeat and /api/ingest/events
```

The dashboard checks an admin cookie for the console. `/api/gateway/*` skips that cookie check and requires `Authorization: Bearer ${CRON_SECRET}`. `/api/ingest/*` also skips the cookie check and returns **401** unless the bearer token hashes to a non-revoked API key. The Vercel gateway does not call ingest. It writes the same Redis keys the dashboard already reads.

## Vercel gateway windows

Hobby plan limits:

- Fluid Compute is the default Node.js runtime. `vercel.json` sets `"fluid": true`.
- A function may run at most **300 seconds**. This route exports `maxDuration = 300` and `vercel.json` repeats that for `app/api/gateway/run/route.ts`.
- Cron jobs may run **at most once per day**. The schedule is `0 0 * * *` (00:00 UTC). Hobby cron can land up to about **59 minutes** off that minute.

Each invocation:

1. Requires the cron bearer token. Anything else is **401**.
2. Takes a Redis lock with `SET key runId NX PX 300000`. If that lock is still held, the route returns **200** `{ "skipped": true }` and does not open a second gateway session.
3. Connects a discord.js client (Guilds, Guild Messages, Message Content, Guild Members). On ready it backfills, then handles live `messageCreate` the same way `listener/` does, drains the Redis retry list, and writes a heartbeat every 30 seconds with `source: "vercel"`.
4. Stays connected for about **285 seconds**, destroys the client, releases the lock, and returns `{ processed, woken, backfilled, duration }`. `duration` is milliseconds. `processed` counts guild messages handled in the window. `woken` counts wake calls that returned success. `backfilled` counts historical messages replayed.
5. Before that response, `after()` from `next/server` fetches `/api/gateway/run` again with the same bearer token. The kickoff aborts after about **5 seconds** so this invocation can finish. The chained request sends `x-gateway-detach: 1`, answers `{ "accepted": true }` as soon as the session is scheduled, and keeps the new window alive with `after()`. Closing the kickoff does not cancel that window. The daily cron is detected from `x-vercel-cron` or a `vercel-cron` user agent and uses that same detached start, so a short cron HTTP timeout cannot cut the first window off. A direct call without the detach header waits for the window and returns the summary. `GATEWAY_SELF_CHAIN` defaults to `true`. Set it to `false`, `0`, `off`, or `no` to stop after the current window.

The handoff leaves a gap of a few seconds while the old socket closes and the new one identifies. Ready-time backfill plus the woken-id set covers mentions that arrive in that gap. Backfill walks each text and announcement channel, at most **24 hours** and **500 messages** per channel. A channel with no `last_seen` only stores the newest id and does not replay history. The next window continues from `last_seen`, so a backfill that hits the window deadline resumes later.

If the chain breaks (a deploy kills the function, login throws, or `GATEWAY_SELF_CHAIN` is off), nothing starts the next window until the daily cron or the dashboard button. The button is an admin server action. It calls `/api/gateway/run` with `CRON_SECRET` on the server. Backfill then covers up to 24 hours and 500 messages per channel. A crashed window can hold the lock until its 300 second TTL, and the button gets `{ "skipped": true }` until that expires.

**Cost.** A near-continuous chain means the function is running almost all day. That time counts against the Hobby included function duration and GB-hours (Fluid bills active CPU, provisioned memory, and invocations). The gateway will be most of this project's usage. If the allowance runs out, windows stop until the quota resets; the daily cron or the button starts them again, and backfill covers the gap. **Pro** allows 800 second windows and cron schedules down to once per minute, which can replace self-chaining if you would rather have the platform start each window. This repo stays at 300 seconds and a daily cron so a Hobby project can run it.

Railway, Fly, and Render remain the always-on alternative when you want one long-lived process instead of chained function windows.

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

## Retry, queue, dedupe, backfill

**Immediate retry.** A wake is retried once after 2 seconds on HTTP 400, 429, 5xx, or a network error. The listener logs the response body with the wake key, wake URL, bot token, and cron secret redacted.

**Queue.** If the wake is still failing, it is stored for a later retry. On Vercel that is the Redis list `dgb:gateway:retry`. On the Docker listener it is `DATA_DIR/pending.jsonl` (default `./data/pending.jsonl`). The queue is drained every 60 seconds with exponential backoff (60s, 120s, … capped at 30 minutes). After about 10 POST attempts the item is marked failed and left in place. A reporting failure does not crash the process.

**Dedupe.** A message id is never woken twice. Queue drains are retries of the same wake, not a second wake. On Vercel the ids are a Redis sorted set, `dgb:gateway:woken`. The score is the time the id was recorded. Ids older than 7 days are removed, the set is capped at about 5000, and the key itself expires after 7 days without writes. The Docker listener stores the same cap in `DATA_DIR/woken.json`.

**Last seen.** Every message seen in the guild updates the newest message id for that channel. On Vercel that is the hash `dgb:gateway:last_seen`. The Docker listener uses `DATA_DIR/last_seen.json`.

**Lock.** Only the Vercel gateway uses `dgb:gateway:lock`. The dashboard shows the holder (the run id) and when it expires.

**Backfill.** On ready, and again on resume, the listener walks each text and announcement channel in the guild. A channel with no `last_seen` entry only stores the latest message id and does not replay history. A channel with `last_seen` fetches messages after that id, not older than 24 hours (snowflake floor) and not more than 500 messages, oldest first. Those messages use the same qualification, dedupe, and typing behavior, and the wake body sets `backfill` to `true`.

**Watchdog.** The Docker listener checks the socket every 30 seconds and logs in again if the heartbeat ACK looks stale. The Vercel gateway does not. The window is short, and the next window's backfill covers a drop. The Docker process still has the watchdog.

## Dashboard

The Vercel gateway writes heartbeats and events straight to Redis:

- `dgb:listener:heartbeat`
- `dgb:listener:events` (capped at 500)

The Docker listener still posts those through HTTP every 30 seconds, and once when the gateway becomes ready.

`POST ${DASHBOARD_URL}/api/ingest/heartbeat`

```json
{
  "uptime_s": 120,
  "ws_ping": 42,
  "guilds": 1,
  "queue_depth": 0,
  "version": "0.1.0",
  "source": "railway",
  "ts": "2026-10-10T07:30:00.000Z"
}
```

`source` is `vercel` or `railway`. The Vercel gateway always sends `vercel`. The Docker listener sends `railway`. A heartbeat with no source is shown as `railway`.

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

`type` is `mention`, `wake`, `error`, `backfill`, or `reconnect`. `wake_status` is `ok`, `retrying`, `failed`, or `queued`. Optional fields are omitted when they do not apply. The ingest auth header is `Authorization: Bearer ${LISTENER_API_KEY}`.

The dashboard hashes that key with SHA-256 and loads `dgb:api-key:<hash>`. Missing, unknown, and revoked keys return **401**. A match updates `lastUsedAt`. The latest heartbeat is stored with the time it was received. The status page treats the listener as online when that heartbeat is less than 90 seconds old. It also shows the listener source, the lock holder, and the lock expiry.

Vercel cron sends `Authorization: Bearer ${CRON_SECRET}` when that env var is set. The gateway route checks it with a constant-time compare.

## Deploy on Vercel

This is the primary deploy. One project runs the dashboard and the gateway.

1. Import this repository as a Next.js App Router project. The `listener/` directory is excluded from the Next build, TypeScript project, and root ESLint run.
2. Set the variables below. Copy `.env.example`. Placeholders only. Do not commit real values.
3. Add **Upstash Redis** from the Vercel Marketplace (**Storage** or **Integrations → Marketplace**, or `vercel integration add upstash` on a linked project) and connect it to this project. Vercel injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. If an older integration wrote `KV_REST_API_URL` and `KV_REST_API_TOKEN` instead, those names are used when the `UPSTASH_*` pair is absent.
4. Redeploy so the functions see the variables. The daily cron is the safety net. Open the dashboard and use **Start gateway now** if you do not want to wait for it.
5. Open `/login`, sign in with `ADMIN_KEY`. `/settings` creates ingest keys for the Docker listener. The Vercel gateway does not use those keys.

| Variable | Purpose |
| --- | --- |
| `ADMIN_KEY` | Console password. The cookie stores `sha256(ADMIN_KEY)`. |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL. `KV_REST_API_URL` is the fallback. |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token. `KV_REST_API_TOKEN` is the fallback. |
| `DISCORD_BOT_TOKEN` | Bot token from the Discord Developer Portal. |
| `CRON_SECRET` | Bearer token for `/api/gateway/run`. Vercel cron sends it. The dashboard button sends it server-side. |
| `DISCORD_WAKE_URL` | Discord Digest wake URL. `BRIDGE_WAKE_URL` is an alias. |
| `DISCORD_WAKE_KEY` | Wake bearer token. `BRIDGE_WAKE_KEY` is an alias. |
| `BOT_USER_ID` | Optional. Default `1555106101828259891`, otherwise the logged-in bot id. |
| `AI_ROLE_ID` | Optional. Default `1555107644518301717`. |
| `DISCORD_GUILD_ID` | Optional. Default `1141656332609527838`. |
| `GATEWAY_SELF_CHAIN` | Optional. Default `true`. Set `false` to disable the next-window fetch. |
| `VERCEL_PROJECT_PRODUCTION_URL` | Set by Vercel. The self-chain uses `https://` plus this host. If it is absent, the route uses the incoming request origin. |

The status page configuration table is booleans only, including `DISCORD_BOT_TOKEN`, `CRON_SECRET`, `DISCORD_WAKE_URL`, `DISCORD_WAKE_KEY`, `BOT_USER_ID`, `AI_ROLE_ID`, `DISCORD_GUILD_ID`, `ADMIN_KEY`, and the Upstash names. `DISCORD_WAKE_URL` is shown as set when `BRIDGE_WAKE_URL` is set. The same applies to the wake key. Values are never rendered.

Without Redis the console still loads. Heartbeats, events, the lock, and API keys are empty. Ingest returns **401**. The gateway route returns **500** `{ "error": "store unavailable" }`.

`LISTENER_API_KEY` and `DASHBOARD_URL` are not required on Vercel. They belong to the Docker listener below.

## Deploy the listener on Railway, Fly, or Render

Use this when you want a single always-on process instead of chained Vercel windows. The listener is its own Node package in `listener/`. Point the host at that directory.

### Railway

1. Create a Railway service from this repo with **root directory** `listener/`.
2. `listener/railway.json` selects the Dockerfile builder (`dockerfilePath`: `Dockerfile`) and restart policy `ALWAYS`.
3. The image is a multi-stage `node:20-alpine` build: `npm ci`, `tsc`, `npm prune --omit=dev`, then `node dist/index.js`.
4. Add a volume mounted at `/app/data`. The image declares `VOLUME /app/data` and defaults `DATA_DIR` to that path. The queue, dedupe set, and last-seen map live on the volume so restarts do not wake the same messages twice or lose pending retries.
5. Set `DISCORD_BOT_TOKEN`, `DISCORD_WAKE_URL`, `DISCORD_WAKE_KEY`, `DASHBOARD_URL`, and `LISTENER_API_KEY`. Optional: `BOT_USER_ID`, `AI_ROLE_ID`, `DISCORD_GUILD_ID`, `DATA_DIR`. `BRIDGE_WAKE_URL` and `BRIDGE_WAKE_KEY` are accepted aliases. Copy `listener/.env.example`.

Do not run the Vercel gateway and this process against the same bot at the same time. Discord allows a small number of gateway sessions, and both would try to wake the same mentions. Their dedupe stores are separate (Redis vs the volume).

### Fly.io

From `listener/`, a Docker Machine can run the same image. Create a persistent volume and mount it at `/app/data`. Set the same environment variables. No public HTTP port is required. This is a worker process.

```toml
[mounts]
  source = "listener_data"
  destination = "/app/data"
```

### Render

Create a **Background Worker** using the `listener/` Dockerfile. Add a persistent disk mounted at `/app/data` and set the same environment variables. The worker does not need a public URL.

## Discord Developer Portal

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and select the application.
2. **Bot**: reset the token into `DISCORD_BOT_TOKEN` on the Vercel project (or on the Docker host, if that is what you run).
3. **Privileged Gateway Intents**: enable **Message Content Intent** and **Server Members Intent**. Both are required. Without them the listener cannot read mention text or role membership.
4. **Interactions Endpoint URL**: clear it and save. This bridge does not receive slash-command interactions. Leaving the old `/api/interactions` URL in place makes Discord keep posting to a route that no longer exists.
5. Invite the bot with the `bot` scope and permission integer **68608**:

```
https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&permissions=68608&scope=bot
```

That integer is View Channels (`1024`) + Send Messages (`2048`) + Read Message History (`65536`). Send Messages is what allows the typing indicator. The listener still never posts message content.

6. Create an API key on `/settings` only if you run the Docker listener. Put it in `LISTENER_API_KEY` on that host. The Vercel gateway writes Redis directly and does not send this key.

## Local development

Dashboard and Vercel gateway:

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `/login` and sign in with `ADMIN_KEY`. `/` is the status page. `/settings` creates and revokes API keys. **Start gateway now** calls the local route. You can also start a window with curl. It stays connected for about five minutes unless you send the detach header:

```bash
curl -H "Authorization: Bearer your-cron-secret" \
  -H "x-gateway-detach: 1" \
  http://localhost:3000/api/gateway/run
```

Docker listener (Node.js 20+):

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
| `npm run build` | Production dashboard and gateway build |
| `npm run lint` | ESLint for the dashboard (ignores `listener/`) |
| `npm run typecheck` | `tsc --noEmit` for the dashboard |
| `cd listener && npm run build` | Compile the listener to `listener/dist` |
| `cd listener && npm start` | Run `node dist/index.js` |
| `cd listener && npm run lint` | ESLint for the listener |

## Kill switch

`GATEWAY_ENABLED` must be `"true"` for `/api/gateway/run` (cron, self-chain, dashboard button) to open a Discord session. Any other value makes the route return `{skipped:true}`. Keep it off while another gateway (e.g. Discord Digest) answers the same mentions.
