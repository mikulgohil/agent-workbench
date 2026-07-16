import { describe, expect, it } from "vitest";
import { makeScratchDir } from "@/test/helpers";
import { isTerminalState } from "@/lib/forge/types";
import { appendRunState } from "./persist";
import { findOrphanedRuns } from "./janitor";

describe("findOrphanedRuns", () => {
  it("flags a non-terminal persisted run with no live tracker as orphaned", async () => {
    const { dir, cleanup } = await makeScratchDir();
    await appendRunState(dir, "tkt-1", "run-1", { state: "executing", sessionId: "sess-1", worktreePath: "/tmp/wt", branch: "forge/x", iteration: 0 });
    const orphans = await findOrphanedRuns(dir, new Set());
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({ ticketId: "tkt-1", runId: "run-1" });
    expect(isTerminalState(orphans[0].state.state)).toBe(false);
    await cleanup();
  });

  it("does not flag a run that has a live in-memory tracker", async () => {
    const { dir, cleanup } = await makeScratchDir();
    await appendRunState(dir, "tkt-1", "run-1", { state: "executing", sessionId: "sess-1", worktreePath: "/tmp/wt", branch: "forge/x", iteration: 0 });
    const orphans = await findOrphanedRuns(dir, new Set(["run-1"]));
    expect(orphans).toEqual([]);
    await cleanup();
  });

  it("does not flag a run whose last state is terminal", async () => {
    const { dir, cleanup } = await makeScratchDir();
    await appendRunState(dir, "tkt-1", "run-1", { state: "completed", sessionId: "sess-1", worktreePath: "/tmp/wt", branch: "forge/x", iteration: 0 });
    const orphans = await findOrphanedRuns(dir, new Set());
    expect(orphans).toEqual([]);
    await cleanup();
  });

  it("returns an empty list when no runs exist at all", async () => {
    const { dir, cleanup } = await makeScratchDir();
    expect(await findOrphanedRuns(dir, new Set())).toEqual([]);
    await cleanup();
  });
});
