import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { FileChangeKind, FileTouch } from "@/lib/forge/types";

const execFileAsync = promisify(execFile);

/**
 * Stable per-project cache key so worktrees for the same project always
 * land in the same subfolder across app restarts, and unrelated projects
 * never collide (docs/blueprint/06-execution-model.md: worktree naming).
 */
export function projectHash(projectDir: string): string {
  return createHash("sha256").update(resolve(projectDir)).digest("hex").slice(0, 16);
}

const MAX_SLUG_LENGTH = 40;

export function ticketSlug(title: string, ticketId: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base.length <= MAX_SLUG_LENGTH) return base;
  const suffix = `-${ticketId.slice(-6)}`;
  return `${base.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
}

export function branchName(ticketId: string, title: string): string {
  return `forge/${ticketSlug(title, ticketId)}`;
}

export function worktreePath(projectDir: string, ticketId: string): string {
  return join(homedir(), ".agent-workbench", "worktrees", projectHash(projectDir), ticketId);
}

/**
 * Runs `git worktree add` from the developer's own checkout (never from
 * inside another worktree), creating a new forge/<slug> branch off
 * baseBranch (docs/blueprint/06-execution-model.md: worktree creation).
 */
export async function createWorktree(
  projectDir: string,
  ticketId: string,
  title: string,
  baseBranch: string,
): Promise<{ path: string; branch: string }> {
  const path = worktreePath(projectDir, ticketId);
  const branch = branchName(ticketId, title);
  await execFileAsync("git", ["worktree", "add", path, "-b", branch, baseBranch], { cwd: projectDir });
  return { path, branch };
}

/** Removes the worktree directory; the branch is always kept (spec: kept for inspection). */
export async function removeWorktree(projectDir: string, worktreePath: string): Promise<void> {
  await execFileAsync("git", ["worktree", "remove", "--force", worktreePath], { cwd: projectDir });
}

export async function hasDiff(worktreePath: string): Promise<boolean> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: worktreePath });
  return stdout.trim().length > 0;
}

/** Skips the commit entirely when there is no diff, so an interrupt with no work never creates a noise commit. */
export async function commitAll(worktreePath: string, message: string): Promise<void> {
  if (!(await hasDiff(worktreePath))) return;
  await execFileAsync("git", ["add", "-A"], { cwd: worktreePath });
  await execFileAsync("git", ["commit", "-q", "-m", message], { cwd: worktreePath });
}

/** True when the worktree's branch has at least one commit beyond baseBranch (rejection's keep-vs-delete rule). */
export async function hasCommitsSinceBase(worktreePath: string, baseBranch: string): Promise<boolean> {
  const { stdout } = await execFileAsync("git", ["log", `${baseBranch}..HEAD`, "--oneline"], { cwd: worktreePath });
  return stdout.trim().length > 0;
}

/**
 * Maps a `git diff --name-status` porcelain status letter to a canonical
 * FileChangeKind. Renames (`R`) and copies (`C`) are reported as a
 * `modified` of the new path (the summary is a sanitized paths-only
 * record, so a rename's semantics beyond "this path changed" are not
 * carried); anything unexpected is treated as `modified` rather than
 * dropped, so the summary never silently loses a touched path.
 */
function statusToKind(status: string): FileChangeKind {
  const letter = status[0];
  if (letter === "A") return "added";
  if (letter === "D") return "deleted";
  return "modified";
}

/**
 * The set of files this worktree's tree differs by against `baseBranch`,
 * as sanitized path + change-kind pairs (no contents, no diff). Used to
 * populate `RunSummary.filesTouched` after the run's commit lands
 * (docs/blueprint/05-data-model.md: RunSummary is paths-only).
 */
export async function changedFiles(worktreePath: string, baseBranch: string): Promise<FileTouch[]> {
  const { stdout } = await execFileAsync("git", ["diff", "--name-status", baseBranch], { cwd: worktreePath });
  const touched: FileTouch[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    const fields = line.split("\t");
    const status = fields[0] ?? "";
    // Rename/copy lines are `R100<TAB>old<TAB>new`; use the last field (new path).
    const path = fields[fields.length - 1] ?? "";
    if (path.length === 0) continue;
    touched.push({ path, kind: statusToKind(status) });
  }
  return touched;
}
