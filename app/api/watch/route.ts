import {
  checkWatchKey,
  createWatchJob,
  listWatchJobs,
  parseWatchPrompt,
  watchRequestOrigin,
} from "@/lib/watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = checkWatchKey(request);
  if (denied) {
    return denied;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const prompt = parseWatchPrompt(body);
  if (!prompt) {
    return new Response("invalid prompt", { status: 400 });
  }

  const created = await createWatchJob(prompt, watchRequestOrigin(request));
  if (!created) {
    return new Response("store unavailable", { status: 500 });
  }

  return Response.json({ id: created.id, status: created.status }, { status: 202 });
}

export async function GET(request: Request) {
  const denied = checkWatchKey(request);
  if (denied) {
    return denied;
  }

  const jobs = await listWatchJobs();
  if (!jobs) {
    return new Response("store unavailable", { status: 500 });
  }

  return Response.json(jobs);
}
