export const VERSION = "0.1.0";

export const DEFAULT_BOT_USER_ID = "1555106101828259891";
export const DEFAULT_AI_ROLE_ID = "1555107644518301717";
export const DEFAULT_GUILD_ID = "1141656332609527838";

export const IMMEDIATE_RETRY_MS = 2_000;
export const QUEUE_DRAIN_MS = 60_000;
export const HEARTBEAT_MS = 30_000;
export const MAX_ATTEMPTS = 10;
export const WOKEN_CAP = 5_000;
export const WOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const WOKEN_TTL_SEC = 7 * 24 * 60 * 60;
export const BACKFILL_LIMIT = 500;
export const BACKFILL_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PREVIEW_LIMIT = 120;
export const REPLY_CONTENT_LIMIT = 1_500;
export const WAKE_TIMEOUT_MS = 15_000;
export const FAILED_QUEUE_CAP = 200;

/** Stay inside the Hobby 300s function cap, leaving room to close the socket. */
export const GATEWAY_WINDOW_MS = 285_000;
export const LOCK_TTL_MS = 300_000;
export const READY_TIMEOUT_MS = 20_000;
export const CHAIN_ABORT_MS = 5_000;
export const DETACH_HEADER = "x-gateway-detach";

export const LOCK_KEY = "dgb:gateway:lock";
export const WOKEN_KEY = "dgb:gateway:woken";
export const LAST_SEEN_KEY = "dgb:gateway:last_seen";
export const RETRY_KEY = "dgb:gateway:retry";
