import { after } from "next/server";

import { questionFromInteraction, verifyDiscordSignature } from "@/lib/discord";
import type { DiscordInteraction } from "@/lib/discord";
import { DEFAULT_AI_ROLE_ID } from "@/lib/env";
import { forwardInteraction } from "@/lib/forward";
import { saveInteraction } from "@/lib/store";
import type { InteractionRecord } from "@/lib/types";

export const runtime = "nodejs";

const EPHEMERAL = 64;

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const publicKey = process.env.DISCORD_PUBLIC_KEY;

  if (
    !publicKey ||
    !signature ||
    !timestamp ||
    !verifyDiscordSignature(publicKey, signature, timestamp, rawBody)
  ) {
    return new Response("invalid request signature", { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody) as DiscordInteraction;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  if (interaction.type === 1) {
    return Response.json({ type: 1 });
  }

  if (interaction.type === 2 && interaction.data?.name === "grok") {
    return handleGrok(interaction);
  }

  return Response.json({
    type: 4,
    data: { content: "Unknown command.", flags: EPHEMERAL },
  });
}

function handleGrok(interaction: DiscordInteraction) {
  const receivedAt = new Date().toISOString();
  const roleId = process.env.AI_ROLE_ID || DEFAULT_AI_ROLE_ID;
  const roles = interaction.member?.roles ?? [];
  const hasAiRole = roles.includes(roleId);
  const user = interaction.member?.user;
  const question = questionFromInteraction(interaction);
  const interactionId = interaction.id ?? "";
  const applicationId =
    interaction.application_id || process.env.DISCORD_APPLICATION_ID || "";

  const record: InteractionRecord = {
    id: interactionId,
    userId: user?.id ?? "",
    username: user?.username ?? "",
    question,
    channelId: interaction.channel_id ?? "",
    guildId: interaction.guild_id ?? "",
    receivedAt,
    wakeStatus: hasAiRole ? "pending" : "rejected",
    attempts: [],
  };

  if (!hasAiRole) {
    after(async () => {
      await saveInteraction(record);
    });
    return Response.json({
      type: 4,
      data: {
        content: "You need the ai role to use /grok.",
        flags: EPHEMERAL,
      },
    });
  }

  after(async () => {
    await forwardInteraction({
      question,
      userId: record.userId,
      username: record.username,
      channelId: record.channelId,
      guildId: record.guildId,
      hasAiRole,
      applicationId,
      interactionToken: interaction.token ?? "",
      interactionId,
      receivedAt,
    });
  });

  return Response.json({ type: 5 });
}
