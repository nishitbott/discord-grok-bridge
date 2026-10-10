import type { HeartbeatRecord, ListenerEvent, ListenerEventType, WakeStatus } from "@/lib/types";
import { EVENT_TYPES, WAKE_STATUSES } from "@/lib/types";

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

function asFinite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isEventType(value: unknown): value is ListenerEventType {
  return typeof value === "string" && EVENT_TYPES.some((type) => type === value);
}

function isWakeStatus(value: unknown): value is WakeStatus {
  return typeof value === "string" && WAKE_STATUSES.some((status) => status === value);
}

export function parseHeartbeat(value: unknown): Omit<HeartbeatRecord, "receivedAt"> | null {
  if (!isRecord(value)) {
    return null;
  }

  const uptime = asFinite(value.uptime_s);
  const ping = asFinite(value.ws_ping);
  const guilds = asFinite(value.guilds);
  const depth = asFinite(value.queue_depth);
  const version = asString(value.version, 64);
  const ts = asString(value.ts, 40);
  if (
    uptime === null ||
    ping === null ||
    guilds === null ||
    depth === null ||
    uptime < 0 ||
    guilds < 0 ||
    depth < 0 ||
    !version ||
    !ts
  ) {
    return null;
  }

  return {
    uptime_s: uptime,
    ws_ping: ping,
    guilds,
    queue_depth: depth,
    version,
    ts,
  };
}

export function parseEvents(value: unknown): ListenerEvent[] | null {
  const source = Array.isArray(value) ? value : isRecord(value) ? value.events : null;
  if (!Array.isArray(source)) {
    return null;
  }

  const events: ListenerEvent[] = [];
  for (const item of source.slice(0, 200)) {
    const event = parseEvent(item);
    if (event) {
      events.push(event);
    }
  }
  return events;
}

function parseEvent(value: unknown): ListenerEvent | null {
  if (!isRecord(value) || !isEventType(value.type)) {
    return null;
  }

  const event: ListenerEvent = {
    type: value.type,
    ts: asString(value.ts, 40) ?? new Date().toISOString(),
  };
  const messageId = asString(value.message_id, 32);
  const channelId = asString(value.channel_id, 32);
  const author = asString(value.author, 80);
  const textPreview = asString(value.text_preview, 120);
  if (messageId) {
    event.message_id = messageId;
  }
  if (channelId) {
    event.channel_id = channelId;
  }
  if (author) {
    event.author = author;
  }
  if (textPreview) {
    event.text_preview = textPreview;
  }
  if (isWakeStatus(value.wake_status)) {
    event.wake_status = value.wake_status;
  }
  const httpStatus = asFinite(value.http_status);
  if (httpStatus !== null && httpStatus >= 0 && httpStatus <= 599) {
    event.http_status = httpStatus;
  }
  const attempts = asFinite(value.attempts);
  if (attempts !== null && attempts >= 0 && attempts <= 100) {
    event.attempts = attempts;
  }
  return event;
}

export function parseStoredEvent(value: unknown): ListenerEvent | null {
  if (typeof value === "string") {
    try {
      return parseEvent(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  return parseEvent(value);
}
