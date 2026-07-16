import { join } from "node:path";
import { appendJsonl, readJsonl } from "@/lib/forge/jsonl";
import { forgeDir } from "@/lib/forge/store";
import type { RunState } from "@/lib/forge/types";

export interface RunStateLine {
  type: "state";
  state: RunState;
  sessionId: string | null;
  worktreePath: string | null;
  branch: string | null;
  iteration: number;
  at: string;
}

/**
 * One state line per transition, shared with the full event transcript
 * under the same file (distinguished by "type"), so resume only ever
 * reads one file and takes its last type:"state" line
 * (docs/blueprint/06-execution-model.md: resume after app restart).
 */
export function runTranscriptPath(projectDir: string, ticketId: string, runId: string): string {
  return join(forgeDir(projectDir), "local", "runs", ticketId, `${runId}.jsonl`);
}

export async function appendRunState(
  projectDir: string,
  ticketId: string,
  runId: string,
  line: Omit<RunStateLine, "type" | "at">,
): Promise<void> {
  await appendJsonl(runTranscriptPath(projectDir, ticketId, runId), { type: "state", ...line, at: new Date().toISOString() });
}

export async function readLastRunState(
  projectDir: string,
  ticketId: string,
  runId: string,
): Promise<RunStateLine | null> {
  const lines = await readJsonl<RunStateLine | { type: string }>(runTranscriptPath(projectDir, ticketId, runId));
  const stateLines = lines.filter((line): line is RunStateLine => line.type === "state");
  return stateLines.at(-1) ?? null;
}
