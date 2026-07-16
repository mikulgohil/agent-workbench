import type { CostRecord, Gate, RunEvent, RunState, TodoItem } from "@/lib/forge/types";

/**
 * RunView is NOT part of the canonical model in docs/blueprint/
 * 05-data-model.md. It is a derived, never-persisted UI projection for the
 * Plan & Progress panel: it derives from the canonical `Run` (same id and
 * state) plus the live todo/gate/cost detail folded out of the run's
 * RunEvent transcript. Shared verbatim between the server (run manager)
 * and the client (SSE hook), so both always agree on what a run looks like.
 */
export interface RunView {
  runId: string;
  state: RunState;
  todos: TodoItem[];
  gates: Gate[];
  cost: CostRecord;
  lastMessage: string;
  /**
   * The paused Bash permission prompt the UI should show approve/allowlist/
   * deny buttons for, or null when nothing is pending. Shaped after the
   * canonical `permission-request` RunEvent (requestId + command), not the
   * permission broker's generic PendingApproval (toolName + input) - the
   * canonical event only carries a Bash command string.
   */
  pendingPermission: { requestId: string; command: string } | null;
  /**
   * The paused gate-feedback cost checkpoint the UI shows continue/stop
   * buttons for, or null when the run is not at the before-iteration-2
   * checkpoint. Set by `gate-retry-projection`; cleared by any phase-change
   * that leaves `awaiting-iteration-approval`.
   */
  pendingIteration: { iteration: number; projectedCostUsd: number } | null;
}

export const ZERO_COST: CostRecord = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
};

export function initialRunView(runId: string): RunView {
  return {
    runId,
    state: "preparing",
    todos: [],
    gates: [],
    cost: ZERO_COST,
    lastMessage: "",
    pendingPermission: null,
    pendingIteration: null,
  };
}

export function reduceRun(view: RunView, event: RunEvent): RunView {
  switch (event.kind) {
    case "phase-change":
      return {
        ...view,
        state: event.to,
        pendingIteration: event.to === "awaiting-iteration-approval" ? view.pendingIteration : null,
      };
    case "todo-update":
      return { ...view, todos: event.todos };
    case "message":
      return { ...view, lastMessage: event.text };
    case "gate-result":
      return { ...view, gates: [...view.gates, event.gate] };
    case "cost-update":
      return { ...view, cost: event.cumulative };
    case "error":
      return { ...view, lastMessage: event.message };
    case "permission-request":
      return { ...view, pendingPermission: { requestId: event.requestId, command: event.command } };
    case "permission-decision":
      return { ...view, pendingPermission: null };
    case "gate-retry-projection":
      return { ...view, pendingIteration: { iteration: event.iteration, projectedCostUsd: event.projectedCostUsd } };
    case "run-started":
    case "plan-proposed":
    case "plan-decision":
    case "steer-message":
    case "tool-use":
    case "tool-result":
    case "bash-command":
      // These variants either belong to later phases or do not change the
      // panel projection; the raw stream list still renders them.
      return view;
  }
}
