import { describe, expect, it } from "vitest";
import { makeScratchDir } from "@/test/helpers";
import { appendRunState, readLastRunState } from "./persist";

describe("run state persistence", () => {
  it("appends state lines and reads the last one back", async () => {
    const { dir, cleanup } = await makeScratchDir();
    await appendRunState(dir, "tkt-1", "run-1", { state: "preparing", sessionId: null, worktreePath: "/tmp/wt", branch: null, iteration: 0 });
    await appendRunState(dir, "tkt-1", "run-1", { state: "executing", sessionId: "sess-1", worktreePath: "/tmp/wt", branch: "forge/x", iteration: 0 });
    const last = await readLastRunState(dir, "tkt-1", "run-1");
    expect(last).toMatchObject({ type: "state", state: "executing", sessionId: "sess-1" });
    await cleanup();
  });

  it("returns null when no transcript exists yet", async () => {
    const { dir, cleanup } = await makeScratchDir();
    expect(await readLastRunState(dir, "tkt-1", "run-nope")).toBeNull();
    await cleanup();
  });
});
