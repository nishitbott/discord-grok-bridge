import type { ListenerEvent } from "@/lib/types";
import { HEARTBEAT_STALE_MS } from "@/lib/types";

export interface MentionRow {
  messageId: string;
  channelId: string;
  author: string;
  textPreview: string;
  wakeStatus: string;
  httpStatus: number | null;
  attempts: number | null;
  ts: string;
  backfill: boolean;
}

export function mentionRows(events: ListenerEvent[], limit = 20): MentionRow[] {
  const rows = new Map<string, MentionRow>();

  for (const event of events) {
    if (event.type !== "mention" && event.type !== "wake" && event.type !== "backfill") {
      continue;
    }
    if (!event.message_id) {
      continue;
    }

    const current = rows.get(event.message_id);
    if (!current) {
      rows.set(event.message_id, {
        messageId: event.message_id,
        channelId: event.channel_id ?? "",
        author: event.author ?? "",
        textPreview: event.text_preview ?? "",
        wakeStatus: event.wake_status ?? "",
        httpStatus: event.http_status ?? null,
        attempts: event.attempts ?? null,
        ts: event.ts,
        backfill: event.type === "backfill",
      });
      continue;
    }

    if (!current.wakeStatus && event.wake_status) {
      current.wakeStatus = event.wake_status;
    }
    if (current.httpStatus === null && event.http_status !== undefined) {
      current.httpStatus = event.http_status;
    }
    if (current.attempts === null && event.attempts !== undefined) {
      current.attempts = event.attempts;
    }
    if (!current.author && event.author) {
      current.author = event.author;
    }
    if (!current.textPreview && event.text_preview) {
      current.textPreview = event.text_preview;
    }
    if (!current.channelId && event.channel_id) {
      current.channelId = event.channel_id;
    }
    if (event.type === "backfill") {
      current.backfill = true;
    }
  }

  return [...rows.values()].slice(0, limit);
}

export function isHeartbeatFresh(receivedAt: string, now = Date.now()): boolean {
  const stamp = Date.parse(receivedAt);
  if (!Number.isFinite(stamp)) {
    return false;
  }
  return now - stamp < HEARTBEAT_STALE_MS;
}
