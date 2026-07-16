import { getRun } from "@/lib/run/manager";

export const dynamic = "force-dynamic";

interface SteerBody {
  message?: unknown;
}

/** Pushes a chat message onto a running session's input stream (docs/blueprint/06-execution-model.md: steer). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await params;
  const parsed: unknown = await req.json().catch(() => null);
  const body = (typeof parsed === "object" && parsed !== null ? parsed : {}) as SteerBody;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length === 0) return Response.json({ error: "message must not be empty" }, { status: 400 });

  const handle = getRun(runId);
  if (!handle) return Response.json({ error: "run not found" }, { status: 404 });
  if (!handle.control) return Response.json({ error: "this run cannot be steered" }, { status: 400 });
  handle.control.channel.push(message);
  return Response.json({ ok: true });
}
