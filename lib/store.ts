import { randomBytes } from "node:crypto";
import { Redis } from "@upstash/redis";

import { sha256Hex } from "@/lib/session";
import type {
  ApiKeyRecord,
  AttemptRecord,
  AttemptStatus,
  InteractionRecord,
  WakeStatus,
} from "@/lib/types";
import { ATTEMPT_STATUSES, WAKE_STATUSES } from "@/lib/types";

const INTERACTIONS_LIST = "dgb:interactions";
const API_KEYS_LIST = "dgb:api-keys";
const LIST_CAP = 200;

let client: Redis | null = null;

function credentials(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    return null;
  }
  return { url, token };
}

export function isStoreConfigured(): boolean {
  return credentials() !== null;
}

function getRedis(): Redis | null {
  const creds = credentials();
  if (!creds) {
    return null;
  }
  if (!client) {
    client = new Redis({
      url: creds.url,
      token: creds.token,
      automaticDeserialization: false,
    });
  }
  return client;
}

function interactionKey(id: string): string {
  return `dgb:interaction:${id}`;
}

function apiKeyKey(hash: string): string {
  return `dgb:api-key:${hash}`;
}

export async function isStoreReachable(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    return false;
  }
  try {
    const result = await redis.ping();
    return result === "PONG";
  } catch {
    return false;
  }
}

export async function saveInteraction(record: InteractionRecord): Promise<void> {
  const redis = getRedis();
  if (!redis || !record.id) {
    return;
  }

  try {
    await redis.hset(interactionKey(record.id), toInteractionHash(record));
    await redis.lpush(INTERACTIONS_LIST, record.id);
    const overflow: unknown = await redis.lindex(INTERACTIONS_LIST, LIST_CAP);
    await redis.ltrim(INTERACTIONS_LIST, 0, LIST_CAP - 1);
    if (typeof overflow === "string" && overflow.length > 0 && overflow !== record.id) {
      await redis.del(interactionKey(overflow));
    }
  } catch {
    console.error("Failed to save interaction", { interactionId: record.id });
  }
}

export async function updateInteraction(record: InteractionRecord): Promise<void> {
  const redis = getRedis();
  if (!redis || !record.id) {
    return;
  }

  try {
    await redis.hset(interactionKey(record.id), toInteractionHash(record));
  } catch {
    console.error("Failed to update interaction", { interactionId: record.id });
  }
}

export async function listInteractions(limit = 20): Promise<InteractionRecord[]> {
  const redis = getRedis();
  if (!redis) {
    return [];
  }

  try {
    const ids = await redis.lrange<string>(INTERACTIONS_LIST, 0, limit - 1);
    const records: InteractionRecord[] = [];
    for (const id of ids) {
      if (typeof id !== "string" || !id) {
        continue;
      }
      const hash = await redis.hgetall<Record<string, string>>(interactionKey(id));
      const record = hash ? parseInteraction(hash) : null;
      if (record) {
        records.push(record);
      }
    }
    return records;
  } catch {
    console.error("Failed to list interactions");
    return [];
  }
}

export async function createApiKey(name: string): Promise<string> {
  const redis = getRedis();
  if (!redis) {
    throw new Error("Redis is not configured");
  }

  const raw = `dgb_${randomBytes(32).toString("hex")}`;
  const hash = await sha256Hex(raw);
  const record: ApiKeyRecord = {
    hash,
    prefix: raw.slice(0, 8),
    name,
    createdAt: new Date().toISOString(),
    revoked: false,
  };

  await redis.hset(apiKeyKey(hash), toApiKeyHash(record));
  await redis.lpush(API_KEYS_LIST, hash);
  return raw;
}

export async function listApiKeys(): Promise<ApiKeyRecord[]> {
  const redis = getRedis();
  if (!redis) {
    return [];
  }

  try {
    const hashes = await redis.lrange<string>(API_KEYS_LIST, 0, -1);
    const records: ApiKeyRecord[] = [];
    for (const hash of hashes) {
      if (typeof hash !== "string" || !hash) {
        continue;
      }
      const data = await redis.hgetall<Record<string, string>>(apiKeyKey(hash));
      const record = data ? parseApiKey(data) : null;
      if (record) {
        records.push(record);
      }
    }
    return records;
  } catch {
    console.error("Failed to list API keys");
    return [];
  }
}

export async function revokeApiKey(hash: string): Promise<void> {
  const redis = getRedis();
  if (!redis || !/^[0-9a-f]{64}$/i.test(hash)) {
    return;
  }

  try {
    const data = await redis.hgetall<Record<string, string>>(apiKeyKey(hash));
    const record = data ? parseApiKey(data) : null;
    if (!record) {
      return;
    }
    record.revoked = true;
    await redis.hset(apiKeyKey(hash), toApiKeyHash(record));
  } catch {
    console.error("Failed to revoke API key");
  }
}

function toInteractionHash(record: InteractionRecord): Record<string, string> {
  return {
    id: record.id,
    userId: record.userId,
    username: record.username,
    question: record.question,
    channelId: record.channelId,
    guildId: record.guildId,
    receivedAt: record.receivedAt,
    wakeStatus: record.wakeStatus,
    attempts: JSON.stringify(record.attempts),
  };
}

function toApiKeyHash(record: ApiKeyRecord): Record<string, string> {
  return {
    hash: record.hash,
    prefix: record.prefix,
    name: record.name,
    createdAt: record.createdAt,
    revoked: record.revoked ? "true" : "false",
  };
}

function parseInteraction(hash: Record<string, string>): InteractionRecord | null {
  const id = asString(hash.id);
  if (!id) {
    return null;
  }

  const wakeStatus = asWakeStatus(hash.wakeStatus);
  return {
    id,
    userId: asString(hash.userId),
    username: asString(hash.username),
    question: asString(hash.question),
    channelId: asString(hash.channelId),
    guildId: asString(hash.guildId),
    receivedAt: asString(hash.receivedAt),
    wakeStatus,
    attempts: parseAttempts(hash.attempts),
  };
}

function parseApiKey(hash: Record<string, string>): ApiKeyRecord | null {
  const keyHash = asString(hash.hash);
  const name = asString(hash.name);
  if (!keyHash || !name) {
    return null;
  }

  return {
    hash: keyHash,
    prefix: asString(hash.prefix),
    name,
    createdAt: asString(hash.createdAt),
    revoked: asString(hash.revoked) === "true",
  };
}

function parseAttempts(value: unknown): AttemptRecord[] {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  if (!Array.isArray(parsed)) {
    return [];
  }

  const attempts: AttemptRecord[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const status = row.status;
    if (!isAttemptStatus(status)) {
      continue;
    }
    const attempt = Number(row.attempt);
    if (!Number.isFinite(attempt)) {
      continue;
    }
    const httpStatus =
      row.httpStatus === null || row.httpStatus === undefined || row.httpStatus === ""
        ? null
        : Number(row.httpStatus);

    attempts.push({
      attempt,
      httpStatus: httpStatus !== null && Number.isFinite(httpStatus) ? httpStatus : null,
      error: typeof row.error === "string" && row.error.length > 0 ? row.error : null,
      timestamp: typeof row.timestamp === "string" ? row.timestamp : "",
      status,
    });
  }
  return attempts;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asWakeStatus(value: unknown): WakeStatus {
  return isWakeStatus(value) ? value : "pending";
}

function isWakeStatus(value: unknown): value is WakeStatus {
  return typeof value === "string" && WAKE_STATUSES.some((status) => status === value);
}

function isAttemptStatus(value: unknown): value is AttemptStatus {
  return typeof value === "string" && ATTEMPT_STATUSES.some((status) => status === value);
}
