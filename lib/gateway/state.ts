import type { Redis } from "@upstash/redis";

import {
  FAILED_QUEUE_CAP,
  LAST_SEEN_KEY,
  LOCK_KEY,
  LOCK_TTL_MS,
  RETRY_KEY,
  WOKEN_CAP,
  WOKEN_KEY,
  WOKEN_TTL_MS,
  WOKEN_TTL_SEC,
} from "@/lib/gateway/constants";
import { logError } from "@/lib/gateway/log";
import { isNewer } from "@/lib/gateway/snowflake";
import type { GatewayLockView, PendingWake, WakePayload } from "@/lib/gateway/types";
import { getRedis } from "@/lib/store";

let tail: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRedisString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parsePending(value: unknown): PendingWake | null {
  if (!isRecord(value)) {
    return null;
  }
  const payload = value.payload;
  if (!isRecord(payload)) {
    return null;
  }
  const messageId = asString(value.messageId) || asString(payload.message_id);
  if (!messageId || !asString(payload.channel_id) || !asString(payload.text)) {
    return null;
  }
  const attempts = Number(value.attempts);
  return {
    messageId,
    payload: payload as unknown as WakePayload,
    attempts: Number.isFinite(attempts) ? attempts : 0,
    nextAttemptAt: asString(value.nextAttemptAt) || new Date(0).toISOString(),
    lastStatus:
      value.lastStatus === null || value.lastStatus === undefined
        ? null
        : Number.isFinite(Number(value.lastStatus))
          ? Number(value.lastStatus)
          : null,
    lastError: asString(value.lastError) || null,
    failed: value.failed === true,
  };
}

function compact(items: PendingWake[]): PendingWake[] {
  const active = items.filter((item) => !item.failed);
  const failed = items.filter((item) => item.failed).slice(-FAILED_QUEUE_CAP);
  return [...active, ...failed];
}

async function readQueue(redis: Redis): Promise<PendingWake[]> {
  const rows = await redis.lrange(RETRY_KEY, 0, -1);
  if (!Array.isArray(rows)) {
    return [];
  }
  const items: PendingWake[] = [];
  for (const row of rows) {
    const parsed = typeof row === "string" ? safeJson(row) : row;
    const item = parsePending(parsed);
    if (item) {
      items.push(item);
    }
  }
  return items;
}

async function writeQueue(redis: Redis, items: PendingWake[]): Promise<void> {
  const next = compact(items);
  const pipeline = redis.pipeline();
  pipeline.del(RETRY_KEY);
  if (next.length > 0) {
    pipeline.rpush(
      RETRY_KEY,
      ...next.map((item) => JSON.stringify(item)),
    );
  }
  await pipeline.exec();
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export async function acquireGatewayLock(runId: string): Promise<"acquired" | "held" | "unavailable"> {
  const redis = getRedis();
  if (!redis) {
    return "unavailable";
  }
  try {
    const result = await redis.set(LOCK_KEY, runId, { nx: true, px: LOCK_TTL_MS });
    if (result === "OK") {
      return "acquired";
    }
    const ttl = Number(await redis.pttl(LOCK_KEY));
    if (Number.isFinite(ttl) && ttl > 0) {
      return "held";
    }
    await redis.set(LOCK_KEY, runId, { px: LOCK_TTL_MS });
    return "acquired";
  } catch (error) {
    logError("lock acquire failed", error);
    return "unavailable";
  }
}

export async function refreshGatewayLock(runId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    return;
  }
  try {
    const current = asRedisString(await redis.get(LOCK_KEY));
    if (current === runId) {
      await redis.pexpire(LOCK_KEY, LOCK_TTL_MS);
    }
  } catch (error) {
    logError("lock refresh failed", error);
  }
}

export async function releaseGatewayLock(runId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    return;
  }
  try {
    const current = asRedisString(await redis.get(LOCK_KEY));
    if (current === runId) {
      await redis.del(LOCK_KEY);
    }
  } catch (error) {
    logError("lock release failed", error);
  }
}

export async function readGatewayLock(): Promise<GatewayLockView | null> {
  const redis = getRedis();
  if (!redis) {
    return null;
  }
  try {
    const holder = asRedisString(await redis.get(LOCK_KEY));
    if (!holder) {
      return null;
    }
    const ttl = Number(await redis.pttl(LOCK_KEY));
    const expiresAt =
      Number.isFinite(ttl) && ttl > 0 ? new Date(Date.now() + ttl).toISOString() : null;
    return { holder, expiresAt };
  } catch (error) {
    logError("lock read failed", error);
    return null;
  }
}

export async function hasWoken(messageId: string): Promise<boolean> {
  return withLock(async () => {
    const redis = getRedis();
    if (!redis) {
      return false;
    }
    const score = asScore(await redis.zscore(WOKEN_KEY, messageId));
    if (score === null) {
      return false;
    }
    if (score < Date.now() - WOKEN_TTL_MS) {
      await redis.zrem(WOKEN_KEY, messageId);
      return false;
    }
    return true;
  });
}

export async function rememberWoken(messageId: string): Promise<void> {
  await withLock(async () => {
    const redis = getRedis();
    if (!redis) {
      return;
    }
    const now = Date.now();
    await redis.zadd(WOKEN_KEY, { score: now, member: messageId });
    await redis.zremrangebyscore(WOKEN_KEY, 0, now - WOKEN_TTL_MS);
    const count = Number(await redis.zcard(WOKEN_KEY));
    if (Number.isFinite(count) && count > WOKEN_CAP) {
      await redis.zremrangebyrank(WOKEN_KEY, 0, count - WOKEN_CAP - 1);
    }
    await redis.expire(WOKEN_KEY, WOKEN_TTL_SEC);
  });
}

export async function getLastSeen(channelId: string): Promise<string | null> {
  return withLock(async () => {
    const redis = getRedis();
    if (!redis) {
      return null;
    }
    return asRedisString(await redis.hget(LAST_SEEN_KEY, channelId));
  });
}

export async function noteSeen(channelId: string, messageId: string): Promise<void> {
  await withLock(async () => {
    const redis = getRedis();
    if (!redis) {
      return;
    }
    const current = asRedisString(await redis.hget(LAST_SEEN_KEY, channelId));
    if (current && !isNewer(messageId, current)) {
      return;
    }
    await redis.hset(LAST_SEEN_KEY, { [channelId]: messageId });
  });
}

export async function queueDepth(): Promise<number> {
  return withLock(async () => {
    const redis = getRedis();
    if (!redis) {
      return 0;
    }
    const items = await readQueue(redis);
    return items.filter((item) => !item.failed).length;
  });
}

export async function duePending(now: number): Promise<PendingWake[]> {
  return withLock(async () => {
    const redis = getRedis();
    if (!redis) {
      return [];
    }
    const items = await readQueue(redis);
    return items.filter((item) => !item.failed && Date.parse(item.nextAttemptAt) <= now);
  });
}

export async function upsertPending(item: PendingWake): Promise<void> {
  await withLock(async () => {
    const redis = getRedis();
    if (!redis) {
      return;
    }
    const items = await readQueue(redis);
    const index = items.findIndex((row) => row.messageId === item.messageId);
    if (index >= 0) {
      items[index] = item;
    } else {
      items.push(item);
    }
    await writeQueue(redis, items);
  });
}

export async function removePending(messageId: string): Promise<void> {
  await withLock(async () => {
    const redis = getRedis();
    if (!redis) {
      return;
    }
    const items = await readQueue(redis);
    const next = items.filter((row) => row.messageId !== messageId);
    if (next.length === items.length) {
      return;
    }
    await writeQueue(redis, next);
  });
}
