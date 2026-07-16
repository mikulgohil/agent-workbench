import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { forgeDir } from "@/lib/forge/store";
import { isTerminalState } from "@/lib/forge/types";
import { readLastRunState, type RunStateLine } from "./persist";

export interface OrphanedRun {
  ticketId: string;
  runId: string;
  state: RunStateLine;
}

async function listDirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Scans .forge/local/runs/ for runs whose last persisted state is
 * non-terminal but which have no live in-memory tracker in the current
 * process (docs/blueprint/06-execution-model.md: janitor on launch).
 * Orphaned runs with no state record at all (crash before any state
 * line was written) are a separate janitor case, handled at the UI
 * layer by listing worktree directories with no matching ticket/run.
 */
export async function findOrphanedRuns(projectDir: string, liveRunIds: Set<string>): Promise<OrphanedRun[]> {
  const runsDir = join(forgeDir(projectDir), "local", "runs");
  const orphans: OrphanedRun[] = [];
  for (const ticketId of await listDirs(runsDir)) {
    const ticketRunsDir = join(runsDir, ticketId);
    let runFiles: string[];
    try {
      runFiles = (await readdir(ticketRunsDir)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of runFiles) {
      const runId = file.replace(/\.jsonl$/, "");
      if (liveRunIds.has(runId)) continue;
      const state = await readLastRunState(projectDir, ticketId, runId);
      if (!state || isTerminalState(state.state)) continue;
      orphans.push({ ticketId, runId, state });
    }
  }
  return orphans;
}
