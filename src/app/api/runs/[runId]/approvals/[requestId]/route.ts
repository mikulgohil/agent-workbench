import { getRun } from "@/lib/run/manager";

export const dynamic = "force-dynamic";

const VALID_DECISIONS = ["allow", "always", "deny"] as const;
type Decision = (typeof VALID_DECISIONS)[number];

function isDecision(value: unknown): value is Decision {
  return typeof value === "string" && (VALID_DECISIONS as readonly string[]).includes(value);
}

/** Resolves a paused permission_request from the UI's approve/allowlist/deny buttons. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string; requestId: string }> },
): Promise<Response> {
  const { runId, requestId } = await params;
  const parsed: unknown = await req.json().catch(() => null);
  const body = (typeof parsed === "object" && parsed !== null ? parsed : {}) as { decision?: unknown };
  if (!isDecision(body.decision)) {
    return Response.json({ error: "decision must be one of allow, always, deny" }, { status: 400 });
  }

  const handle = getRun(runId);
  if (!handle || !handle.control) return Response.json({ error: "run not found" }, { status: 404 });
  handle.control.resolvePermission(requestId, body.decision);
  return Response.json({ ok: true });
}
