import { randomBytes } from "node:crypto";
import { Redis } from "@upstash/redis";

import { parseStoredEvent } from "@/lib/ingest";
import { sha256Hex } from "@/lib/session";
import type { ApiKeyRecord, HeartbeatRecord, ListenerEvent, ListenerSource } from "@/lib/types";
import { EVENT_LIST_CAP } from "@/lib/types";

const API_KEYS_LIST = "dgb:api-keys";
const HEARTBEAT_KEY = "dgb:listener:heartbeat";
const EVENTS_LIST = "dgb:listener:events";

let client: Redis | null = null;

function credentials(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    return null;
  }
  return { url, token };
}

export function isStoreConfigured(): boolean {
  return credentials() !== null;
}

export function getRedis(): Redis | null {
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

export async function authorizeApiKey(rawKey: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis || !rawKey) {
    return false;
  }

  try {
    const hash = await sha256Hex(rawKey);
    const data = await redis.hgetall<Record<string, string>>(apiKeyKey(hash));
    const record = data ? parseApiKey(data) : null;
    if (!record || record.revoked) {
      return false;
    }
    record.lastUsedAt = new Date().toISOString();
    try {
      await redis.hset(apiKeyKey(hash), toApiKeyHash(record));
    } catch {
      console.error("Failed to update API key lastUsedAt");
    }
    return true;
  } catch {
    console.error("Failed to authorize API key");
    return false;
  }
}

export async function saveHeartbeat(record: HeartbeatRecord): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    return false;
  }
  try {
    await redis.set(HEARTBEAT_KEY, JSON.stringify(record));
    return true;
  } catch {
    console.error("Failed to save listener heartbeat");
    return false;
  }
}

export async function getHeartbeat(): Promise<HeartbeatRecord | null> {
  const redis = getRedis();
  if (!redis) {
    return null;
  }
  try {
    const raw = await redis.get<string>(HEARTBEAT_KEY);
    return parseHeartbeatRecord(raw);
  } catch {
    console.error("Failed to read listener heartbeat");
    return null;
  }
}

export async function saveEvents(events: ListenerEvent[]): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    return false;
  }
  if (events.length === 0) {
    return true;
  }

  try {
    for (const event of events) {
      await redis.lpush(EVENTS_LIST, JSON.stringify(event));
    }
    await redis.ltrim(EVENTS_LIST, 0, EVENT_LIST_CAP - 1);
    return true;
  } catch {
    console.error("Failed to save listener events");
    return false;
  }
}

export async function listEvents(limit = EVENT_LIST_CAP): Promise<ListenerEvent[]> {
  const redis = getRedis();
  if (!redis) {
    return [];
  }

  try {
    const rows = await redis.lrange<string>(EVENTS_LIST, 0, Math.max(0, limit - 1));
    const events: ListenerEvent[] = [];
    for (const row of rows) {
      const event = parseStoredEvent(row);
      if (event) {
        events.push(event);
      }
    }
    return events;
  } catch {
    console.error("Failed to list listener events");
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

function toApiKeyHash(record: ApiKeyRecord): Record<string, string> {
  const hash: Record<string, string> = {
    hash: record.hash,
    prefix: record.prefix,
    name: record.name,
    createdAt: record.createdAt,
    revoked: record.revoked ? "true" : "false",
  };
  if (record.lastUsedAt) {
    hash.lastUsedAt = record.lastUsedAt;
  }
  return hash;
}

function parseApiKey(hash: Record<string, string>): ApiKeyRecord | null {
  const keyHash = asString(hash.hash);
  const name = asString(hash.name);
  if (!keyHash || !name) {
    return null;
  }

  const lastUsedAt = asString(hash.lastUsedAt);
  return {
    hash: keyHash,
    prefix: asString(hash.prefix),
    name,
    createdAt: asString(hash.createdAt),
    revoked: asString(hash.revoked) === "true",
    ...(lastUsedAt ? { lastUsedAt } : {}),
  };
}

function parseHeartbeatRecord(value: unknown): HeartbeatRecord | null {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const row = parsed as Record<string, unknown>;
  const uptime = Number(row.uptime_s);
  const ping = Number(row.ws_ping);
  const guilds = Number(row.guilds);
  const depth = Number(row.queue_depth);
  if (![uptime, ping, guilds, depth].every(Number.isFinite)) {
    return null;
  }
  const ts = asString(row.ts);
  const receivedAt = asString(row.receivedAt) || ts;
  if (!ts || !receivedAt) {
    return null;
  }
  const source = parseListenerSource(row.source);
  return {
    uptime_s: uptime,
    ws_ping: ping,
    guilds,
    queue_depth: depth,
    version: asString(row.version),
    ts,
    receivedAt,
    ...(source ? { source } : {}),
  };
}

function parseListenerSource(value: unknown): ListenerSource | undefined {
  return value === "vercel" || value === "railway" ? value : undefined;
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
