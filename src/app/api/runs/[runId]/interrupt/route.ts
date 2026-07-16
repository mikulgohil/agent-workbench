import { getRun } from "@/lib/run/manager";

export const dynamic = "force-dynamic";

/** Stop button: aborts the run's Agent SDK session (docs/blueprint/06-execution-model.md: interrupt). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await params;
  const handle = getRun(runId);
  if (!handle) return Response.json({ error: "run not found" }, { status: 404 });
  if (!handle.control) return Response.json({ error: "this run cannot be interrupted" }, { status: 400 });
  handle.control.abortController.abort();
  return Response.json({ ok: true });
}
