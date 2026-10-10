export const EVENT_TYPES = ["mention", "wake", "error", "backfill", "reconnect"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const WAKE_STATUSES = ["ok", "retrying", "failed", "queued"] as const;
export type WakeStatus = (typeof WAKE_STATUSES)[number];

export interface ListenerEvent {
  type: EventType;
  message_id?: string;
  channel_id?: string;
  author?: string;
  text_preview?: string;
  wake_status?: WakeStatus;
  http_status?: number;
  attempts?: number;
  ts: string;
}

export interface WakePayload {
  message_id: string;
  channel_id: string;
  guild_id: string;
  author_id: string;
  author: string;
  text: string;
  ts: string;
  has_ai_role: true;
  is_reply_to_bot?: true;
  replied_to_message_id?: string;
  replied_to_content?: string;
  backfill?: true;
}

export interface PendingWake {
  messageId: string;
  payload: WakePayload;
  attempts: number;
  nextAttemptAt: string;
  lastStatus: number | null;
  lastError: string | null;
  failed: boolean;
}

export interface QualifiedMention {
  text: string;
  reply: { id: string; content: string } | null;
}
