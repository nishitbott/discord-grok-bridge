import type { Message } from "discord.js";

import type { GatewayConfig } from "@/lib/gateway/config";
import { BACKFILL_WINDOW_MS } from "@/lib/gateway/constants";
import { deliverQualified } from "@/lib/gateway/deliver";
import { errorText, logError } from "@/lib/gateway/log";
import { qualifyMessage } from "@/lib/gateway/qualify";
import { preview, pushEvent } from "@/lib/gateway/report";
import { noteSeen } from "@/lib/gateway/state";
import type { GatewayStats } from "@/lib/gateway/types";

export async function handleMessage(
  message: Message,
  backfill: boolean,
  config: GatewayConfig,
  botId: string,
  stats: GatewayStats,
): Promise<void> {
  if (!message.guildId || message.guildId !== config.guildId) {
    return;
  }

  try {
    if (backfill && message.createdTimestamp < Date.now() - BACKFILL_WINDOW_MS) {
      return;
    }
    stats.processed += 1;
    if (backfill) {
      stats.backfilled += 1;
    }
    const qualified = await qualifyMessage(message, config, botId);
    if (qualified) {
      await deliverQualified({
        message,
        text: qualified.text,
        reply: qualified.reply,
        backfill,
        config,
        stats,
      });
    }
  } catch (error) {
    logError("message handler failed", error);
    await pushEvent({
      type: "error",
      message_id: message.id,
      channel_id: message.channelId,
      text_preview: preview(errorText(error)),
      ts: new Date().toISOString(),
    });
  } finally {
    try {
      await noteSeen(message.channelId, message.id);
    } catch (error) {
      logError("last_seen update failed", error);
    }
  }
}
