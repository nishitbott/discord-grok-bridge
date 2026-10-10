import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { FAILED_QUEUE_CAP, WOKEN_CAP } from "./config.js";
import { logError } from "./log.js";
import { isNewer } from "./snowflake.js";
import type { PendingWake, WakePayload } from "./types.js";

let dataDir = resolve("./data");
let wokenIds: string[] = [];
const wokenSet = new Set<string>();
const lastSeen = new Map<string, string>();
let pending: PendingWake[] = [];

let tail: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function wokenPath(): string {
  return join(dataDir, "woken.json");
}

function lastSeenPath(): string {
  return join(dataDir, "last_seen.json");
}

function pendingPath(): string {
  return join(dataDir, "pending.jsonl");
}

async function writeJson(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value), "utf8");
  await rename(tmp, file);
}

async function readJson(file: string): Promise<unknown> {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      logError(`could not read ${file}`, error);
    }
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function loadWoken(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.ids)) {
    return [];
  }
  const ids: string[] = [];
  for (const id of value.ids) {
    if (typeof id === "string" && id.length > 0 && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids.slice(-WOKEN_CAP);
}

function loadLastSeen(value: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!isRecord(value)) {
    return map;
  }
  for (const [channelId, messageId] of Object.entries(value)) {
    if (channelId && typeof messageId === "string" && messageId) {
      map.set(channelId, messageId);
    }
  }
  return map;
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

async function readPendingFile(): Promise<PendingWake[]> {
  let raw = "";
  try {
    raw = await readFile(pendingPath(), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      logError("could not read pending queue", error);
    }
    return [];
  }

  const items: PendingWake[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = parsePending(JSON.parse(trimmed) as unknown);
      if (parsed) {
        items.push(parsed);
      }
    } catch {
      logError("skipped corrupt pending queue line");
    }
  }
  return compact(items);
}

function compact(items: PendingWake[]): PendingWake[] {
  const active = items.filter((item) => !item.failed);
  const failed = items.filter((item) => item.failed).slice(-FAILED_QUEUE_CAP);
  return [...active, ...failed];
}

async function persistWoken(): Promise<void> {
  await writeJson(wokenPath(), { ids: wokenIds });
}

async function persistLastSeen(): Promise<void> {
  await writeJson(lastSeenPath(), Object.fromEntries(lastSeen));
}

async function persistPending(): Promise<void> {
  pending = compact(pending);
  const body = pending.map((item) => JSON.stringify(item)).join("\n");
  const tmp = `${pendingPath()}.${process.pid}.tmp`;
  await writeFile(tmp, body.length > 0 ? `${body}\n` : "", "utf8");
  await rename(tmp, pendingPath());
}

export async function initDisk(dir: string): Promise<void> {
  dataDir = resolve(dir);
  await mkdir(dataDir, { recursive: true });
  await withLock(async () => {
    wokenIds = loadWoken(await readJson(wokenPath()));
    wokenSet.clear();
    for (const id of wokenIds) {
      wokenSet.add(id);
    }
    lastSeen.clear();
    for (const [channelId, messageId] of loadLastSeen(await readJson(lastSeenPath()))) {
      lastSeen.set(channelId, messageId);
    }
    pending = await readPendingFile();
  });
}

export function hasWoken(messageId: string): boolean {
  return wokenSet.has(messageId);
}

export async function rememberWoken(messageId: string): Promise<void> {
  await withLock(async () => {
    if (wokenSet.has(messageId)) {
      return;
    }
    wokenSet.add(messageId);
    wokenIds.push(messageId);
    while (wokenIds.length > WOKEN_CAP) {
      const removed = wokenIds.shift();
      if (removed) {
        wokenSet.delete(removed);
      }
    }
    await persistWoken();
  });
}

export function getLastSeen(channelId: string): string | undefined {
  return lastSeen.get(channelId);
}

export async function noteSeen(channelId: string, messageId: string): Promise<void> {
  await withLock(async () => {
    const current = lastSeen.get(channelId);
    if (current && !isNewer(messageId, current)) {
      return;
    }
    lastSeen.set(channelId, messageId);
    await persistLastSeen();
  });
}

export function queueDepth(): number {
  return pending.filter((item) => !item.failed).length;
}

export function duePending(now: number): PendingWake[] {
  return pending.filter((item) => !item.failed && Date.parse(item.nextAttemptAt) <= now);
}

export async function upsertPending(item: PendingWake): Promise<void> {
  await withLock(async () => {
    const index = pending.findIndex((row) => row.messageId === item.messageId);
    if (index >= 0) {
      pending[index] = item;
    } else {
      pending.push(item);
    }
    await persistPending();
  });
}

export async function removePending(messageId: string): Promise<void> {
  await withLock(async () => {
    const next = pending.filter((row) => row.messageId !== messageId);
    if (next.length === pending.length) {
      return;
    }
    pending = next;
    await persistPending();
  });
}
