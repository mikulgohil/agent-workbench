import { describe, expect, it } from "vitest";
import { PlanTracker } from "./plan-tracker";

function taskCreateFrame(id: string, subject: string) {
  return {
    type: "assistant",
    message: { id, content: [{ type: "tool_use", id, name: "TaskCreate", input: { subject } }], usage: { input_tokens: 1, output_tokens: 1 } },
    parent_tool_use_id: null,
    uuid: id,
    session_id: "s1",
  } as never;
}

function toolResultFrame(toolUseId: string, taskId: string) {
  return {
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId }] },
    tool_use_result: { task: { id: taskId } },
    parent_tool_use_id: null,
  } as never;
}

function taskUpdateFrame(taskId: string, status: string) {
  return {
    type: "assistant",
    message: { id: "u1", content: [{ type: "tool_use", id: "tu-u1", name: "TaskUpdate", input: { taskId, status } }], usage: { input_tokens: 1, output_tokens: 1 } },
    parent_tool_use_id: null,
    uuid: "u1",
    session_id: "s1",
  } as never;
}

describe("PlanTracker", () => {
  it("creates a todo once TaskCreate's tool_result confirms the id", () => {
    const tracker = new PlanTracker();
    expect(tracker.ingest(taskCreateFrame("tu-1", "Read the codebase"))).toBe(true);
    expect(tracker.todos()).toEqual([]); // not confirmed yet: no id
    expect(tracker.ingest(toolResultFrame("tu-1", "task-1"))).toBe(true);
    expect(tracker.todos()).toEqual([{ content: "Read the codebase", activeForm: "Read the codebase", status: "pending" }]);
  });

  it("updates status via TaskUpdate", () => {
    const tracker = new PlanTracker();
    tracker.ingest(taskCreateFrame("tu-2", "Implement the fix"));
    tracker.ingest(toolResultFrame("tu-2", "task-2"));
    expect(tracker.ingest(taskUpdateFrame("task-2", "in_progress"))).toBe(true);
    expect(tracker.todos()[0].status).toBe("in_progress");
    tracker.ingest(taskUpdateFrame("task-2", "completed"));
    expect(tracker.todos()[0].status).toBe("completed");
  });

  it("ignores an update for an unknown task id", () => {
    const tracker = new PlanTracker();
    expect(tracker.ingest(taskUpdateFrame("task-nope", "completed"))).toBe(false);
    expect(tracker.todos()).toEqual([]);
  });

  it("returns false for frames with no plan-relevant content", () => {
    const tracker = new PlanTracker();
    expect(
      tracker.ingest({ type: "assistant", message: { id: "m", content: [{ type: "text", text: "hi" }], usage: { input_tokens: 1, output_tokens: 1 } }, parent_tool_use_id: null, uuid: "x", session_id: "s1" } as never),
    ).toBe(false);
  });
});
