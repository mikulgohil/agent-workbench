import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeScratchDir } from "@/test/helpers";
import {
  branchName,
  changedFiles,
  commitAll,
  createWorktree,
  hasCommitsSinceBase,
  hasDiff,
  projectHash,
  removeWorktree,
  ticketSlug,
  worktreePath,
} from "./worktree";

const execFileAsync = promisify(execFile);

async function initGitRepo(dir: string): Promise<void> {
  await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "hello\n", "utf8");
  await execFileAsync("git", ["add", "README.md"], { cwd: dir });
  await execFileAsync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
}

describe("worktree module", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  const createdWorktrees: string[] = [];

  beforeEach(async () => {
    ({ dir, cleanup } = await makeScratchDir());
    await initGitRepo(dir);
  });

  afterEach(async () => {
    for (const wt of createdWorktrees.splice(0)) {
      await removeWorktree(dir, wt).catch(() => {});
    }
    await cleanup();
  });

  it("hashes the same project dir identically and different dirs differently", () => {
    const a = projectHash(dir);
    const b = projectHash(dir);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(projectHash(join(dir, "..") )).not.toBe(a);
  });

  it("slugifies a title and caps it at 40 characters", () => {
    expect(ticketSlug("Fix the login bug", "tkt-abc12345")).toBe("fix-the-login-bug");
    const long = ticketSlug("x".repeat(80), "tkt-abc12345");
    expect(long.length).toBeLessThanOrEqual(40);
  });

  it("builds branch names as forge/<slug>", () => {
    expect(branchName("tkt-abc12345", "Fix the login bug")).toBe("forge/fix-the-login-bug");
  });

  it("computes the worktree path under ~/.agent-workbench/worktrees/<hash>/<ticketId>", () => {
    const p = worktreePath(dir, "tkt-abc12345");
    expect(p).toBe(join(homedir(), ".agent-workbench", "worktrees", projectHash(dir), "tkt-abc12345"));
  });

  it("creates a real worktree on a new forge/<slug> branch and detects/commits a diff", async () => {
    const { path, branch } = await createWorktree(dir, "tkt-abc12345", "Fix the login bug", "main");
    createdWorktrees.push(path);
    expect(branch).toBe("forge/fix-the-login-bug");
    expect(await readFile(join(path, "README.md"), "utf8")).toBe("hello\n");
    expect(await hasDiff(path)).toBe(false);

    await writeFile(join(path, "README.md"), "hello\nedited\n", "utf8");
    expect(await hasDiff(path)).toBe(true);
    await commitAll(path, "WIP: test commit");
    expect(await hasDiff(path)).toBe(false);
    const { stdout } = await execFileAsync("git", ["log", "-1", "--format=%s"], { cwd: path });
    expect(stdout.trim()).toBe("WIP: test commit");
  });

  it("removes a worktree but keeps the branch", async () => {
    const { path, branch } = await createWorktree(dir, "tkt-def67890", "Another ticket", "main");
    await removeWorktree(dir, path);
    const { stdout } = await execFileAsync("git", ["branch", "--list", branch], { cwd: dir });
    expect(stdout.trim()).toContain(branch);
  });

  it("is a no-op when committing with no diff", async () => {
    const { path } = await createWorktree(dir, "tkt-noop0000", "Noop ticket", "main");
    createdWorktrees.push(path);
    await commitAll(path, "WIP: should not be created");
    const { stdout } = await execFileAsync("git", ["log", "--oneline"], { cwd: path });
    expect(stdout).not.toContain("should not be created");
  });

  it("detects whether a worktree branch has commits beyond its base", async () => {
    const { path } = await createWorktree(dir, "tkt-approve01", "Approve check", "main");
    createdWorktrees.push(path);
    expect(await hasCommitsSinceBase(path, "main")).toBe(false);
    await writeFile(join(path, "README.md"), "hello\nedited\n", "utf8");
    await commitAll(path, "real work");
    expect(await hasCommitsSinceBase(path, "main")).toBe(true);
  });

  it("reports added, modified, and deleted files vs the base branch", async () => {
    const { path } = await createWorktree(dir, "tkt-changed01", "Changed files", "main");
    createdWorktrees.push(path);
    // README.md exists on base; modify it, add a new file, delete nothing yet.
    await writeFile(join(path, "README.md"), "hello\nchanged\n", "utf8");
    await writeFile(join(path, "new.ts"), "export const x = 1;\n", "utf8");
    await commitAll(path, "work: modify + add");

    const touched = await changedFiles(path, "main");
    const byPath = Object.fromEntries(touched.map((t) => [t.path, t.kind]));
    expect(byPath["README.md"]).toBe("modified");
    expect(byPath["new.ts"]).toBe("added");

    // Now delete README and commit; it should read as deleted vs base.
    await execFileAsync("git", ["rm", "-q", "README.md"], { cwd: path });
    await execFileAsync("git", ["commit", "-q", "-m", "work: delete readme"], { cwd: path });
    const afterDelete = await changedFiles(path, "main");
    expect(afterDelete.find((t) => t.path === "README.md")?.kind).toBe("deleted");
  });
});
