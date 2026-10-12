import { Client, Events, GatewayIntentBits } from "discord.js";

import { backfillGuild } from "./backfill.js";
import { loadConfig, QUEUE_DRAIN_MS, resolveBotId } from "./config.js";
import type { Config } from "./config.js";
import { drainQueue } from "./deliver.js";
import { duePending, initDisk, queueDepth } from "./disk.js";
import { startHealthServer } from "./health.js";
import { handleMessage } from "./handler.js";
import { errorText, logError, logInfo, logWarn, registerSecrets } from "./log.js";
import { flushEvents, postHeartbeat, pushEvent, startReporter } from "./report.js";
import { sleep } from "./sleep.js";
import { noteActivity, startWatchdog } from "./watchdog.js";

const startedAt = Date.now();

function botIdFor(client: Client, config: Config): string {
  return resolveBotId(config, client.user?.id ?? null);
}

async function main(): Promise<void> {
  const config = loadConfig();
  registerSecrets([
    config.token,
    config.wakeKey,
    config.listenerApiKey,
    config.wakeUrl,
    config.dashboardUrl,
  ]);

  if (!config.token) {
    logError("DISCORD_BOT_TOKEN is required");
    process.exit(1);
  }
  if (!config.wakeUrl || !config.wakeKey) {
    logWarn("wake URL or key is missing; qualified mentions will not be delivered");
  }
  if (!config.dashboardUrl || !config.listenerApiKey) {
    logWarn("dashboard URL or listener API key is missing; ingest reporting is disabled");
  }

  await initDisk(config.dataDir);
  logInfo("listener starting", {
    version: "0.1.0",
    guildId: config.guildId,
    queueDepth: queueDepth(),
  });

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
  });

  let lastEventAt: string | null = null;
  client.on(Events.Raw, () => {
    lastEventAt = new Date().toISOString();
  });
  startHealthServer({
    gatewayConnected: () => client.isReady() && client.ws.status === 0,
    lastEventAt: () => lastEventAt,
  });

  let backfillRunning = false;
  let backfillQueued = false;
  let backfillTimer: NodeJS.Timeout | null = null;

  const runBackfill = async (): Promise<void> => {
    if (backfillRunning) {
      backfillQueued = true;
      return;
    }
    backfillRunning = true;
    try {
      await backfillGuild(client, config, (message, backfill) =>
        handleMessage(message, backfill, config, botIdFor(client, config)),
      );
    } catch (error) {
      logError("backfill failed", error);
      pushEvent({
        type: "error",
        text_preview: "backfill failed",
        ts: new Date().toISOString(),
      });
    } finally {
      backfillRunning = false;
      if (backfillQueued) {
        backfillQueued = false;
        scheduleBackfill();
      }
    }
  };

  function scheduleBackfill(): void {
    if (backfillTimer) {
      clearTimeout(backfillTimer);
    }
    backfillTimer = setTimeout(() => {
      backfillTimer = null;
      void runBackfill();
    }, 1_000);
  }

  const onReady = (): void => {
    noteActivity();
    logInfo("gateway ready", {
      botId: botIdFor(client, config),
      guilds: client.guilds.cache.size,
    });
    scheduleBackfill();
    void postHeartbeat(config, {
      startedAt,
      wsPing: client.ws.ping,
      guilds: client.guilds.cache.size,
      queueDepth: queueDepth(),
    });
  };

  client.on(Events.ClientReady, onReady);
  client.on(Events.ShardResume, () => {
    noteActivity();
    logInfo("gateway shard resumed");
    pushEvent({
      type: "reconnect",
      text_preview: "shard resumed",
      ts: new Date().toISOString(),
    });
    scheduleBackfill();
  });
  client.on(Events.ShardReady, (shardId) => {
    noteActivity();
    if (client.isReady()) {
      logInfo("gateway shard ready", { shardId });
      scheduleBackfill();
    }
  });
  client.on(Events.Error, (error) => {
    logError("gateway client error", error);
    pushEvent({
      type: "error",
      text_preview: errorText(error).slice(0, 120),
      ts: new Date().toISOString(),
    });
  });
  client.on(Events.ShardError, (error) => {
    logError("gateway shard error", error);
  });
  client.on(Events.ShardDisconnect, () => {
    logWarn("gateway shard disconnected");
  });

  client.on(Events.MessageCreate, (message) => {
    void handleMessage(message, false, config, botIdFor(client, config)).catch((error: unknown) => {
      logError("message handler crashed", error);
    });
  });

  startWatchdog(client, config.token);
  startReporter(config, () => ({
    startedAt,
    wsPing: client.ws.ping,
    guilds: client.guilds.cache.size,
    queueDepth: queueDepth(),
  }));

  let draining = false;
  setInterval(() => {
    if (draining) {
      return;
    }
    draining = true;
    void drainQueue(config)
      .catch((error: unknown) => {
        logError("queue drain crashed", error);
      })
      .finally(() => {
        draining = false;
      });
  }, QUEUE_DRAIN_MS);

  const shutdown = (signal: string): void => {
    logInfo("shutting down", { signal });
    void Promise.race([flushEvents(config), sleep(3_000)])
      .catch(() => undefined)
      .finally(() => {
        void client
          .destroy()
          .catch(() => undefined)
          .finally(() => {
            process.exit(0);
          });
      });
  };
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("unhandledRejection", (reason) => {
    logError("unhandled rejection", reason);
  });
  process.on("uncaughtException", (error) => {
    logError("uncaught exception", error);
  });

  for (;;) {
    try {
      await client.login(config.token);
      logInfo("gateway login succeeded");
      break;
    } catch (error) {
      logError("gateway login failed", error);
      await sleep(15_000);
    }
  }

  if (duePending(Date.now()).length > 0) {
    void drainQueue(config).catch((error: unknown) => {
      logError("startup queue drain failed", error);
    });
  }
}

void main().catch((error: unknown) => {
  logError("listener exited", error);
  process.exit(1);
});
