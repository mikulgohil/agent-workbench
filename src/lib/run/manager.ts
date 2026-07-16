import { newId, nowIso } from "@/lib/forge/ids";
import { setTicketStatus } from "@/lib/forge/store";
import { isTerminalState } from "@/lib/forge/types";
import type { ForgeConfig, Run, RunEvent, Ticket } from "@/lib/forge/types";
import { simulateRun } from "@/lib/sim/simulator";
import { initialRunView, reduceRun } from "./reducer";
import type { RunView } from "./reducer";
import { isRealEngineAvailable } from "@/lib/engine";
import { createWorktree, removeWorktree, commitAll } from "@/lib/git/worktree";
import { startInstall, BashGate } from "@/lib/prepare";
import { createPermissionBroker } from "@/lib/permission/broker";
import { resolveBashCommand } from "@/lib/permission/allowlist";
import { UserMessageChannel } from "@/lib/session/channel";
import { mapSdkMessages } from "@/lib/session/map-events";
import { PlanTracker } from "@/lib/session/plan-tracker";
import { CostTracker } from "@/lib/session/cost-tracker";
import { appendAuditEvent } from "@/lib/audit";
import { runGate } from "@/lib/gates";

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
            if (toolName !== "Bash") {
              // Task 9's canonical AuditEvent union only has Bash-specific
              // kinds (bash-command-{approved,allowlisted,denied}); there is
              // no generic "tool allowed/denied" kind for Read/Grep/Glob/
              // Write/etc. Rather than invent one, non-Bash decisions are
              // not audited yet - see the task report for discussion.
              return broker.canUseTool(toolName, input, context);
            }

            await bashGate.waitUntilReady();
            const command = typeof input.command === "string" ? input.command : "";
            const isAllowlisted = resolveBashCommand(command, config.bashAllowlist).kind === "allowlisted";
            const result = await broker.canUseTool(toolName, input, context);

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
      }
      channel.close();

      applyEvent(record, { kind: "phase-change", seq: nextSeq(), at: nowIso(), from: record.view.state, to: "gates-running" });
      for (const gateName of ticket.gates) {
        const scriptName = config.scripts[gateName as keyof typeof config.scripts] ?? gateName;
        const gate = await runGate(worktreePath, gateName, scriptName, config.packageManager);
        applyEvent(record, { kind: "gate-result", seq: nextSeq(), at: nowIso(), gate });
      }

      applyEvent(record, { kind: "phase-change", seq: nextSeq(), at: nowIso(), from: "gates-running", to: "completed" });
      await commitAll(worktreePath, `${ticket.type}: ${ticket.title}\n\nTicket: ${ticket.id}`);
      record.run = { ...record.run, endedAt: nowIso() };
      await setTicketStatus(projectDir, ticket.id, "review", { branchName: branch });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      applyEvent(record, { kind: "error", seq: nextSeq(), at: nowIso(), message, recoverable: false });
      applyEvent(record, { kind: "phase-change", seq: nextSeq(), at: nowIso(), from: record.view.state, to: "failed" });
      record.run = { ...record.run, endedAt: nowIso() };
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
