export const TRACKED_ENV_VARS = [
  "ADMIN_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
] as const;

export type TrackedEnvVar = (typeof TRACKED_ENV_VARS)[number];

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

export function isAdminConfigured(): boolean {
  return Boolean(process.env.ADMIN_KEY);
}
