export const WAKE_STATUSES = ["ok", "retrying", "failed", "queued"] as const;

export type WakeStatus = (typeof WAKE_STATUSES)[number];

export const EVENT_TYPES = ["mention", "wake", "error", "backfill", "reconnect"] as const;

export type ListenerEventType = (typeof EVENT_TYPES)[number];

export interface ListenerEvent {
  type: ListenerEventType;
  message_id?: string;
  channel_id?: string;
  author?: string;
  text_preview?: string;
  wake_status?: WakeStatus;
  http_status?: number;
  attempts?: number;
  ts: string;
}

export const LISTENER_SOURCES = ["vercel", "railway"] as const;

export type ListenerSource = (typeof LISTENER_SOURCES)[number];

export interface HeartbeatRecord {
  uptime_s: number;
  ws_ping: number;
  guilds: number;
  queue_depth: number;
  version: string;
  ts: string;
  receivedAt: string;
  source?: ListenerSource;
}

export interface ApiKeyRecord {
  hash: string;
  prefix: string;
  name: string;
  createdAt: string;
  revoked: boolean;
  lastUsedAt?: string;
}

export const HEARTBEAT_STALE_MS = 90_000;
export const EVENT_LIST_CAP = 500;
