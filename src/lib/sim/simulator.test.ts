import { describe, expect, it } from "vitest";
import { SIMULATED_TODOS, collectRunEvents } from "./simulator";

const OPTS = { runId: "run-fixed" } as const;

describe("simulateRun", () => {
  it("starts with run-started and ends with a terminal phase-change", async () => {
    const events = await collectRunEvents(OPTS);
    expect(events[0]).toMatchObject({
      kind: "run-started",
      seq: 1,
      sessionId: "sim-session-run-fixed",
      worktreePath: null,
      branchName: null,
    });
    expect(events.at(-1)).toMatchObject({
      kind: "phase-change",
      seq: events.length,
      from: "gates-running",
      to: "completed",
    });
  });

  it("proposes the full todo list, all pending, before any todo goes in_progress", async () => {
    const events = await collectRunEvents(OPTS);
    const updates = events.flatMap((e) => (e.kind === "todo-update" ? [e.todos] : []));
    expect(updates[0].every((todo) => todo.status === "pending")).toBe(true);
    expect(updates[0].map((todo) => todo.content)).toEqual(SIMULATED_TODOS.map((t) => t.content));
  });

  it("moves every todo through in_progress exactly once and ends with all completed", async () => {
    const events = await collectRunEvents(OPTS);
    const updates = events.flatMap((e) => (e.kind === "todo-update" ? [e.todos] : []));
    for (let i = 0; i < SIMULATED_TODOS.length; i++) {
      const inProgressCount = updates.filter((todos) => todos[i].status === "in_progress").length;
      expect(inProgressCount).toBe(1);
    }
    expect(updates.at(-1)?.every((todo) => todo.status === "completed")).toBe(true);
  });

  it("emits strictly increasing seq numbers and is deterministic", async () => {
    const a = await collectRunEvents(OPTS);
    const b = await collectRunEvents(OPTS);
    a.forEach((event, i) => expect(event.seq).toBe(i + 1));
    expect(a).toEqual(b);
  });

  it("emits a passing command-basis result for each phase-1 gate", async () => {
    const events = await collectRunEvents(OPTS);
    const gates = events.flatMap((e) => (e.kind === "gate-result" ? [e.gate] : []));
    expect(gates.map((g) => g.name)).toEqual(["typecheck", "lint", "test"]);
    expect(gates.every((g) => g.basis === "command" && g.status === "passed")).toBe(true);
  });

  it("reports monotonically increasing cumulative cost", async () => {
    const events = await collectRunEvents(OPTS);
    const costs = events.flatMap((e) => (e.kind === "cost-update" ? [e.cumulative.costUsd] : []));
    expect(costs).toHaveLength(SIMULATED_TODOS.length);
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i]).toBeGreaterThan(costs[i - 1]);
    }
  });
});
