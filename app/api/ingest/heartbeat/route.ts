import { bearerToken, parseHeartbeat } from "@/lib/ingest";
import { authorizeApiKey, saveHeartbeat } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token || !(await authorizeApiKey(token))) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const heartbeat = parseHeartbeat(body);
  if (!heartbeat) {
    return new Response("invalid heartbeat", { status: 400 });
  }

  const saved = await saveHeartbeat({
    ...heartbeat,
    receivedAt: new Date().toISOString(),
  });
  if (!saved) {
    return new Response("store unavailable", { status: 500 });
  }

  return Response.json({ ok: true });
}
