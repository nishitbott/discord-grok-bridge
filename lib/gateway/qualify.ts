import type { Message } from "discord.js";

import { REPLY_CONTENT_LIMIT } from "@/lib/gateway/constants";
import type { GatewayConfig } from "@/lib/gateway/config";
import type { QualifiedMention } from "@/lib/gateway/types";

export function visibleText(content: string, botId: string): string {
  return content.split(`<@${botId}>`).join("").split(`<@!${botId}>`).join("").trim();
}

function mentionsBot(message: Message, botId: string): boolean {
  return (
    message.mentions.users.has(botId) ||
    message.content.includes(`<@${botId}>`) ||
    message.content.includes(`<@!${botId}>`)
  );
}

async function replyToBot(
  message: Message,
  botId: string,
): Promise<{ id: string; content: string } | null> {
  const referencedId = message.reference?.messageId;
  if (!referencedId) {
    return null;
  }

  const repliedUser = message.mentions.repliedUser;
  if (repliedUser && repliedUser.id !== botId) {
    return null;
  }

  try {
    const referenced = await message.fetchReference();
    if (referenced.author.id !== botId) {
      return null;
    }
    return {
      id: referenced.id,
      content: referenced.content.slice(0, REPLY_CONTENT_LIMIT),
    };
  } catch {
    if (repliedUser?.id === botId) {
      return { id: referencedId, content: "" };
    }
    return null;
  }
}

async function authorHasRole(message: Message, roleId: string): Promise<boolean> {
  const guild = message.guild;
  if (!guild) {
    return false;
  }

  let member = message.member;
  if (!member) {
    try {
      member = await guild.members.fetch(message.author.id);
    } catch {
      return false;
    }
  }

  return member.roles.cache.has(roleId);
}

export async function qualifyMessage(
  message: Message,
  config: GatewayConfig,
  botId: string,
): Promise<QualifiedMention | null> {
  if (message.author.bot || message.author.id === botId) {
    return null;
  }
  if (message.guildId !== config.guildId) {
    return null;
  }

  const mentioned = mentionsBot(message, botId);
  const hasReference = Boolean(message.reference?.messageId);
  if (!mentioned && !hasReference) {
    return null;
  }

  const reply = hasReference ? await replyToBot(message, botId) : null;
  if (!mentioned && !reply) {
    return null;
  }

  const hasRole = await authorHasRole(message, config.aiRoleId);
  if (!hasRole) {
    return null;
  }

  const text = visibleText(message.content, botId);
  if (!text) {
    return null;
  }

  return { text, reply };
}
