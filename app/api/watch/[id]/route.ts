import { checkWatchKey, getWatchJob, toPublicWatchJob } from "@/lib/watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = checkWatchKey(request);
  if (denied) {
    return denied;
  }

  const { id } = await context.params;
  const found = await getWatchJob(id);
  if (found.state === "unavailable") {
    return new Response("store unavailable", { status: 500 });
  }
  if (found.state === "missing") {
    return new Response("not found", { status: 404 });
  }

  return Response.json(toPublicWatchJob(found.job));
}
