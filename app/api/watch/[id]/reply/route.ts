import { completeWatchJob, getWatchJob, isWatchReplyAuthorized, parseWatchReply } from "@/lib/watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const found = await getWatchJob(id);
  if (found.state === "unavailable") {
    return new Response("store unavailable", { status: 500 });
  }
  if (found.state === "missing") {
    return new Response("not found", { status: 404 });
  }
  const job = found.job;

  if (!(await isWatchReplyAuthorized(request, job))) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const result = parseWatchReply(body);
  if (!result) {
    return new Response("invalid reply", { status: 400 });
  }

  const updated = await completeWatchJob(job, result);
  if (!updated) {
    return new Response("store unavailable", { status: 500 });
  }

  return Response.json({ id: updated.id, status: updated.status });
}
