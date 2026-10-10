import {
  DEFAULT_AI_ROLE_ID,
  DEFAULT_BOT_USER_ID,
  DEFAULT_GUILD_ID,
  QUEUE_DRAIN_MS,
} from "@/lib/gateway/constants";

export interface GatewayConfig {
  token: string;
  botUserId: string | null;
  aiRoleId: string;
  guildId: string;
  wakeUrl: string;
  wakeKey: string;
}

function read(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function loadGatewayConfig(): GatewayConfig {
  return {
    token: read("DISCORD_BOT_TOKEN"),
    botUserId: read("BOT_USER_ID") || null,
    aiRoleId: read("AI_ROLE_ID") || DEFAULT_AI_ROLE_ID,
    guildId: read("DISCORD_GUILD_ID") || DEFAULT_GUILD_ID,
    wakeUrl: read("DISCORD_WAKE_URL") || read("BRIDGE_WAKE_URL"),
    wakeKey: read("DISCORD_WAKE_KEY") || read("BRIDGE_WAKE_KEY"),
  };
}

export function resolveBotId(config: GatewayConfig, clientUserId: string | null): string {
  return config.botUserId || clientUserId || DEFAULT_BOT_USER_ID;
}

export function backoffMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 2);
  const delay = QUEUE_DRAIN_MS * 2 ** exponent;
  return Math.min(delay, 30 * 60_000);
}

export function selfChainEnabled(): boolean {
  const raw = process.env.GATEWAY_SELF_CHAIN;
  if (raw === undefined || raw.trim() === "") {
    return true;
  }
  const value = raw.trim().toLowerCase();
  return value !== "false" && value !== "0" && value !== "off" && value !== "no";
}
