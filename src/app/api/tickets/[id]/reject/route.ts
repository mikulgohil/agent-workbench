import { commitAll, hasCommitsSinceBase, removeWorktree } from "@/lib/git/worktree";
import { readForgeConfig, readTicket, setTicketStatus } from "@/lib/forge/store";
import { getProjectDir } from "@/lib/project";
import { findLatestRunForTicket } from "@/lib/run/manager";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Rejection (docs/blueprint/06-execution-model.md): same auto-commit as
 * approval so no diff is lost, but the branch is deleted rather than
 * kept when it has zero commits beyond base (nothing worth inspecting).
 *
 * Note: `Run` (src/lib/forge/types.ts) has no `branchName` field - only
 * `worktreePath` - so the branch to possibly delete comes from
 * `ticket.branchName`, which `startAgentRun` (src/lib/run/manager.ts)
 * writes back onto the ticket once the run reaches "review".
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
  const branch = ticket.branchName;
  if (worktreePath) {
    await commitAll(worktreePath, `${ticket.type}: ${ticket.title}\n\nTicket: ${ticket.id}`);
    const config = await readForgeConfig(projectDir);
    const keepBranch = await hasCommitsSinceBase(worktreePath, config.baseBranch);
    await removeWorktree(projectDir, worktreePath);
    if (!keepBranch && branch) {
      await execFileAsync("git", ["branch", "-D", branch], { cwd: projectDir }).catch(() => {});
    }
  }

  await setTicketStatus(projectDir, id, "rejected");
  return Response.json({ ok: true });
}
