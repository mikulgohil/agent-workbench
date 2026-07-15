import { describe, expect, it } from "vitest";
import { RUN_EVENT_KINDS } from "@/lib/forge/types";
import type { CostRecord, Gate, RunEvent } from "@/lib/forge/types";
import { describeEvent } from "./describe-event";

const BASE = { seq: 1, at: "2026-01-01T00:00:01.000Z" };

const GATE: Gate = {
  name: "lint",
  basis: "command",
  status: "passed",
  score: 100,
  explanation: "eslint exited 0",
  durationMs: 2100,
};

const COST: CostRecord = {
  inputTokens: 900,
  outputTokens: 350,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0.008,
};

const SAMPLES: RunEvent[] = [
  { ...BASE, kind: "run-started", sessionId: "sim-session-run-1", worktreePath: null, branchName: null },
  { ...BASE, kind: "plan-proposed", planMarkdown: "# Plan" },
  { ...BASE, kind: "plan-decision", decision: "approved", note: "" },
  { ...BASE, kind: "todo-update", todos: [{ content: "Do it", activeForm: "Doing it", status: "pending" }] },
  { ...BASE, kind: "message", text: "Working on it." },
  { ...BASE, kind: "steer-message", text: "Focus on a11y", from: "Test Dev <dev@example.com>" },
  { ...BASE, kind: "tool-use", toolUseId: "tu-1", toolName: "Write", input: { file_path: "src/a.ts" } },
  { ...BASE, kind: "tool-result", toolUseId: "tu-1", output: "ok", isError: false },
  { ...BASE, kind: "permission-request", requestId: "pr-1", command: "rm -rf dist" },
  { ...BASE, kind: "permission-decision", requestId: "pr-1", decision: "denied" },
  { ...BASE, kind: "bash-command", command: "pnpm run lint", source: "allowlisted", exitCode: 0, durationMs: 2100 },
  { ...BASE, kind: "gate-result", gate: GATE },
  { ...BASE, kind: "gate-retry-projection", iteration: 2, projectedCostUsd: 0.42 },
  { ...BASE, kind: "cost-update", cumulative: COST },
  { ...BASE, kind: "phase-change", from: "planning", to: "executing" },
  { ...BASE, kind: "error", message: "boom", recoverable: false },
];

describe("describeEvent", () => {
  it("renders a non-empty one-liner for every canonical event variant", () => {
    expect(SAMPLES).toHaveLength(RUN_EVENT_KINDS.length);
    for (const event of SAMPLES) {
      expect(describeEvent(event).length).toBeGreaterThan(0);
    }
  });

  it("surfaces the interesting field per variant", () => {
    expect(describeEvent(SAMPLES[6])).toContain("src/a.ts");
    expect(describeEvent(SAMPLES[11])).toContain("lint");
    expect(describeEvent(SAMPLES[14])).toContain("executing");
  });
});
