import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forgeDir, initForge } from "@/lib/forge/store";
import { APP_VERSION } from "@/lib/version";
import type { RunSummary } from "@/lib/forge/types";
import { makeScratchDir } from "@/test/helpers";
import { buildRunSummary, writeRunSummary } from "./summary";

const ZERO = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };

describe("buildRunSummary", () => {
  it("derives durationMs and appVersion and carries commandsRun through empty for now", () => {
    const summary = buildRunSummary({
      id: "run-abc12345",
      ticketId: "tkt-abc12345",
      state: "completed",
      filesTouched: [{ path: "src/x.ts", kind: "modified" }],
      commandsRun: [],
      gates: [],
      iteration: 1,
      cost: ZERO,
      approval: null,
      startedAt: "2026-07-16T00:00:00.000Z",
      endedAt: "2026-07-16T00:00:02.500Z",
    });
    expect(summary.durationMs).toBe(2500);
    expect(summary.appVersion).toBe(APP_VERSION);
    expect(summary.commandsRun).toEqual([]);
    expect(summary.iteration).toBe(1);
  });
});

describe("writeRunSummary", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await makeScratchDir());
    await initForge(dir);
  });
  afterEach(async () => {
    await cleanup();
  });

  it("writes pretty JSON with a trailing newline to runs/<id>.summary.json and never carries a diff/content field", async () => {
    const summary = buildRunSummary({
      id: "run-def67890",
      ticketId: "tkt-def67890",
      state: "completed",
      filesTouched: [{ path: "a.ts", kind: "added" }],
      commandsRun: [],
      gates: [{ name: "typecheck", basis: "command", status: "passed", score: 100, explanation: "typecheck exited 0", durationMs: 12 }],
      iteration: 0,
      cost: ZERO,
      approval: null,
      startedAt: "2026-07-16T00:00:00.000Z",
      endedAt: "2026-07-16T00:00:01.000Z",
    });
    await writeRunSummary(dir, "tkt-def67890", summary);

    const path = join(forgeDir(dir), "tickets", "tkt-def67890", "runs", "run-def67890.summary.json");
    const raw = await readFile(path, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(raw) as RunSummary;
    expect(parsed.id).toBe("run-def67890");
    expect(parsed.gates[0]?.status).toBe("passed");
    expect(parsed.filesTouched[0]).toEqual({ path: "a.ts", kind: "added" });
    // Sanitization invariant: no field name that could carry file contents.
    expect(raw).not.toContain("\"diff\"");
    expect(raw).not.toContain("\"content\"");
  });
});
