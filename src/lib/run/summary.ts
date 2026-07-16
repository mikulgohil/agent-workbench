import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { forgeDir } from "@/lib/forge/store";
import { APP_VERSION } from "@/lib/version";
import type {
  ApprovalDecision,
  CommandRecord,
  CostRecord,
  FileTouch,
  Gate,
  RunState,
  RunSummary,
} from "@/lib/forge/types";

/**
 * Pure input for building a sanitized RunSummary. `commandsRun` is passed
 * in (see below); the caller sources `filesTouched` from the git
 * `changedFiles` helper and `gates` from the run's last gate pass.
 */
export interface BuildRunSummaryInput {
  id: string;
  ticketId: string;
  state: RunState;
  filesTouched: FileTouch[];
  commandsRun: CommandRecord[];
  gates: Gate[];
  iteration: number;
  cost: CostRecord;
  approval: ApprovalDecision | null;
  startedAt: string;
  endedAt: string;
}

/**
 * Assembles the sanitized, committed RunSummary
 * (docs/blueprint/05-data-model.md). Pure - derives only `durationMs`
 * (endedAt - startedAt) and stamps `appVersion`; every other field is
 * copied straight from the input.
 *
 * KNOWN GAP: `commandsRun` is always passed in as `[]` today. The
 * permission-only Bash path does not capture per-command exit codes or
 * durations, so there is nothing truthful to populate here yet; a future
 * task that parses Bash tool-results will fill it. We never fabricate
 * exit codes.
 */
export function buildRunSummary(input: BuildRunSummaryInput): RunSummary {
  return {
    id: input.id,
    ticketId: input.ticketId,
    state: input.state,
    filesTouched: input.filesTouched,
    commandsRun: input.commandsRun,
    gates: input.gates,
    iteration: input.iteration,
    cost: input.cost,
    approval: input.approval,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs: Date.parse(input.endedAt) - Date.parse(input.startedAt),
    appVersion: APP_VERSION,
  };
}

/**
 * Writes the summary to
 * `.forge/tickets/<ticketId>/runs/<run-id>.summary.json` as pretty JSON
 * with a trailing newline (matching store.ts's writeTicket style). This
 * file IS committed to git, unlike the gitignored full transcript under
 * `.forge/local/runs/`.
 */
export async function writeRunSummary(projectDir: string, ticketId: string, summary: RunSummary): Promise<void> {
  const runsDir = join(forgeDir(projectDir), "tickets", ticketId, "runs");
  await mkdir(runsDir, { recursive: true });
  await writeFile(join(runsDir, `${summary.id}.summary.json`), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}
