import { Status, type Client } from "discord.js";

import { STALE_ACK_MS, WATCHDOG_MS } from "./config.js";
import { errorText, logError, logInfo, logWarn, redact } from "./log.js";
import { preview, pushEvent } from "./report.js";

let lastActivityAt = 0;
let unhealthySince: number | null = null;
let recovering = false;
let lastRecoverAt = 0;

export function noteActivity(at = Date.now()): void {
  if (at > lastActivityAt) {
    lastActivityAt = at;
  }
}

export function startWatchdog(client: Client, token: string): void {
  setInterval(() => {
    try {
      inspect(client, token);
    } catch (error) {
      logError("watchdog check failed", error);
    }
  }, WATCHDOG_MS);
}

function inspect(client: Client, token: string): void {
  if (recovering || Date.now() - lastRecoverAt < WATCHDOG_MS) {
    return;
  }

  if (lastActivityAt === 0) {
    return;
  }

  const shard = client.ws.shards.first();
  const ack = shard && shard.lastPingTimestamp > 0 ? shard.lastPingTimestamp : 0;
  if (ack > 0) {
    noteActivity(ack);
  }

  const status = shard?.status;
  if (status === Status.Ready) {
    unhealthySince = null;
    if (Date.now() - lastActivityAt > STALE_ACK_MS) {
      void recover(client, token, "stale heartbeat");
    }
    return;
  }

  unhealthySince ??= Date.now();
  if (Date.now() - unhealthySince > STALE_ACK_MS) {
    void recover(client, token, "zombie socket");
  }
}

async function recover(client: Client, token: string, reason: string): Promise<void> {
  if (recovering) {
    return;
  }
  recovering = true;
  lastRecoverAt = Date.now();
  logWarn("reconnecting gateway", { reason });
  pushEvent({
    type: "reconnect",
    text_preview: preview(reason),
    ts: new Date().toISOString(),
  });

  try {
    await client.destroy();
  } catch (error) {
    logError("gateway destroy failed", error);
  }

  try {
    await client.login(token);
    noteActivity();
    logInfo("gateway re-login succeeded");
  } catch (error) {
    logError("gateway re-login failed", error);
    pushEvent({
      type: "error",
      text_preview: preview(redact(errorText(error))),
      ts: new Date().toISOString(),
    });
  } finally {
    recovering = false;
  }
}
