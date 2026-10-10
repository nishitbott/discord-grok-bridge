import { Client, Events, GatewayIntentBits } from "discord.js";

import { backfillGuild } from "@/lib/gateway/backfill";
import { loadGatewayConfig, resolveBotId, type GatewayConfig } from "@/lib/gateway/config";
import {
  GATEWAY_WINDOW_MS,
  HEARTBEAT_MS,
  QUEUE_DRAIN_MS,
  READY_TIMEOUT_MS,
} from "@/lib/gateway/constants";
import { drainQueue } from "@/lib/gateway/deliver";
import { handleMessage } from "@/lib/gateway/handler";
import { resetInflight } from "@/lib/gateway/inflight";
import { errorText, logError, logInfo, logWarn, registerSecrets } from "@/lib/gateway/log";
import { preview, pushEvent, writeHeartbeat } from "@/lib/gateway/report";
import { queueDepth, refreshGatewayLock } from "@/lib/gateway/state";
import type { GatewayRunSummary, GatewayStats } from "@/lib/gateway/types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(message));
      },
    );
  });
}

function waitForReady(client: Client, timeoutMs: number): Promise<void> {
  if (client.isReady()) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onReady = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      client.off(Events.ClientReady, onReady);
      reject(new Error("gateway ready timeout"));
    }, timeoutMs);
    client.once(Events.ClientReady, onReady);
  });
}

async function destroyClient(client: Client): Promise<void> {
  await Promise.race([client.destroy().catch(() => undefined), sleep(3_000)]);
}

export async function runGatewayWindow(runId: string): Promise<GatewayRunSummary> {
  const startedAt = Date.now();
  const deadline = startedAt + GATEWAY_WINDOW_MS;
  const stats: GatewayStats = { processed: 0, woken: 0, backfilled: 0 };
  resetInflight();

  const config = loadGatewayConfig();
  registerSecrets([config.token, config.wakeKey, config.wakeUrl, process.env.CRON_SECRET]);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
  });

  const botId = (): string => resolveBotId(config, client.user?.id ?? null);
  let backfillRunning = false;
  let backfillQueued = false;

  const runBackfill = async (): Promise<void> => {
    if (Date.now() >= deadline) {
      return;
    }
    if (backfillRunning) {
      backfillQueued = true;
      return;
    }
    backfillRunning = true;
    try {
      await backfillGuild(
        client,
        config,
        (message, backfill) => handleMessage(message, backfill, config, botId(), stats),
        () => Date.now() < deadline,
      );
    } catch (error) {
      logError("backfill failed", error);
      await pushEvent({
        type: "error",
        text_preview: preview(errorText(error)),
        ts: new Date().toISOString(),
      });
    } finally {
      backfillRunning = false;
      if (backfillQueued && Date.now() < deadline) {
        backfillQueued = false;
        await runBackfill();
      }
    }
  };

  client.on(Events.MessageCreate, (message) => {
    void handleMessage(message, false, config, botId(), stats).catch((error: unknown) => {
      logError("message handler crashed", error);
    });
  });
  client.on(Events.Error, (error) => {
    logError("gateway client error", error);
    void pushEvent({
      type: "error",
      text_preview: preview(errorText(error)),
      ts: new Date().toISOString(),
    });
  });
  client.on(Events.ShardDisconnect, () => {
    logWarn("gateway shard disconnected");
  });
  client.on(Events.ShardResume, () => {
    logInfo("gateway shard resumed");
    void pushEvent({
      type: "reconnect",
      text_preview: "shard resumed",
      ts: new Date().toISOString(),
    });
    void runBackfill();
  });

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let drainTimer: ReturnType<typeof setInterval> | null = null;

  const beat = async (): Promise<void> => {
    await writeHeartbeat({
      startedAt,
      wsPing: client.ws.ping,
      guilds: client.guilds.cache.size,
      queueDepth: await queueDepth(),
    });
    await refreshGatewayLock(runId);
  };

  try {
    const readyTimeout = Math.min(READY_TIMEOUT_MS, Math.max(1_000, deadline - Date.now()));
    const ready = waitForReady(client, readyTimeout);
    const login = client.login(config.token);
    const connected = login.then(async () => {
      await ready;
    });
    void ready.catch(() => undefined);
    void login.catch(() => undefined);
    void connected.catch(() => undefined);
    await withTimeout(connected, readyTimeout, "gateway connect timeout");
    logInfo("gateway ready", { botId: botId(), guilds: client.guilds.cache.size });

    await beat();
    heartbeatTimer = setInterval(() => {
      void beat().catch((error: unknown) => {
        logError("heartbeat failed", error);
      });
    }, HEARTBEAT_MS);

    await drainQueue(config, stats);
    drainTimer = setInterval(() => {
      void drainQueue(config, stats).catch((error: unknown) => {
        logError("queue drain crashed", error);
      });
    }, QUEUE_DRAIN_MS);

    await runBackfill();

    const remaining = deadline - Date.now();
    if (remaining > 0) {
      await sleep(remaining);
    }
    await beat();
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    if (drainTimer) {
      clearInterval(drainTimer);
    }
    await destroyClient(client);
  }

  return {
    processed: stats.processed,
    woken: stats.woken,
    backfilled: stats.backfilled,
    duration: Date.now() - startedAt,
  };
}

export function assertGatewayConfig(config: GatewayConfig): string | null {
  if (!config.token) {
    return "DISCORD_BOT_TOKEN is not set";
  }
  return null;
}
