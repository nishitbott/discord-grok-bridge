import { updateInteraction, saveInteraction } from "@/lib/store";
import type { AttemptRecord, AttemptStatus, InteractionRecord, WakePayload } from "@/lib/types";

const RETRY_DELAY_MS = 1500;
const WAKE_TIMEOUT_MS = 15_000;
const FAILURE_MESSAGE = "Couldn't reach Grok, try again in a minute.";

export interface ForwardRequest {
  question: string;
  userId: string;
  username: string;
  channelId: string;
  guildId: string;
  hasAiRole: boolean;
  applicationId: string;
  interactionToken: string;
  interactionId: string;
  receivedAt: string;
}

export async function forwardInteraction(request: ForwardRequest): Promise<void> {
  const record: InteractionRecord = {
    id: request.interactionId,
    userId: request.userId,
    username: request.username,
    question: request.question,
    channelId: request.channelId,
    guildId: request.guildId,
    receivedAt: request.receivedAt,
    wakeStatus: "pending",
    attempts: [],
  };

  await saveInteraction(record);

  const payload: WakePayload = {
    source: "slash",
    command: "grok",
    question: request.question,
    user_id: request.userId,
    username: request.username,
    channel_id: request.channelId,
    guild_id: request.guildId,
    has_ai_role: request.hasAiRole,
    application_id: request.applicationId,
    interaction_token: request.interactionToken,
    interaction_id: request.interactionId,
    received_at: request.receivedAt,
  };

  const first = await postWake(payload);
  if (first.ok) {
    await recordAttempt(record, 1, first, "ok");
    return;
  }

  await recordAttempt(record, 1, first, "retrying");
  await delay(RETRY_DELAY_MS);

  const second = await postWake(payload);
  if (second.ok) {
    await recordAttempt(record, 2, second, "ok");
    return;
  }

  await recordAttempt(record, 2, second, "failed");
  await notifyDiscordFailure(request.applicationId, request.interactionToken);
}

async function recordAttempt(
  record: InteractionRecord,
  attempt: number,
  result: WakeResult,
  status: AttemptStatus,
): Promise<void> {
  const entry: AttemptRecord = {
    attempt,
    httpStatus: result.status,
    error: result.ok ? null : result.error,
    timestamp: new Date().toISOString(),
    status,
  };
  record.attempts.push(entry);
  record.wakeStatus = status;
  await updateInteraction(record);
}

interface WakeResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

async function postWake(payload: WakePayload): Promise<WakeResult> {
  const url = process.env.DISCORD_WAKE_URL;
  const key = process.env.DISCORD_WAKE_KEY;
  if (!url || !key) {
    return { ok: false, status: null, error: "wake endpoint is not configured" };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "X-Automation-Key": key,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }

    return { ok: true, status: response.status, error: null };
  } catch {
    return { ok: false, status: null, error: "network error" };
  }
}

async function notifyDiscordFailure(applicationId: string, token: string): Promise<void> {
  if (!applicationId || !token) {
    console.error("Skipped Discord failure message; application id or token missing");
    return;
  }

  try {
    const response = await fetch(
      `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`,
      {
        method: "PATCH",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: FAILURE_MESSAGE }),
      },
    );
    if (!response.ok) {
      console.error("Discord failure message was rejected", {
        applicationId,
        status: response.status,
      });
    }
  } catch {
    console.error("Discord failure message request failed", { applicationId });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
