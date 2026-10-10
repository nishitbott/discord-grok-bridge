import { backoffMs, IMMEDIATE_RETRY_MS, MAX_ATTEMPTS, PREVIEW_LIMIT } from "./config.js";
import type { Config } from "./config.js";
import {
  duePending,
  hasWoken,
  queueDepth,
  rememberWoken,
  removePending,
  upsertPending,
} from "./disk.js";
import { clearInflight, isInflight, markInflight } from "./inflight.js";
import { errorText, logError, logInfo } from "./log.js";
import type { Message } from "discord.js";
import { preview, pushEvent } from "./report.js";
import { sleep } from "./sleep.js";
import type { PendingWake, WakePayload, WakeStatus } from "./types.js";
import { postWake, type WakePostResult } from "./wake.js";

interface DeliveryResult {
  ok: boolean;
  attempts: number;
  status: number | null;
  error: string | null;
}

function buildPayload(
  message: Message,
  text: string,
  reply: { id: string; content: string } | null,
  backfill: boolean,
): WakePayload {
  const payload: WakePayload = {
    message_id: message.id,
    channel_id: message.channelId,
    guild_id: message.guildId ?? "",
    author_id: message.author.id,
    author: message.author.username,
    text,
    ts: message.createdAt.toISOString(),
    has_ai_role: true,
  };
  if (reply) {
    payload.is_reply_to_bot = true;
    payload.replied_to_message_id = reply.id;
    payload.replied_to_content = reply.content;
  }
  if (backfill) {
    payload.backfill = true;
  }
  return payload;
}

async function sendTyping(message: Message): Promise<void> {
  const channel = message.channel;
  if (!("sendTyping" in channel) || typeof channel.sendTyping !== "function") {
    return;
  }
  try {
    await channel.sendTyping();
  } catch (error) {
    logError("typing indicator failed", error);
  }
}

function emitQualified(
  payload: WakePayload,
  backfill: boolean,
): void {
  pushEvent({
    type: backfill ? "backfill" : "mention",
    message_id: payload.message_id,
    channel_id: payload.channel_id,
    author: payload.author,
    text_preview: preview(payload.text),
    ts: payload.ts,
  });
}

function emitWake(
  payload: WakePayload,
  wakeStatus: WakeStatus,
  attempts: number,
  status: number | null,
): void {
  pushEvent({
    type: "wake",
    message_id: payload.message_id,
    channel_id: payload.channel_id,
    author: payload.author,
    text_preview: payload.text.slice(0, PREVIEW_LIMIT),
    wake_status: wakeStatus,
    ts: new Date().toISOString(),
    attempts,
    ...(status !== null ? { http_status: status } : {}),
  });
}

async function postWithRetry(payload: WakePayload, config: Config): Promise<DeliveryResult> {
  const first = await postWake(payload, config);
  logInfo("wake attempt", {
    messageId: payload.message_id,
    attempt: 1,
    status: first.status,
    ok: first.ok,
  });
  if (first.ok || !first.retryable) {
    return { ok: first.ok, attempts: 1, status: first.status, error: first.error };
  }

  emitWake(payload, "retrying", 1, first.status);
  await sleep(IMMEDIATE_RETRY_MS);

  const second = await postWake(payload, config);
  logInfo("wake attempt", {
    messageId: payload.message_id,
    attempt: 2,
    status: second.status,
    ok: second.ok,
  });
  return { ok: second.ok, attempts: 2, status: second.status, error: second.error };
}

function pendingFrom(
  payload: WakePayload,
  attempts: number,
  result: Pick<WakePostResult, "status" | "error">,
  failed: boolean,
): PendingWake {
  return {
    messageId: payload.message_id,
    payload,
    attempts,
    nextAttemptAt: new Date(Date.now() + backoffMs(attempts)).toISOString(),
    lastStatus: result.status,
    lastError: result.error,
    failed,
  };
}

export async function deliverQualified(options: {
  message: Message;
  text: string;
  reply: { id: string; content: string } | null;
  backfill: boolean;
  config: Config;
}): Promise<void> {
  const messageId = options.message.id;
  if (isInflight(messageId) || hasWoken(messageId)) {
    return;
  }
  markInflight(messageId);

  try {
    const payload = buildPayload(options.message, options.text, options.reply, options.backfill);
    await sendTyping(options.message);
    emitQualified(payload, options.backfill);

    if (!options.config.wakeUrl || !options.config.wakeKey) {
      logError("wake endpoint is not configured");
      emitWake(payload, "failed", 0, null);
      pushEvent({
        type: "error",
        message_id: payload.message_id,
        channel_id: payload.channel_id,
        author: payload.author,
        text_preview: "wake endpoint is not configured",
        wake_status: "failed",
        ts: new Date().toISOString(),
      });
      return;
    }

    await upsertPending(pendingFrom(payload, 0, { status: null, error: null }, false));
    await rememberWoken(messageId);

    const result = await postWithRetry(payload, options.config);
    if (result.ok) {
      await removePending(messageId);
      emitWake(payload, "ok", result.attempts, result.status);
      return;
    }

    const failed = result.attempts >= MAX_ATTEMPTS;
    await upsertPending(
      pendingFrom(
        payload,
        result.attempts,
        { status: result.status, error: result.error },
        failed,
      ),
    );
    emitWake(payload, failed ? "failed" : "queued", result.attempts, result.status);
    logInfo("wake queued", {
      messageId,
      attempts: result.attempts,
      queueDepth: queueDepth(),
    });
  } catch (error) {
    logError("deliver failed", error);
    pushEvent({
      type: "error",
      message_id: messageId,
      channel_id: options.message.channelId,
      text_preview: preview(errorText(error)),
      wake_status: "failed",
      ts: new Date().toISOString(),
    });
  } finally {
    clearInflight(messageId);
  }
}

export async function drainQueue(config: Config): Promise<void> {
  const due = duePending(Date.now());
  for (const item of due) {
    if (isInflight(item.messageId)) {
      continue;
    }
    markInflight(item.messageId);
    try {
      const attempts = item.attempts + 1;
      const result = await postWake(item.payload, config);
      logInfo("queue wake attempt", {
        messageId: item.messageId,
        attempt: attempts,
        status: result.status,
        ok: result.ok,
      });

      if (result.ok) {
        await removePending(item.messageId);
        emitWake(item.payload, "ok", attempts, result.status);
        continue;
      }

      const failed = attempts >= MAX_ATTEMPTS;
      await upsertPending(
        pendingFrom(
          item.payload,
          attempts,
          { status: result.status, error: result.error },
          failed,
        ),
      );
      emitWake(item.payload, failed ? "failed" : "retrying", attempts, result.status);
    } catch (error) {
      logError("queue drain failed", error);
      pushEvent({
        type: "error",
        message_id: item.messageId,
        channel_id: item.payload.channel_id,
        text_preview: preview(errorText(error)),
        ts: new Date().toISOString(),
      });
    } finally {
      clearInflight(item.messageId);
    }
  }
}
