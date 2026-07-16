import { newId, nowIso } from "@/lib/forge/ids";
import { setTicketStatus } from "@/lib/forge/store";
import { isTerminalState } from "@/lib/forge/types";
import type { ForgeConfig, FileTouch, Gate, Run, RunEvent, Ticket } from "@/lib/forge/types";
import { simulateRun } from "@/lib/sim/simulator";
import { initialRunView, reduceRun } from "./reducer";
import type { RunView } from "./reducer";
import { isRealEngineAvailable } from "@/lib/engine";
import { createWorktree, removeWorktree, commitAll, changedFiles } from "@/lib/git/worktree";
import { startInstall, BashGate } from "@/lib/prepare";
import { createPermissionBroker } from "@/lib/permission/broker";
import { resolveBashCommand } from "@/lib/permission/allowlist";
import { UserMessageChannel } from "@/lib/session/channel";
import { mapSdkMessages } from "@/lib/session/map-events";
import { PlanTracker } from "@/lib/session/plan-tracker";
import { CostTracker } from "@/lib/session/cost-tracker";
import { appendAuditEvent } from "@/lib/audit";
import { runGate } from "@/lib/gates";
import { appendRunState } from "./persist";
import { buildRunSummary, writeRunSummary } from "./summary";

/**
 * In-memory registry of runs for the current app process.
 * Phase 1 keeps runs in memory only; Phase 2 adds persistence of the
 * transcript to .forge/local/runs/ so unfinished runs survive an app
 * restart (spec: interrupt, steer, resume) - see Task 13 (Resume/Janitor).
 *
 * The registry hangs off globalThis so Next.js dev-mode module reloads do
 * not orphan running streams.
 */
export interface RunHandle {
  /** The canonical Run record (docs/blueprint/05-data-model.md). */
  run: Run;
  events: RunEvent[];
  /** Derived projection for the Plan & Progress panel. */
  view: RunView;
  /** Resolves when the run has finished and the ticket status is updated. */
  done: Promise<void>;
  /** Only present for real agent runs; used by the permission API route and the interrupt/steer routes (Tasks 12-14). */
  control?: {
    channel: UserMessageChannel;
    resolvePermission: (requestId: string, decision: "allow" | "always" | "deny") => void;
    abortController: AbortController;
  };
}

interface RunRecord extends RunHandle {
  listeners: Set<(event: RunEvent) => void>;
}

const globalRuns = globalThis as unknown as { __workbenchRuns?: Map<string, RunRecord> };

function registry(): Map<string, RunRecord> {
  globalRuns.__workbenchRuns ??= new Map();
  return globalRuns.__workbenchRuns;
}

export interface StartRunOptions {
  delayMs?: number;
}

/**
 * Human-readable text for a non-Bash tool's `permission-request`/audit
 * "command" field, which - per the canonical `RunEvent` union - has no
 * generic toolName/input fields, only a Bash-flavored `command: string`.
 * This is display text only (never parsed), so a best-effort description
 * is fine: prefer the file the tool targets when one is present, else
 * fall back to the bare tool name.
 */
function describeToolRequest(toolName: string, input: Record<string, unknown>): string {
  const target = input.file_path ?? input.path;
  return typeof target === "string" ? `${toolName}(${target})` : toolName;
}

function applyEvent(record: RunRecord, event: RunEvent): void {
  record.events.push(event);
  record.view = reduceRun(record.view, event);
  record.run = {
    ...record.run,
    state: record.view.state,
    sessionId: event.kind === "run-started" ? event.sessionId : record.run.sessionId,
  };
  for (const listener of record.listeners) listener(event);
}

export function startSimulatedRun(
  projectDir: string,
  ticket: Ticket,
  options: StartRunOptions = {},
): RunHandle {
  const runId = newId("run");
  const record: RunRecord = {
    run: {
      id: runId,
      ticketId: ticket.id,
      state: "preparing",
      sessionId: null,
      worktreePath: null,
      iteration: 0,
      approval: null,
      startedAt: nowIso(),
      endedAt: null,
    },
    events: [],
    view: initialRunView(runId),
    listeners: new Set(),
    done: Promise.resolve(),
  };
  registry().set(runId, record);

  record.done = (async (): Promise<void> => {
    try {
      await setTicketStatus(projectDir, ticket.id, "running");
      for await (const event of simulateRun({ runId, delayMs: options.delayMs ?? 0 })) {
        applyEvent(record, event);
      }
      record.run = { ...record.run, endedAt: nowIso() };
      await appendRunState(projectDir, ticket.id, runId, {
        state: record.run.state,
        sessionId: record.run.sessionId,
        worktreePath: record.run.worktreePath,
        branch: null,
        iteration: record.run.iteration,
      });
      await setTicketStatus(projectDir, ticket.id, "review");
    } catch (error) {
      // A failure here (simulator throw, or setTicketStatus I/O error) must
      // still reach subscribers as a terminal event, or every SSE client
      // waiting on this run hangs forever (isTerminalEvent only fires on a
      // terminal phase-change, never on the error event alone).
      const message = error instanceof Error ? error.message : String(error);
      const seq = (record.events.at(-1)?.seq ?? 0) + 1;
      applyEvent(record, { kind: "error", seq, at: nowIso(), message, recoverable: false });
      applyEvent(record, { kind: "phase-change", seq: seq + 1, at: nowIso(), from: record.view.state, to: "failed" });
      record.run = { ...record.run, endedAt: nowIso() };
      await appendRunState(projectDir, ticket.id, runId, {
        state: record.run.state,
        sessionId: record.run.sessionId,
        worktreePath: record.run.worktreePath,
        branch: null,
        iteration: record.run.iteration,
      }).catch(() => {
        // Best-effort: a persistence failure here must not block the
        // already-in-progress failure handling below.
      });
      try {
        await setTicketStatus(projectDir, ticket.id, "failed");
      } catch {
        // Best-effort: a second disk failure here is already unrecoverable.
      }
    }
  })();

  return record;
}

/**
 * The real Agent SDK path (docs/blueprint/06-execution-model.md: full
 * run lifecycle). Composes every module from Tasks 1-10 behind the same
 * RunHandle/RunEvent shape the simulator produces, so nothing downstream
 * (reducer, SSE route, UI) needs to know which engine produced an event.
 */
export function startAgentRun(projectDir: string, ticket: Ticket, config: ForgeConfig): RunHandle {
  const runId = newId("run");
  const abortController = new AbortController();
  const broker = createPermissionBroker(config.bashAllowlist, config.denyReadGlobs);
  const channel = new UserMessageChannel();
  const bashGate = new BashGate();

  const record: RunRecord = {
    run: {
      id: runId,
      ticketId: ticket.id,
      state: "preparing",
      sessionId: null,
      worktreePath: null,
      iteration: 0,
      approval: null,
      startedAt: nowIso(),
      endedAt: null,
    },
    events: [],
    view: initialRunView(runId),
    listeners: new Set(),
    done: Promise.resolve(),
    control: { channel, resolvePermission: broker.resolve, abortController },
  };
  registry().set(runId, record);

  let seq = 0;
  const nextSeq = (): number => {
    seq += 1;
    return seq;
  };

  record.done = (async (): Promise<void> => {
    let branch: string | null = null;
    const lastGates: Gate[] = [];
    try {
      await setTicketStatus(projectDir, ticket.id, "running");
      const { path: worktreePath, branch: createdBranch } = await createWorktree(
        projectDir,
        ticket.id,
        ticket.title,
        config.baseBranch,
      );
      branch = createdBranch;
      record.run = { ...record.run, worktreePath };
      await appendRunState(projectDir, ticket.id, runId, {
        state: record.run.state,
        sessionId: record.run.sessionId,
        worktreePath: record.run.worktreePath,
        branch,
        iteration: record.run.iteration,
      });
      await appendAuditEvent(projectDir, {
        user: ticket.createdBy,
        ticketId: ticket.id,
        kind: "run-started",
        runId,
        detail: "run started",
      });

      void startInstall(worktreePath, config.packageManager).then((result) => {
        bashGate.markReady();
        if (!result.ok) {
          applyEvent(record, {
            kind: "message",
            seq: nextSeq(),
            at: nowIso(),
            text: `Dependency install reported a problem: ${result.output.slice(0, 500)}`,
          });
        }
      });

      channel.push(ticket.inputs.prompt ?? ticket.title);

      // Lazily imported so this module never pulls the Agent SDK into a
      // bundle that could reach a Client Component (Global Constraints).
      const { query } = await import("@anthropic-ai/claude-agent-sdk");
      const planTracker = new PlanTracker();
      const costTracker = new CostTracker();

      const run = query({
        prompt: channel,
        options: {
          cwd: worktreePath,
          abortController,
          settingSources: ["user", "project", "local"],
          skills: "all",
          canUseTool: async (toolName, input, context) => {
            if (toolName === "Bash") {
              await bashGate.waitUntilReady();
            }
            const command = toolName === "Bash" && typeof input.command === "string" ? input.command : "";
            const requestLabel = toolName === "Bash" ? command : describeToolRequest(toolName, input);

            // broker.canUseTool synchronously registers the request into
            // its `waiting` map (if it doesn't auto-allow/auto-deny)
            // before this call expression finishes, since that function
            // has no `await` on its pending-approval path - so checking
            // broker.pending() right after this call, and BEFORE awaiting
            // it, correctly reflects whether THIS request just became
            // pending (docs/blueprint permission model: Task 12/13's
            // approval-prompt UI can only ever appear if a
            // permission-request event fires here).
            const resultPromise = broker.canUseTool(toolName, input, context);
            const isPending = broker.pending().some((pending) => pending.requestId === context.requestId);
            if (isPending) {
              applyEvent(record, {
                kind: "permission-request",
                seq: nextSeq(),
                at: nowIso(),
                requestId: context.requestId,
                command: requestLabel,
              });
            }

            const result = await resultPromise;

            if (isPending) {
              applyEvent(record, {
                kind: "permission-decision",
                seq: nextSeq(),
                at: nowIso(),
                requestId: context.requestId,
                decision: result.behavior === "allow" ? "approved" : "denied",
              });
            }

            if (toolName !== "Bash") {
              // Task 9's canonical AuditEvent union only has Bash-specific
              // kinds (bash-command-{approved,allowlisted,denied}); there is
              // no generic "tool allowed/denied" kind for Read/Grep/Glob/
              // Write/etc. Rather than invent one, non-Bash decisions are
              // not audited yet - see the task report for discussion.
              return result;
            }

            const isAllowlisted = resolveBashCommand(command, config.bashAllowlist).kind === "allowlisted";
            const kind =
              result.behavior === "deny"
                ? "bash-command-denied"
                : isAllowlisted
                  ? "bash-command-allowlisted"
                  : "bash-command-approved";
            await appendAuditEvent(projectDir, {
              user: ticket.createdBy,
              ticketId: ticket.id,
              kind,
              runId,
              command,
              detail: `${kind}: ${command}`,
            });
            return result;
          },
        },
      });

      applyEvent(record, { kind: "phase-change", seq: nextSeq(), at: nowIso(), from: record.view.state, to: "executing" });

      for await (const message of run) {
        for (const event of mapSdkMessages(message, nextSeq)) {
          applyEvent(record, event);
        }

        if (planTracker.ingest(message)) {
          applyEvent(record, { kind: "todo-update", seq: nextSeq(), at: nowIso(), todos: planTracker.todos() });
        }
        const cost = costTracker.ingest(message);
        if (cost) {
          applyEvent(record, { kind: "cost-update", seq: nextSeq(), at: nowIso(), cumulative: cost });
        }

        if (message.type === "result") {
          // A streaming-input session stays open indefinitely waiting for
          // more input on the channel - it does not end on its own just
          // because one turn finished (docs/blueprint/02-agent-sdk-guide.md:
          // "keep the stream open while a canUseTool prompt is pending; do
          // not close() the channel until you have seen the result frame").
          // Close - and stop consuming - as soon as the result frame is
          // seen, from inside this loop. Closing only after the loop (as
          // this used to) is a deadlock: the loop can't exit until the
          // channel closes, and the channel never closed because the loop
          // never exited. Breaking here (rather than draining further)
          // also avoids depending on the SDK's iterator eventually
          // completing after teardown-only frames (hook_started/
          // hook_progress/hook_response) that can still arrive post-result;
          // those carry no plan/cost/RunEvent data this run needs.
          channel.close();
          break;
        }
      }
      // Safety net for any exit path that reaches here without ever seeing
      // a result frame (e.g. the run's iterator ending early for another
      // reason); close() is idempotent, so this is a no-op on the normal
      // success path above.
      channel.close();

      applyEvent(record, { kind: "phase-change", seq: nextSeq(), at: nowIso(), from: record.view.state, to: "gates-running" });
      await appendRunState(projectDir, ticket.id, runId, {
        state: record.run.state,
        sessionId: record.run.sessionId,
        worktreePath: record.run.worktreePath,
        branch,
        iteration: record.run.iteration,
      });
      for (const gateName of ticket.gates) {
        const scriptName = config.scripts[gateName as keyof typeof config.scripts] ?? gateName;
        const gate = await runGate(worktreePath, gateName, scriptName, config.packageManager);
        applyEvent(record, { kind: "gate-result", seq: nextSeq(), at: nowIso(), gate });
        lastGates.push(gate);
      }

      applyEvent(record, { kind: "phase-change", seq: nextSeq(), at: nowIso(), from: "gates-running", to: "completed" });
      await commitAll(worktreePath, `${ticket.type}: ${ticket.title}\n\nTicket: ${ticket.id}`);
      record.run = { ...record.run, endedAt: nowIso() };
      await appendRunState(projectDir, ticket.id, runId, {
        state: record.run.state,
        sessionId: record.run.sessionId,
        worktreePath: record.run.worktreePath,
        branch,
        iteration: record.run.iteration,
      });

      // Write the sanitized, committed run summary exactly once, while the
      // worktree still exists (changedFiles diffs it against the base
      // branch). commandsRun is [] for now (see summary.ts KNOWN GAP).
      const filesTouched = await changedFiles(worktreePath, config.baseBranch).catch((): FileTouch[] => []);
      await writeRunSummary(
        projectDir,
        ticket.id,
        buildRunSummary({
          id: record.run.id,
          ticketId: record.run.ticketId,
          state: record.run.state,
          filesTouched,
          commandsRun: [],
          gates: lastGates,
          iteration: record.run.iteration,
          cost: record.view.cost,
          approval: record.run.approval,
          startedAt: record.run.startedAt,
          endedAt: record.run.endedAt ?? nowIso(),
        }),
      );

      await setTicketStatus(projectDir, ticket.id, "review", { branchName: branch });
    } catch (error) {
      const aborted = abortController.signal.aborted;
      if (aborted) {
        applyEvent(record, { kind: "phase-change", seq: nextSeq(), at: nowIso(), from: record.view.state, to: "interrupted" });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        applyEvent(record, { kind: "error", seq: nextSeq(), at: nowIso(), message, recoverable: false });
        applyEvent(record, { kind: "phase-change", seq: nextSeq(), at: nowIso(), from: record.view.state, to: "failed" });
      }
      record.run = { ...record.run, endedAt: nowIso() };
      await appendRunState(projectDir, ticket.id, runId, {
        state: record.run.state,
        sessionId: record.run.sessionId,
        worktreePath: record.run.worktreePath,
        branch,
        iteration: record.run.iteration,
      }).catch(() => {
        // Best-effort: a persistence failure here must not block the
        // already-in-progress failure handling below.
      });

      // Best-effort terminal summary for failed/interrupted runs. Wrapped
      // so a write failure here never masks the original error. Note:
      // `rejected` is never produced by this writer - rejection is a
      // post-run ticket op handled outside startAgentRun.
      if (record.run.worktreePath) {
        try {
          const wt = record.run.worktreePath;
          const filesTouched = await changedFiles(wt, config.baseBranch).catch((): FileTouch[] => []);
          await writeRunSummary(
            projectDir,
            ticket.id,
            buildRunSummary({
              id: record.run.id,
              ticketId: record.run.ticketId,
              state: record.run.state,
              filesTouched,
              commandsRun: [],
              gates: lastGates,
              iteration: record.run.iteration,
              cost: record.view.cost,
              approval: record.run.approval,
              startedAt: record.run.startedAt,
              endedAt: record.run.endedAt ?? nowIso(),
            }),
          );
        } catch {
          // Best-effort: never let a summary-write failure mask the run's
          // original failure/interrupt handling below.
        }
      }

      if (record.run.worktreePath) {
        await removeWorktree(projectDir, record.run.worktreePath).catch(() => {});
      }
      try {
        await setTicketStatus(projectDir, ticket.id, "failed");
      } catch {
        // Best-effort.
      }
    }
  })();

  return record;
}

/** The seam every API route calls; picks the engine so callers never branch on env themselves. */
export function startRun(
  projectDir: string,
  ticket: Ticket,
  config: ForgeConfig,
  options: StartRunOptions = {},
): RunHandle {
  return isRealEngineAvailable() ? startAgentRun(projectDir, ticket, config) : startSimulatedRun(projectDir, ticket, options);
}

export function getRun(runId: string): RunHandle | null {
  return registry().get(runId) ?? null;
}

export function findLatestRunForTicket(ticketId: string): RunHandle | null {
  let latest: RunHandle | null = null;
  for (const record of registry().values()) {
    if (record.run.ticketId === ticketId) latest = record;
  }
  return latest;
}

/**
 * Replays all buffered events synchronously, then registers for live events
 * if the run is still going. Runs in a terminal state return a no-op
 * unsubscribe.
 */
export function subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
  const record = registry().get(runId);
  if (!record) return () => {};
  for (const event of record.events) listener(event);
  if (isTerminalState(record.view.state)) {
    return () => {};
  }
  record.listeners.add(listener);
  return () => record.listeners.delete(listener);
}

/** Test-only: clears the in-memory run registry between tests. */
export function resetRunRegistry(): void {
  registry().clear();
}
