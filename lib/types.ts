export const WAKE_STATUSES = [
  "ok",
  "retrying",
  "failed",
  "rejected",
  "pending",
] as const;

export type WakeStatus = (typeof WAKE_STATUSES)[number];

export const ATTEMPT_STATUSES = ["ok", "retrying", "failed"] as const;

export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export interface AttemptRecord {
  attempt: number;
  httpStatus: number | null;
  error: string | null;
  timestamp: string;
  status: AttemptStatus;
}

export interface InteractionRecord {
  id: string;
  userId: string;
  username: string;
  question: string;
  channelId: string;
  guildId: string;
  receivedAt: string;
  wakeStatus: WakeStatus;
  attempts: AttemptRecord[];
}

export interface ApiKeyRecord {
  hash: string;
  prefix: string;
  name: string;
  createdAt: string;
  revoked: boolean;
}

export interface WakePayload {
  source: "slash";
  command: "grok";
  question: string;
  user_id: string;
  username: string;
  channel_id: string;
  guild_id: string;
  has_ai_role: boolean;
  application_id: string;
  interaction_token: string;
  interaction_id: string;
  received_at: string;
}
