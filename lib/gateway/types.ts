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

export interface GatewayStats {
  processed: number;
  woken: number;
  backfilled: number;
}

export interface GatewayRunSummary extends GatewayStats {
  duration: number;
}

export interface GatewayLockView {
  holder: string;
  expiresAt: string | null;
}
