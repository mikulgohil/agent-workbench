import { getRun } from "@/lib/run/manager";

export const dynamic = "force-dynamic";

const VALID_DECISIONS = ["continue", "stop"] as const;
type IterationDecision = (typeof VALID_DECISIONS)[number];

function isDecision(value: unknown): value is IterationDecision {
  return typeof value === "string" && (VALID_DECISIONS as readonly string[]).includes(value);
}

/** Resolves the before-iteration-2 gate-feedback cost checkpoint (docs/blueprint/06-execution-model.md: gate-feedback loop). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await params;
  const parsed: unknown = await req.json().catch(() => null);
  const body = (typeof parsed === "object" && parsed !== null ? parsed : {}) as { decision?: unknown };
  if (!isDecision(body.decision)) {
    return Response.json({ error: "decision must be one of continue, stop" }, { status: 400 });
  }

  const handle = getRun(runId);
  if (!handle) return Response.json({ error: "run not found" }, { status: 404 });
  if (!handle.control) return Response.json({ error: "this run has no iteration checkpoint" }, { status: 400 });
  if (handle.view.state !== "awaiting-iteration-approval") {
    return Response.json({ error: "run is not awaiting an iteration decision" }, { status: 400 });
  }
  handle.control.resolveIteration(body.decision);
  return Response.json({ ok: true });
}
