import type { Message } from "discord.js";

import { BACKFILL_WINDOW_MS } from "./config.js";
import type { Config } from "./config.js";
import { deliverQualified } from "./deliver.js";
import { noteSeen } from "./disk.js";
import { errorText, logError } from "./log.js";
import { qualifyMessage } from "./qualify.js";
import { preview, pushEvent } from "./report.js";

export async function handleMessage(
  message: Message,
  backfill: boolean,
  config: Config,
  botId: string,
): Promise<void> {
  if (!message.guildId || message.guildId !== config.guildId) {
    return;
  }

  try {
    if (backfill && message.createdTimestamp < Date.now() - BACKFILL_WINDOW_MS) {
      return;
    }
    const qualified = await qualifyMessage(message, config, botId);
    if (qualified) {
      await deliverQualified({
        message,
        text: qualified.text,
        reply: qualified.reply,
        backfill,
        config,
      });
    }
  } catch (error) {
    logError("message handler failed", error);
    pushEvent({
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
