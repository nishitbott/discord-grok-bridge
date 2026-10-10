export const VERSION = "0.1.0";

export const DEFAULT_BOT_USER_ID = "1555106101828259891";
export const DEFAULT_AI_ROLE_ID = "1555107644518301717";
export const DEFAULT_GUILD_ID = "1141656332609527838";

export const IMMEDIATE_RETRY_MS = 2_000;
export const QUEUE_DRAIN_MS = 60_000;
export const WATCHDOG_MS = 30_000;
export const REPORT_MS = 30_000;
export const STALE_ACK_MS = 90_000;
export const MAX_ATTEMPTS = 10;
export const WOKEN_CAP = 5_000;
export const BACKFILL_LIMIT = 500;
export const BACKFILL_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PREVIEW_LIMIT = 120;
export const REPLY_CONTENT_LIMIT = 1_500;
export const WAKE_TIMEOUT_MS = 15_000;
export const FAILED_QUEUE_CAP = 200;

export interface Config {
  token: string;
  botUserId: string | null;
  aiRoleId: string;
  guildId: string;
  wakeUrl: string;
  wakeKey: string;
  dashboardUrl: string;
  listenerApiKey: string;
  dataDir: string;
}

function read(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function loadConfig(): Config {
  return {
    token: read("DISCORD_BOT_TOKEN"),
    botUserId: read("BOT_USER_ID") || null,
    aiRoleId: read("AI_ROLE_ID") || DEFAULT_AI_ROLE_ID,
    guildId: read("DISCORD_GUILD_ID") || DEFAULT_GUILD_ID,
    wakeUrl: read("DISCORD_WAKE_URL") || read("BRIDGE_WAKE_URL"),
    wakeKey: read("DISCORD_WAKE_KEY") || read("BRIDGE_WAKE_KEY"),
    dashboardUrl: read("DASHBOARD_URL").replace(/\/$/, ""),
    listenerApiKey: read("LISTENER_API_KEY"),
    dataDir: read("DATA_DIR") || "./data",
  };
}

export function resolveBotId(config: Config, clientUserId: string | null): string {
  return config.botUserId || clientUserId || DEFAULT_BOT_USER_ID;
}

export function backoffMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 2);
  const delay = QUEUE_DRAIN_MS * 2 ** exponent;
  return Math.min(delay, 30 * 60_000);
}
