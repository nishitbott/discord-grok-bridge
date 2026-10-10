import { PREVIEW_LIMIT, REPORT_MS, VERSION } from "./config.js";
import type { Config } from "./config.js";
import { errorText, logWarn, redact } from "./log.js";
import type { ListenerEvent } from "./types.js";

const buffer: ListenerEvent[] = [];
const BUFFER_CAP = 200;

export function pushEvent(event: ListenerEvent): void {
  const next: ListenerEvent = { ...event, ts: event.ts || new Date().toISOString() };
  if (next.text_preview && next.text_preview.length > PREVIEW_LIMIT) {
    next.text_preview = next.text_preview.slice(0, PREVIEW_LIMIT);
  }
  buffer.push(next);
  if (buffer.length > BUFFER_CAP) {
    buffer.splice(0, buffer.length - BUFFER_CAP);
  }
}

export function preview(text: string): string {
  return text.length <= PREVIEW_LIMIT ? text : text.slice(0, PREVIEW_LIMIT);
}

async function postJson(config: Config, path: string, body: unknown): Promise<boolean> {
  if (!config.dashboardUrl || !config.listenerApiKey) {
    return false;
  }

  try {
    const response = await fetch(`${config.dashboardUrl}${path}`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.listenerApiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 8000);
      logWarn("dashboard ingest failed", {
        path,
        status: response.status,
        body: redact(text),
      });
      return false;
    }
    return true;
  } catch (error) {
    logWarn("dashboard ingest error", { path, error: redact(errorText(error)) });
    return false;
  }
}

export async function postHeartbeat(
  config: Config,
  snapshot: { startedAt: number; wsPing: number; guilds: number; queueDepth: number },
): Promise<void> {
  try {
    const ping = Number.isFinite(snapshot.wsPing) ? snapshot.wsPing : -1;
    await postJson(config, "/api/ingest/heartbeat", {
      uptime_s: Math.max(0, Math.floor((Date.now() - snapshot.startedAt) / 1000)),
      ws_ping: ping,
      guilds: snapshot.guilds,
      queue_depth: snapshot.queueDepth,
      version: VERSION,
      ts: new Date().toISOString(),
    });
  } catch (error) {
    logWarn("heartbeat report failed", { error: redact(errorText(error)) });
  }
}

export async function flushEvents(config: Config): Promise<void> {
  try {
    for (let batch = 0; batch < 5 && buffer.length > 0; batch += 1) {
      const events = buffer.splice(0, 100);
      const ok = await postJson(config, "/api/ingest/events", { events });
      if (!ok) {
        buffer.unshift(...events);
        if (buffer.length > BUFFER_CAP) {
          buffer.splice(0, buffer.length - BUFFER_CAP);
        }
        return;
      }
    }
  } catch (error) {
    logWarn("event report failed", { error: redact(errorText(error)) });
  }
}

export function startReporter(
  config: Config,
  snapshot: () => { startedAt: number; wsPing: number; guilds: number; queueDepth: number },
): void {
  const tick = (): void => {
    void postHeartbeat(config, snapshot()).catch((error: unknown) => {
      logWarn("heartbeat report failed", { error: redact(errorText(error)) });
    });
    void flushEvents(config).catch((error: unknown) => {
      logWarn("event report failed", { error: redact(errorText(error)) });
    });
  };

  setInterval(tick, REPORT_MS);
}
