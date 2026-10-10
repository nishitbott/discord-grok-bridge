import {
  ChannelType,
  type Client,
  type Message,
  type NewsChannel,
  type TextChannel,
} from "discord.js";

import type { GatewayConfig } from "@/lib/gateway/config";
import { BACKFILL_LIMIT, BACKFILL_WINDOW_MS } from "@/lib/gateway/constants";
import { errorText, logError, logInfo } from "@/lib/gateway/log";
import { preview, pushEvent } from "@/lib/gateway/report";
import { getLastSeen, noteSeen } from "@/lib/gateway/state";
import { newerId, snowflakeAt } from "@/lib/gateway/snowflake";

function isGuildText(channel: { type: ChannelType }): channel is TextChannel | NewsChannel {
  return channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
}

async function collectSince(channel: TextChannel | NewsChannel, after: string): Promise<Message[]> {
  const collected: Message[] = [];
  let cursor = after;
  while (collected.length < BACKFILL_LIMIT) {
    const limit = Math.min(100, BACKFILL_LIMIT - collected.length);
    const page = await channel.messages.fetch({ after: cursor, limit });
    if (page.size === 0) {
      break;
    }
    const sorted = [...page.values()].sort((left, right) => (BigInt(left.id) < BigInt(right.id) ? -1 : 1));
    const newest = sorted[sorted.length - 1];
    if (!newest) {
      break;
    }
    collected.push(...sorted);
    cursor = newest.id;
    if (page.size < limit) {
      break;
    }
  }
  return collected;
}

export async function backfillGuild(
  client: Client,
  config: GatewayConfig,
  handle: (message: Message, backfill: boolean) => Promise<void>,
  shouldContinue: () => boolean = () => true,
): Promise<void> {
  if (!shouldContinue()) {
    return;
  }

  let guild;
  try {
    guild = await client.guilds.fetch(config.guildId);
    await guild.channels.fetch();
  } catch (error) {
    logError("backfill could not load guild", error);
    await pushEvent({
      type: "error",
      text_preview: preview(errorText(error)),
      ts: new Date().toISOString(),
    });
    return;
  }

  const channels = [...guild.channels.cache.values()].filter(isGuildText);
  const floor = snowflakeAt(Date.now() - BACKFILL_WINDOW_MS);
  logInfo("backfill started", { guildId: config.guildId, channels: channels.length });

  for (const channel of channels) {
    if (!shouldContinue()) {
      logInfo("backfill stopped at window deadline");
      return;
    }
    try {
      const seen = await getLastSeen(channel.id);
      if (!seen) {
        const latest = await channel.messages.fetch({ limit: 1 });
        const newest = latest.first();
        if (newest) {
          await noteSeen(channel.id, newest.id);
        }
        await pushEvent({
          type: "backfill",
          channel_id: channel.id,
          text_preview: newest ? "initialized last_seen" : "empty channel",
          ts: new Date().toISOString(),
        });
        continue;
      }

      const after = newerId(seen, floor);
      const messages = await collectSince(channel, after);
      logInfo("backfill channel", { channelId: channel.id, messages: messages.length });
      for (const message of messages) {
        if (!shouldContinue()) {
          logInfo("backfill stopped at window deadline");
          return;
        }
        if (message.createdTimestamp < Date.now() - BACKFILL_WINDOW_MS) {
          await noteSeen(message.channelId, message.id);
          continue;
        }
        try {
          await handle(message, true);
        } catch (error) {
          logError("backfill message failed", error);
          await pushEvent({
            type: "error",
            message_id: message.id,
            channel_id: message.channelId,
            text_preview: preview(errorText(error)),
            ts: new Date().toISOString(),
          });
        }
      }
      await pushEvent({
        type: "backfill",
        channel_id: channel.id,
        text_preview: `scanned ${messages.length} messages`,
        ts: new Date().toISOString(),
      });
    } catch (error) {
      logError("backfill channel failed", error);
      await pushEvent({
        type: "error",
        channel_id: channel.id,
        text_preview: preview(errorText(error)),
        ts: new Date().toISOString(),
      });
    }
  }
}
