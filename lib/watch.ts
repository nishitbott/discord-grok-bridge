import { randomBytes } from "node:crypto";

import { WAKE_TIMEOUT_MS } from "@/lib/gateway/constants";
import { loadGatewayConfig } from "@/lib/gateway/config";
import { bearerToken } from "@/lib/ingest";
import { constantTimeEqual, sha256Hex } from "@/lib/session";
import { getRedis } from "@/lib/store";

const HISTORY_KEY = "dgb:watch:history";
const HISTORY_CAP = 50;
const HISTORY_PAGE = 20;
const JOB_TTL_SEC = 24 * 60 * 60;
const JOB_ID_PATTERN = /^[0-9a-f]{32}$/;

const WATCH_INSTRUCTIONS =
  'This came from Nishit\'s Wear OS watch, not Discord. Do NOT post in Discord. Answer concisely (watch screen, <=600 chars ideal) and POST JSON {"reply":"..."} to reply_url with header Authorization: Bearer <reply_token>.';

export type WatchJobStatus = "pending" | "done" | "error";

export interface WatchJob {
  id: string;
  prompt: string;
  status: WatchJobStatus;
  reply?: string;
  error?: string;
  created_at: string;
  updated_at: string;
  reply_token_hash: string;
}

export interface WatchJobPublic {
  id: string;
  prompt: string;
  status: WatchJobStatus;
  reply?: string;
  error?: string;
  created_at: string;
  updated_at: string;
}

export interface WatchJobSummary {
  id: string;
  prompt: string;
  status: WatchJobStatus;
  reply?: string;
  created_at: string;
}

interface WatchWakeBody {
  source: "watch";
  job_id: string;
  text: string;
  author: "nishit (watch)";
  ts: string;
  reply_url: string;
  reply_token: string;
  instructions: string;
}

function jobKey(id: string): string {
  return `dgb:watch:job:${id}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function asNonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isStatus(value: unknown): value is WatchJobStatus {
  return value === "pending" || value === "done" || value === "error";
}

function unauthorized(): Response {
  return new Response("unauthorized", { status: 401 });
}

export function checkWatchKey(req: Request): Response | null {
  const expected = process.env.WATCH_API_KEY ?? "";
  const token = bearerToken(req);
  if (!expected || !token || !constantTimeEqual(token, expected)) {
    return unauthorized();
  }
  return null;
}

export async function isWatchReplyAuthorized(req: Request, job: WatchJob): Promise<boolean> {
  const token = bearerToken(req);
  if (!token) {
    return false;
  }

  const watchKey = process.env.WATCH_API_KEY ?? "";
  if (watchKey && constantTimeEqual(token, watchKey)) {
    return true;
  }

  const hash = await sha256Hex(token);
  return constantTimeEqual(hash, job.reply_token_hash);
}

export function watchRequestOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwardedHost && !/[\s/\\]/.test(forwardedHost)) {
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const proto = forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : "https";
    return `${proto}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}

export function parseWatchPrompt(body: unknown): string | null {
  if (!isRecord(body) || typeof body.prompt !== "string") {
    return null;
  }
  if (body.prompt.length < 1 || body.prompt.length > 4000) {
    return null;
  }
  return body.prompt;
}

export function parseWatchReply(body: unknown): { reply: string } | { error: string } | null {
  if (!isRecord(body)) {
    return null;
  }
  if (typeof body.reply === "string" && body.reply.length > 0) {
    return { reply: body.reply };
  }
  if (typeof body.error === "string" && body.error.length > 0) {
    return { error: body.error };
  }
  return null;
}

function parseJob(value: unknown): WatchJob | null {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  if (!isRecord(parsed)) {
    return null;
  }

  const id = asNonEmpty(parsed.id);
  const prompt = asNonEmpty(parsed.prompt);
  const createdAt = asNonEmpty(parsed.created_at);
  const updatedAt = asNonEmpty(parsed.updated_at);
  const replyTokenHash = asNonEmpty(parsed.reply_token_hash);
  if (!id || !prompt || !createdAt || !updatedAt || !replyTokenHash || !isStatus(parsed.status)) {
    return null;
  }
  if (!JOB_ID_PATTERN.test(id)) {
    return null;
  }

  const job: WatchJob = {
    id,
    prompt,
    status: parsed.status,
    created_at: createdAt,
    updated_at: updatedAt,
    reply_token_hash: replyTokenHash,
  };
  const reply = asNonEmpty(parsed.reply);
  const error = asNonEmpty(parsed.error);
  if (reply) {
    job.reply = reply;
  }
  if (error) {
    job.error = error;
  }
  return job;
}

export function toPublicWatchJob(job: WatchJob): WatchJobPublic {
  const publicJob: WatchJobPublic = {
    id: job.id,
    prompt: job.prompt,
    status: job.status,
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
  if (job.reply !== undefined) {
    publicJob.reply = job.reply;
  }
  if (job.error !== undefined) {
    publicJob.error = job.error;
  }
  return publicJob;
}

function toSummary(job: WatchJob): WatchJobSummary {
  const summary: WatchJobSummary = {
    id: job.id,
    prompt: job.prompt,
    status: job.status,
    created_at: job.created_at,
  };
  if (job.reply !== undefined) {
    summary.reply = job.reply;
  }
  return summary;
}

async function writeJob(job: WatchJob): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    return false;
  }
  try {
    await redis.set(jobKey(job.id), JSON.stringify(job), { ex: JOB_TTL_SEC });
    return true;
  } catch {
    console.error("Failed to save watch job");
    return false;
  }
}

async function pushHistory(id: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    return false;
  }
  try {
    await redis.lpush(HISTORY_KEY, id);
    await redis.ltrim(HISTORY_KEY, 0, HISTORY_CAP - 1);
    return true;
  } catch {
    console.error("Failed to record watch history");
    return false;
  }
}

export type WatchJobLookup =
  | { state: "ok"; job: WatchJob }
  | { state: "missing" }
  | { state: "unavailable" };

export async function getWatchJob(id: string): Promise<WatchJobLookup> {
  if (!JOB_ID_PATTERN.test(id)) {
    return { state: "missing" };
  }
  const redis = getRedis();
  if (!redis) {
    return { state: "unavailable" };
  }
  try {
    const job = parseJob(await redis.get<string>(jobKey(id)));
    return job ? { state: "ok", job } : { state: "missing" };
  } catch {
    console.error("Failed to read watch job");
    return { state: "unavailable" };
  }
}

export async function listWatchJobs(): Promise<WatchJobSummary[] | null> {
  const redis = getRedis();
  if (!redis) {
    return null;
  }

  try {
    const ids = await redis.lrange<string>(HISTORY_KEY, 0, HISTORY_PAGE - 1);
    const jobs = await Promise.all(
      ids.map(async (id) => {
        if (typeof id !== "string" || !JOB_ID_PATTERN.test(id)) {
          return null;
        }
        return parseJob(await redis.get<string>(jobKey(id)));
      }),
    );
    const summaries: WatchJobSummary[] = [];
    for (const job of jobs) {
      if (job) {
        summaries.push(toSummary(job));
      }
    }
    return summaries;
  } catch {
    console.error("Failed to list watch jobs");
    return null;
  }
}

async function postWatchWake(payload: WatchWakeBody): Promise<{ ok: boolean; error: string }> {
  const { wakeUrl, wakeKey } = loadGatewayConfig();
  if (!wakeUrl || !wakeKey) {
    return { ok: false, error: "wake endpoint is not configured" };
  }

  try {
    const response = await fetch(wakeUrl, {
      method: "POST",
      signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${wakeKey}`,
        "X-Automation-Key": wakeKey,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    return { ok: true, error: "" };
  } catch {
    return { ok: false, error: "network error" };
  }
}

export async function createWatchJob(
  prompt: string,
  origin: string,
): Promise<{ id: string; status: WatchJobStatus } | null> {
  const redis = getRedis();
  if (!redis) {
    return null;
  }

  const id = randomBytes(16).toString("hex");
  const replyToken = randomBytes(24).toString("hex");
  const now = new Date().toISOString();
  const job: WatchJob = {
    id,
    prompt,
    status: "pending",
    created_at: now,
    updated_at: now,
    reply_token_hash: await sha256Hex(replyToken),
  };

  if (!(await writeJob(job))) {
    return null;
  }
  if (!(await pushHistory(id))) {
    try {
      await redis.del(jobKey(id));
    } catch {
      console.error("Failed to remove watch job after history error");
    }
    return null;
  }

  const wake = await postWatchWake({
    source: "watch",
    job_id: id,
    text: prompt,
    author: "nishit (watch)",
    ts: now,
    reply_url: `${origin}/api/watch/${id}/reply`,
    reply_token: replyToken,
    instructions: WATCH_INSTRUCTIONS,
  });

  if (!wake.ok) {
    job.status = "error";
    job.error = wake.error;
    job.updated_at = new Date().toISOString();
    await writeJob(job);
    return { id, status: "error" };
  }

  return { id, status: job.status };
}

export async function completeWatchJob(
  job: WatchJob,
  result: { reply: string } | { error: string },
): Promise<WatchJob | null> {
  if ("reply" in result && job.status === "done" && job.reply === result.reply) {
    return job;
  }
  if ("error" in result && job.status === "error" && job.error === result.error && !job.reply) {
    return job;
  }

  const next: WatchJob = {
    id: job.id,
    prompt: job.prompt,
    created_at: job.created_at,
    updated_at: new Date().toISOString(),
    reply_token_hash: job.reply_token_hash,
    status: "reply" in result ? "done" : "error",
  };
  if ("reply" in result) {
    next.reply = result.reply;
  } else {
    next.error = result.error;
  }

  if (!(await writeJob(next))) {
    return null;
  }
  return next;
}
