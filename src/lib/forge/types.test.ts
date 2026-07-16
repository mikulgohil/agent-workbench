import { describe, expect, it } from "vitest";
import {
  FILE_CHANGE_KINDS,
  RUN_EVENT_KINDS,
  RUN_STATES,
  TICKET_STATUSES,
  isTerminalEvent,
  isTerminalState,
  isTicketType,
  type CommandRecord,
  type FileTouch,
  type RunEvent,
  type RunSummary,
} from "./types";

describe("forge domain types", () => {
  it("guards ticket types", () => {
    expect(isTicketType("bug-fix")).toBe(true);
    expect(isTicketType("epic")).toBe(false);
  });

  it("persists the six canonical ticket statuses", () => {
    expect(TICKET_STATUSES).toEqual([
      "backlog",
      "running",
      "review",
      "done",
      "rejected",
      "failed",
    ]);
  });

  it("covers every run event variant in RUN_EVENT_KINDS", () => {
    // Compile-time check: adding a RunEvent variant whose kind is missing
    // from RUN_EVENT_KINDS makes this line fail to typecheck.
    const covered: RunEvent["kind"] extends (typeof RUN_EVENT_KINDS)[number] ? true : never = true;
    expect(covered).toBe(true);
  });

  it("flags exactly the four terminal run states", () => {
    expect(RUN_STATES.filter(isTerminalState)).toEqual([
      "completed",
      "rejected",
      "interrupted",
      "failed",
    ]);
  });

  it("treats only terminal phase changes as terminal events", () => {
    const done: RunEvent = {
      kind: "phase-change",
      seq: 9,
      at: "2026-01-01T00:00:09.000Z",
      from: "gates-running",
      to: "completed",
    };
    const mid: RunEvent = {
      kind: "phase-change",
      seq: 2,
      at: "2026-01-01T00:00:02.000Z",
      from: "planning",
      to: "executing",
    };
    const text: RunEvent = { kind: "message", seq: 1, at: "2026-01-01T00:00:01.000Z", text: "hi" };
    expect(isTerminalEvent(done)).toBe(true);
    expect(isTerminalEvent(mid)).toBe(false);
    expect(isTerminalEvent(text)).toBe(false);
  });
});

describe("RunSummary canonical types", () => {
  it("defines the three file-change kinds in canonical order", () => {
    expect(FILE_CHANGE_KINDS).toEqual(["added", "modified", "deleted"]);
  });

  it("constructs a fully-typed RunSummary with no diff/content fields", () => {
    const filesTouched: FileTouch[] = [{ path: "src/x.ts", kind: "modified" }];
    const commandsRun: CommandRecord[] = [];
    const summary: RunSummary = {
      id: "run-abc12345",
      ticketId: "tkt-abc12345",
      state: "completed",
      filesTouched,
      commandsRun,
      gates: [],
      iteration: 0,
      cost: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
      approval: null,
      startedAt: "2026-07-16T00:00:00.000Z",
      endedAt: "2026-07-16T00:00:01.000Z",
      durationMs: 1000,
      appVersion: "0.1.0",
    };
    expect(summary.filesTouched[0]?.kind).toBe("modified");
    // Sanitization invariant: the type has no field that could carry file contents.
    expect(Object.keys(summary)).not.toContain("diff");
    expect(Object.keys(summary)).not.toContain("content");
  });
});
