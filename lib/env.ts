export const TRACKED_ENV_VARS = [
  "DISCORD_PUBLIC_KEY",
  "DISCORD_APPLICATION_ID",
  "DISCORD_BOT_TOKEN",
  "DISCORD_GUILD_ID",
  "AI_ROLE_ID",
  "DISCORD_WAKE_URL",
  "DISCORD_WAKE_KEY",
  "ADMIN_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
] as const;

export type TrackedEnvVar = (typeof TRACKED_ENV_VARS)[number];

const RUNTIME_ENV_VARS = [
  "DISCORD_PUBLIC_KEY",
  "DISCORD_APPLICATION_ID",
  "DISCORD_WAKE_URL",
  "DISCORD_WAKE_KEY",
  "ADMIN_KEY",
] as const satisfies readonly TrackedEnvVar[];

export interface EnvCheck {
  name: TrackedEnvVar;
  set: boolean;
}

export function envChecks(): EnvCheck[] {
  return TRACKED_ENV_VARS.map((name) => ({
    name,
    set: Boolean(process.env[name]),
  }));
}

export function isEnvOk(): boolean {
  return RUNTIME_ENV_VARS.every((name) => Boolean(process.env[name]));
}

export const DEFAULT_AI_ROLE_ID = "1555107644518301717";
export const DEFAULT_GUILD_ID = "1141656332609527838";
