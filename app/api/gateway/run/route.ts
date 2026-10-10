import { randomUUID } from "node:crypto";

import { after } from "next/server";

import { loadGatewayConfig, selfChainEnabled } from "@/lib/gateway/config";
import { CHAIN_ABORT_MS, DETACH_HEADER } from "@/lib/gateway/constants";
import { logError } from "@/lib/gateway/log";
import { originFromRequest } from "@/lib/gateway/origin";
import { assertGatewayConfig, runGatewayWindow } from "@/lib/gateway/run";
import { acquireGatewayLock, releaseGatewayLock } from "@/lib/gateway/state";
import type { GatewayRunSummary } from "@/lib/gateway/types";
import { timingSafeEqualString } from "@/lib/timing";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function shouldDetach(request: Request): boolean {
  if (request.headers.get(DETACH_HEADER) === "1") {
    return true;
  }
  const cronHeader = request.headers.get("x-vercel-cron");
  if (cronHeader === "1" || cronHeader === "true") {
    return true;
  }
  const agent = request.headers.get("user-agent")?.toLowerCase() ?? "";
  return agent.includes("vercel-cron");
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (!secret) {
    return false;
  }
  const header = request.headers.get("authorization")?.trim() ?? "";
  return timingSafeEqualString(header, `Bearer ${secret}`);
}

async function kickoffNextWindow(request: Request): Promise<void> {
  if (!selfChainEnabled()) {
    return;
  }
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return;
  }

  const url = `${originFromRequest(request)}/api/gateway/run`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAIN_ABORT_MS);
  try {
    await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${secret}`,
        [DETACH_HEADER]: "1",
      },
      signal: controller.signal,
    });
  } catch {
    // The abort cap is intentional. A detached window keeps running after it answers.
  } finally {
    clearTimeout(timer);
  }
}

async function finishWindow(runId: string): Promise<GatewayRunSummary> {
  try {
    return await runGatewayWindow(runId);
  } finally {
    await releaseGatewayLock(runId);
  }
}

async function handle(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return new Response("unauthorized", { status: 401 });
  }

  const configError = assertGatewayConfig(loadGatewayConfig());
  if (configError) {
    return Response.json(
      { error: configError, processed: 0, woken: 0, backfilled: 0, duration: 0 },
      { status: 500 },
    );
  }

  const runId = randomUUID();
  const lock = await acquireGatewayLock(runId);
  if (lock === "unavailable") {
    return Response.json(
      { error: "store unavailable", processed: 0, woken: 0, backfilled: 0, duration: 0 },
      { status: 500 },
    );
  }
  if (lock === "held") {
    return Response.json({ skipped: true });
  }

  const detach = shouldDetach(request);
  if (detach) {
    after(async () => {
      try {
        await finishWindow(runId);
      } catch (error) {
        logError("gateway run failed", error);
        await releaseGatewayLock(runId);
        return;
      }
      await kickoffNextWindow(request);
    });
    return Response.json({ accepted: true });
  }

  try {
    const summary = await finishWindow(runId);
    after(() => kickoffNextWindow(request));
    return Response.json(summary);
  } catch (error) {
    logError("gateway run failed", error);
    await releaseGatewayLock(runId);
    return Response.json(
      { error: "gateway run failed", processed: 0, woken: 0, backfilled: 0, duration: 0 },
      { status: 500 },
    );
  }
}

export function GET(request: Request): Promise<Response> {
  return handle(request);
}

export function POST(request: Request): Promise<Response> {
  return handle(request);
}
