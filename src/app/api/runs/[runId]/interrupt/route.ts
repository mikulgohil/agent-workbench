import { getRun } from "@/lib/run/manager";
import { getProjectDir } from "@/lib/project";
import { readTicket } from "@/lib/forge/store";
import { appendAuditEvent } from "@/lib/audit";

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

  const projectDir = getProjectDir();
  const ticket = await readTicket(projectDir, handle.run.ticketId);
  if (ticket) {
    await appendAuditEvent(projectDir, {
      user: ticket.createdBy,
      ticketId: ticket.id,
      kind: "run-interrupted",
      runId,
      detail: "run interrupted",
    });
  }

  return Response.json({ ok: true });
}
