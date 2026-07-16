import { describe, expect, it } from "vitest";
import type { RunEvent } from "@/lib/forge/types";
import { SIMULATED_TODOS, collectRunEvents } from "@/lib/sim/simulator";
import { initialRunView, reduceRun, type RunView } from "./reducer";

const OPTS = { runId: "run-fixed" } as const;

function fold(events: RunEvent[]): RunView {
  return events.reduce(reduceRun, initialRunView("run-fixed"));
}

describe("reduceRun", () => {
  it("folds a full simulated run into a completed view", async () => {
    const view = fold(await collectRunEvents(OPTS));
    expect(view.state).toBe("completed");
    expect(view.runId).toBe("run-fixed");
    expect(view.todos).toHaveLength(SIMULATED_TODOS.length);
    expect(view.todos.every((todo) => todo.status === "completed")).toBe(true);
    expect(view.gates).toHaveLength(3);
    expect(view.cost.costUsd).toBeGreaterThan(0);
    expect(view.lastMessage.length).toBeGreaterThan(0);
  });

  it("tracks the in_progress todo mid-run", async () => {
    const events = await collectRunEvents(OPTS);
    const secondActive = events.findIndex(
      (e) => e.kind === "todo-update" && e.todos[1]?.status === "in_progress",
    );
    const view = fold(events.slice(0, secondActive + 1));
    expect(view.state).toBe("executing");
    expect(view.todos[0]?.status).toBe("completed");
    expect(view.todos[1]?.status).toBe("in_progress");
    expect(view.todos[2]?.status).toBe("pending");
  });

  it("starts preparing and follows phase-change events", () => {
    const start = initialRunView("run-x");
    expect(start.state).toBe("preparing");
    const after = reduceRun(start, {
      kind: "phase-change",
      seq: 1,
      at: "2026-01-01T00:00:01.000Z",
      from: "preparing",
      to: "planning",
    });
    expect(after.state).toBe("planning");
  });

  it("does not mutate the previous view", () => {
    const start = initialRunView("run-x");
    const frozen = JSON.stringify(start);
    reduceRun(start, { kind: "message", seq: 1, at: "2026-01-01T00:00:01.000Z", text: "hello" });
    expect(JSON.stringify(start)).toBe(frozen);
  });

  it("sets pendingPermission on a permission-request and clears it on the matching decision", () => {
    const start = initialRunView("run-x");
    expect(start.pendingPermission).toBeNull();

    const requested = reduceRun(start, {
      kind: "permission-request",
      seq: 1,
      at: "2026-01-01T00:00:01.000Z",
      requestId: "req-1",
      command: "rm -rf dist",
    });
    expect(requested.pendingPermission).toEqual({ requestId: "req-1", command: "rm -rf dist" });

    const decided = reduceRun(requested, {
      kind: "permission-decision",
      seq: 2,
      at: "2026-01-01T00:00:02.000Z",
      requestId: "req-1",
      decision: "approved",
    });
    expect(decided.pendingPermission).toBeNull();
  });
});

describe("reduceRun pendingIteration (gate-feedback checkpoint)", () => {
  it("sets pendingIteration on gate-retry-projection", () => {
    const view = reduceRun(initialRunView("run-p"), {
      kind: "gate-retry-projection", seq: 1, at: "t", iteration: 2, projectedCostUsd: 0.05,
    });
    expect(view.pendingIteration).toEqual({ iteration: 2, projectedCostUsd: 0.05 });
  });

  it("keeps pendingIteration while transitioning INTO awaiting-iteration-approval", () => {
    let view = reduceRun(initialRunView("run-p"), { kind: "gate-retry-projection", seq: 1, at: "t", iteration: 2, projectedCostUsd: 0.05 });
    view = reduceRun(view, { kind: "phase-change", seq: 2, at: "t", from: "gates-running", to: "awaiting-iteration-approval" });
    expect(view.pendingIteration).toEqual({ iteration: 2, projectedCostUsd: 0.05 });
  });

  it("clears pendingIteration on any other phase-change", () => {
    let view = reduceRun(initialRunView("run-p"), { kind: "gate-retry-projection", seq: 1, at: "t", iteration: 2, projectedCostUsd: 0.05 });
    view = reduceRun(view, { kind: "phase-change", seq: 2, at: "t", from: "awaiting-iteration-approval", to: "executing" });
    expect(view.pendingIteration).toBeNull();
  });

  it("defaults pendingIteration to null", () => {
    expect(initialRunView("run-p").pendingIteration).toBeNull();
  });
});
