export const TRACKED_ENV_VARS = [
  "ADMIN_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "DISCORD_BOT_TOKEN",
  "CRON_SECRET",
  "DISCORD_WAKE_URL",
  "DISCORD_WAKE_KEY",
  "BOT_USER_ID",
  "AI_ROLE_ID",
  "DISCORD_GUILD_ID",
] as const;

export type TrackedEnvVar = (typeof TRACKED_ENV_VARS)[number];

export interface EnvCheck {
  name: TrackedEnvVar;
  set: boolean;
}

function isEnvSet(name: TrackedEnvVar): boolean {
  if (name === "DISCORD_WAKE_URL") {
    return Boolean(process.env.DISCORD_WAKE_URL || process.env.BRIDGE_WAKE_URL);
  }
  if (name === "DISCORD_WAKE_KEY") {
    return Boolean(process.env.DISCORD_WAKE_KEY || process.env.BRIDGE_WAKE_KEY);
  }
  return Boolean(process.env[name]);
}

export function envChecks(): EnvCheck[] {
  return TRACKED_ENV_VARS.map((name) => ({
    name,
    set: isEnvSet(name),
  }));
}

export function isAdminConfigured(): boolean {
  return Boolean(process.env.ADMIN_KEY);
}
