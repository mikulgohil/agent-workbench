import { newId, nowIso } from "@/lib/forge/ids";
import { setTicketStatus } from "@/lib/forge/store";
import { isTerminalState } from "@/lib/forge/types";
import type { Run, RunEvent, Ticket } from "@/lib/forge/types";
import { simulateRun } from "@/lib/sim/simulator";
import { initialRunView, reduceRun } from "./reducer";
import type { RunView } from "./reducer";

/**
 * In-memory registry of runs for the current app process.
 * Phase 1 keeps runs in memory only; Phase 2 adds persistence of the
 * transcript to .forge/local/runs/ so unfinished runs survive an app
 * restart (spec: interrupt, steer, resume).
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
    await setTicketStatus(projectDir, ticket.id, "running");
    for await (const event of simulateRun({ runId, delayMs: options.delayMs ?? 0 })) {
      record.events.push(event);
      record.view = reduceRun(record.view, event);
      record.run = {
        ...record.run,
        state: record.view.state,
        sessionId: event.kind === "run-started" ? event.sessionId : record.run.sessionId,
      };
      for (const listener of record.listeners) listener(event);
    }
    record.run = { ...record.run, endedAt: nowIso() };
    await setTicketStatus(projectDir, ticket.id, "review");
  })();

  return record;
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
