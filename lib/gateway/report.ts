import { PREVIEW_LIMIT, VERSION } from "@/lib/gateway/constants";
import { logWarn } from "@/lib/gateway/log";
import { saveEvents, saveHeartbeat } from "@/lib/store";
import type { HeartbeatRecord, ListenerEvent } from "@/lib/types";

export function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= PREVIEW_LIMIT ? flat : flat.slice(0, PREVIEW_LIMIT);
}

export async function pushEvent(event: ListenerEvent): Promise<void> {
  const next: ListenerEvent = {
    ...event,
    ts: event.ts || new Date().toISOString(),
  };
  if (next.text_preview) {
    next.text_preview = preview(next.text_preview);
  }
  try {
    const saved = await saveEvents([next]);
    if (!saved) {
      logWarn("event write failed");
    }
  } catch (error) {
    logWarn("event write failed", {
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
}

export async function writeHeartbeat(snapshot: {
  startedAt: number;
  wsPing: number;
  guilds: number;
  queueDepth: number;
}): Promise<void> {
  const now = new Date().toISOString();
  const ping = Number.isFinite(snapshot.wsPing) ? snapshot.wsPing : -1;
  const record: HeartbeatRecord = {
    uptime_s: Math.max(0, Math.floor((Date.now() - snapshot.startedAt) / 1000)),
    ws_ping: ping,
    guilds: snapshot.guilds,
    queue_depth: snapshot.queueDepth,
    version: VERSION,
    ts: now,
    receivedAt: now,
    source: "vercel",
  };
  try {
    const saved = await saveHeartbeat(record);
    if (!saved) {
      logWarn("heartbeat write failed");
    }
  } catch (error) {
    logWarn("heartbeat write failed", {
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
}
