import { commitAll, removeWorktree } from "@/lib/git/worktree";
import { readTicket, setTicketStatus } from "@/lib/forge/store";
import { getProjectDir } from "@/lib/project";
import { findLatestRunForTicket } from "@/lib/run/manager";

export const dynamic = "force-dynamic";

/**
 * Approval (docs/blueprint/06-execution-model.md): the app's own commit
 * step is the sole authority for what lands, run unconditionally even
 * if the agent already committed mid-session; worktree removed, branch
 * kept for the developer to merge/push manually.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  let projectDir: string;
  try {
    projectDir = getProjectDir();
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }

  const ticket = await readTicket(projectDir, id);
  if (!ticket) return Response.json({ error: "ticket not found" }, { status: 404 });
  if (ticket.status !== "review") {
    return Response.json({ error: `ticket is not awaiting review (status: ${ticket.status})` }, { status: 400 });
  }

  const handle = findLatestRunForTicket(id);
  const worktreePath = handle?.run.worktreePath ?? null;
  if (worktreePath) {
    await commitAll(worktreePath, `${ticket.type}: ${ticket.title}\n\nTicket: ${ticket.id}`);
    await removeWorktree(projectDir, worktreePath);
  }

  await setTicketStatus(projectDir, id, "done");
  return Response.json({ ok: true });
}
