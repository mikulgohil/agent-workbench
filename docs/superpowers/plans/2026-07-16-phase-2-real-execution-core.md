# Phase 2 Implementation Plan - Real Execution Core (Agent Workbench)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **STOP before Task 5 without explicit confirmation.** Tasks 1-4 and 9-10 are pure logic/local-process code with no external API calls and can be implemented and tested exactly like Phase 1 (deterministic, offline, free). From Task 5 onward, "manual verification" steps spawn a real `@anthropic-ai/claude-agent-sdk` `query()` call against the developer's own `ANTHROPIC_API_KEY` - this costs real money and must never run unattended. Every task from 5 onward that has a manual-verification step says so explicitly; do not run that step without the developer present and having said go ahead for that session. The automated test suite for every task (Tasks 1-15) still runs fully offline against the simulator/fakes and never needs a key - only the *manual* "does it really work against Claude" checks are gated.

## Goal

Replace the Phase 1 simulator with real Agent SDK sessions running in isolated git worktrees, with full capability parity to terminal Claude Code, permission-gated Bash, real quality gates, and the full run lifecycle (interrupt, steer, resume, gate-feedback loop, approve/reject) - while keeping the Phase 1 simulator seam intact for tests, CI, and demos.

## Architecture

Every new module in this phase sits behind the same seams Phase 1 already established: `src/lib/run/manager.ts`'s `startSimulatedRun` gets a sibling `startAgentRun` that emits the identical canonical `RunEvent` protocol from `src/lib/forge/types.ts`, so the Phase 1 reducer (`src/lib/run/reducer.ts`), the SSE route (`src/app/api/runs/[runId]/stream/route.ts`), and the Plan & Progress panel (`src/components/run/*`) do not change at all - only the event *source* changes. A new `src/lib/engine.ts` decides which source to use per run: the simulator when `NODE_ENV === "test"` or `ANTHROPIC_API_KEY` is absent, the real engine otherwise (ported convention from the Forge reference app's `isAnthropicReady()`, per `docs/blueprint/02-agent-sdk-guide.md` section 10.4). New domain concepts (worktrees, permission prompts, gates, audit events) get their own focused modules under `src/lib/`, each with a narrow, testable interface, composed together only in the run manager.

## Tech Stack

Adds to the Phase 1 stack: `@anthropic-ai/claude-agent-sdk` (pinned exact version, no caret - see Global Constraints), `picomatch` (deny-read glob matching, per the verified SDK guide pattern).

## Global Constraints

- Everything from the Phase 1 plan's Global Constraints still applies: TypeScript strict, no `enum`/`any`, string-literal unions via `as const`, `import type` for type-only imports, explicit return types on exported functions, pnpm only, vitest colocated tests (`*.test.ts`), no em dashes anywhere in docs or code comments, conventional commit messages with no `Co-Authored-By` line, never `git add -A`/`.`.
- **Canonical domain model**: `docs/blueprint/05-data-model.md` remains the single source of truth; this phase's new types (worktree paths on `Run`, `Gate`, `PermissionDecision`, `BashCommandSource`, `AuditEvent` if not already in `src/lib/forge/types.ts`) must match it exactly - most of these fields already exist in the Phase 1 `types.ts` (verify before adding, do not redefine).
- **Pin the SDK version exactly**: `"@anthropic-ai/claude-agent-sdk": "0.3.209"` in `package.json`, no `^`/`~` (docs/blueprint/02-agent-sdk-guide.md section 10.7 - behavior has demonstrably changed within the 0.3.x line).
- **Simulator seam is permanent, not temporary**: never delete `src/lib/sim/simulator.ts` or change its emitted event shapes; the vitest suite and Playwright e2e must keep running fully offline against it after this phase, per the Phase 2 exit criteria in `docs/blueprint/08-roadmap.md`.
- **Never import the Agent SDK into a Client Component.** It spawns subprocesses; only server modules (route handlers, the run manager, server actions) may import `@anthropic-ai/claude-agent-sdk` (docs/blueprint/02-agent-sdk-guide.md section 10.1).
- **`options.env`**: never set it unless spreading `process.env` first (section 10.2 of the SDK guide) - forgetting the spread strips `PATH`/`HOME`/`ANTHROPIC_API_KEY` from the subprocess.
- Worktrees live at `~/.agent-workbench/worktrees/<project-hash>/<ticket-id>/`, entirely outside every target project repo (docs/blueprint/06-execution-model.md).
- All paths below are relative to the app repo root: `/Users/mikulgohil/Developer/work/horizontal/active/agent-workbench`.

---

## Task 1: Worktree module - project hash, ticket slug, create/remove

**Files**

- Create: `src/lib/git/worktree.ts`
- Test: `src/lib/git/worktree.test.ts`

**Interfaces**

- Consumes: nothing new (uses `node:crypto`, `node:child_process` via `execFile`).
- Produces:

```ts
export function projectHash(projectDir: string): string; // stable hash of the absolute git-root path
export function ticketSlug(title: string, ticketId: string): string; // <=40 chars, id suffix only if truncation risks collision
export function worktreePath(projectDir: string, ticketId: string): string; // ~/.agent-workbench/worktrees/<hash>/<ticketId>
export function branchName(ticketId: string, title: string): string; // forge/<slug>
export function createWorktree(projectDir: string, ticketId: string, title: string, baseBranch: string): Promise<{ path: string; branch: string }>;
export function removeWorktree(projectDir: string, worktreePath: string): Promise<void>;
export function hasDiff(worktreePath: string): Promise<boolean>;
export function commitAll(worktreePath: string, message: string): Promise<void>; // no-op (returns false) if hasDiff() is false
```

**Steps**

- [ ] Write the failing test `src/lib/git/worktree.test.ts`:

```ts
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeScratchDir } from "@/test/helpers";
import {
  branchName,
  commitAll,
  createWorktree,
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
});
```

- [ ] Run `pnpm vitest run src/lib/git/worktree.test.ts` and confirm it fails: cannot resolve `./worktree`.
- [ ] Write the implementation `src/lib/git/worktree.ts`:

```ts
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

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
```

- [ ] Run `pnpm vitest run src/lib/git/worktree.test.ts` again and confirm all 7 tests pass. (This test genuinely runs real `git` commands against scratch repos - no Agent SDK, no network, no API key involved; safe to run unattended.)
- [ ] Run `pnpm typecheck` and confirm it exits 0.
- [ ] Commit:

```bash
git add src/lib/git/worktree.ts src/lib/git/worktree.test.ts
git commit -m "feat: add worktree lifecycle module (create, remove, hash, slug)"
```

---

## Task 2: Prepare-phase dependency install with Bash-call queue

**Files**

- Create: `src/lib/prepare.ts`
- Test: `src/lib/prepare.test.ts`

**Interfaces**

- Consumes: `ForgeConfig` from `@/lib/forge/types` (for `packageManager`).
- Produces:

```ts
export function installCommand(packageManager: ForgeConfig["packageManager"]): [string, string[]]; // e.g. ["pnpm", ["install"]]
export function startInstall(worktreePath: string, packageManager: ForgeConfig["packageManager"]): Promise<{ ok: boolean; output: string }>;
export class BashGate {
  waitUntilReady(): Promise<void>; // resolves once startInstall's promise settles (ok or not - install failure never blocks Bash forever, per the execution model's "does not force failed")
  markReady(): void; // test-only escape hatch
}
```

**Steps**

- [ ] Write the failing test `src/lib/prepare.test.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeScratchDir } from "@/test/helpers";
import { BashGate, installCommand, startInstall } from "./prepare";

describe("installCommand", () => {
  it("maps each package manager to its install invocation", () => {
    expect(installCommand("pnpm")).toEqual(["pnpm", ["install"]]);
    expect(installCommand("npm")).toEqual(["npm", ["install"]]);
    expect(installCommand("yarn")).toEqual(["yarn", ["install"]]);
  });
});

describe("startInstall", () => {
  it("resolves ok:true when the package manager reports success", async () => {
    const { dir, cleanup } = await makeScratchDir();
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0" }), "utf8");
    const result = await startInstall(dir, "npm");
    expect(result.ok).toBe(true);
    await cleanup();
  }, 30_000);

  it("resolves ok:false (never rejects) when the install fails", async () => {
    const { dir, cleanup } = await makeScratchDir();
    // No package.json at all: npm install exits non-zero but the promise must still resolve.
    const result = await startInstall(dir, "npm");
    expect(result.ok).toBe(false);
    expect(result.output.length).toBeGreaterThan(0);
    await cleanup();
  }, 30_000);
});

describe("BashGate", () => {
  it("lets a caller wait for readiness, then never blocks again", async () => {
    const gate = new BashGate();
    let resolved = false;
    const waiter = gate.waitUntilReady().then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);
    gate.markReady();
    await waiter;
    expect(resolved).toBe(true);
    await gate.waitUntilReady(); // already ready: resolves immediately
  });
});
```

- [ ] Run `pnpm vitest run src/lib/prepare.test.ts` and confirm it fails: cannot resolve `./prepare`.
- [ ] Write the implementation `src/lib/prepare.ts`:

```ts
import { execFile } from "node:child_process";
import type { ForgeConfig } from "@/lib/forge/types";

export function installCommand(packageManager: ForgeConfig["packageManager"]): [string, string[]] {
  return [packageManager, ["install"]];
}

/**
 * Runs the install via execFile (never a shell) inside the fresh worktree.
 * Never rejects: an install failure is a warning surfaced to the run, not
 * a hard stop (docs/blueprint/06-execution-model.md: "does not force failed").
 */
export function startInstall(
  worktreePath: string,
  packageManager: ForgeConfig["packageManager"],
): Promise<{ ok: boolean; output: string }> {
  const [command, args] = installCommand(packageManager);
  return new Promise((resolve) => {
    execFile(command, args, { cwd: worktreePath }, (error, stdout, stderr) => {
      resolve({ ok: !error, output: `${stdout}${stderr}` });
    });
  });
}

/**
 * Queues Bash tool calls until the prepare-phase install settles, so the
 * agent's first script execution never races an incomplete node_modules
 * (docs/blueprint/06-execution-model.md: prepare phase). Reading/editing/
 * planning is never gated - only Bash calls wait on this.
 */
export class BashGate {
  private ready = false;
  private waiters: Array<() => void> = [];

  markReady(): void {
    if (this.ready) return;
    this.ready = true;
    for (const resolve of this.waiters.splice(0)) resolve();
  }

  waitUntilReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}
```

- [ ] Run `pnpm vitest run src/lib/prepare.test.ts` again and confirm all 4 tests pass. (Real `npm install` against tiny scratch fixtures - no Agent SDK, no API key, safe unattended; keep the 30s per-test timeout since a real package manager invocation is involved.)
- [ ] Run `pnpm typecheck` and confirm it exits 0.
- [ ] Commit:

```bash
git add src/lib/prepare.ts src/lib/prepare.test.ts
git commit -m "feat: add prepare-phase dependency install and bash-call gate"
```

---

## Task 3: Deny-read glob enforcement and Bash allowlist resolver

**Files**

- Create: `src/lib/permission/deny-read.ts`
- Create: `src/lib/permission/allowlist.ts`
- Test: `src/lib/permission/deny-read.test.ts`
- Test: `src/lib/permission/allowlist.test.ts`

**Interfaces**

- Consumes: `ForgeConfig["denyReadGlobs"]`, `ForgeConfig["bashAllowlist"]` from `@/lib/forge/types`.
- Produces:

```ts
export function isDeniedPath(path: string, denyReadGlobs: string[]): boolean;
export function toSdkDenyRules(denyReadGlobs: string[]): string[]; // "Read(//**/.env*)" shaped, absolute-anchored
export type BashDecision = { kind: "allowlisted" } | { kind: "prompt" };
export function resolveBashCommand(command: string, allowlist: string[]): BashDecision;
```

**Steps**

- [ ] Write the failing test `src/lib/permission/deny-read.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isDeniedPath, toSdkDenyRules } from "./deny-read";

describe("isDeniedPath", () => {
  const globs = [".env*", "*.pem", "*secret*"];

  it("matches files against each configured glob", () => {
    expect(isDeniedPath("/repo/.env.local", globs)).toBe(true);
    expect(isDeniedPath("/repo/keys/server.pem", globs)).toBe(true);
    expect(isDeniedPath("/repo/config/secrets.json", globs)).toBe(true);
    expect(isDeniedPath("/repo/src/index.ts", globs)).toBe(false);
  });

  it("returns false for an empty glob list", () => {
    expect(isDeniedPath("/repo/.env", [])).toBe(false);
  });
});

describe("toSdkDenyRules", () => {
  it("wraps each glob as an absolute-anchored Read() deny rule", () => {
    expect(toSdkDenyRules([".env*", "*.pem"])).toEqual(["Read(//**/.env*)", "Read(//**/*.pem)"]);
  });
});
```

- [ ] Run `pnpm vitest run src/lib/permission/deny-read.test.ts` and confirm it fails: cannot resolve `./deny-read`.
- [ ] Write the implementation `src/lib/permission/deny-read.ts`:

```ts
import picomatch from "picomatch";

/**
 * Checked twice by design (docs/blueprint/02-agent-sdk-guide.md section 9):
 * once as SDK-native disallowedTools deny rules (hold in every permission
 * mode, cannot be overridden by any allow rule), and again as a
 * PreToolUse hook (Task 4) that also covers Grep/Glob explicitly, since
 * the SDK docs do not confirm Read() rules gate those tools too.
 */
export function isDeniedPath(path: string, denyReadGlobs: string[]): boolean {
  if (denyReadGlobs.length === 0) return false;
  return picomatch(denyReadGlobs, { dot: true })(path);
}

/** "//" anchors a disallowedTools rule at the filesystem root (verified, SDK guide section 9.1). */
export function toSdkDenyRules(denyReadGlobs: string[]): string[] {
  return denyReadGlobs.map((glob) => `Read(//**/${glob})`);
}
```

- [ ] Run `pnpm vitest run src/lib/permission/deny-read.test.ts` again and confirm all 3 tests pass.
- [ ] Write the failing test `src/lib/permission/allowlist.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveBashCommand } from "./allowlist";

describe("resolveBashCommand", () => {
  const allowlist = ["pnpm install", "pnpm run *"];

  it("allowlists an exact match", () => {
    expect(resolveBashCommand("pnpm install", allowlist)).toEqual({ kind: "allowlisted" });
  });

  it("allowlists a glob match", () => {
    expect(resolveBashCommand("pnpm run typecheck", allowlist)).toEqual({ kind: "allowlisted" });
  });

  it("prompts for anything not matched", () => {
    expect(resolveBashCommand("rm -rf /", allowlist)).toEqual({ kind: "prompt" });
    expect(resolveBashCommand("curl https://example.com", allowlist)).toEqual({ kind: "prompt" });
  });

  it("prompts when the allowlist is empty", () => {
    expect(resolveBashCommand("pnpm install", [])).toEqual({ kind: "prompt" });
  });
});
```

- [ ] Run `pnpm vitest run src/lib/permission/allowlist.test.ts` and confirm it fails: cannot resolve `./allowlist`.
- [ ] Write the implementation `src/lib/permission/allowlist.ts`:

```ts
import picomatch from "picomatch";

export type BashDecision = { kind: "allowlisted" } | { kind: "prompt" };

/**
 * Exact match first, then glob (docs/blueprint/06-execution-model.md:
 * Bash allowlist resolution). There is no deny-list for Bash - only
 * allow vs. prompt, matching Claude Code's own permission model.
 */
export function resolveBashCommand(command: string, allowlist: string[]): BashDecision {
  if (allowlist.includes(command)) return { kind: "allowlisted" };
  const isAllowed = picomatch(allowlist)(command);
  return isAllowed ? { kind: "allowlisted" } : { kind: "prompt" };
}
```

- [ ] Run `pnpm vitest run src/lib/permission/allowlist.test.ts` again and confirm all 4 tests pass.
- [ ] Add the new dependency: `pnpm add picomatch` and `pnpm add -D @types/picomatch`.
- [ ] Run `pnpm typecheck` and confirm it exits 0.
- [ ] Commit:

```bash
git add src/lib/permission/deny-read.ts src/lib/permission/deny-read.test.ts src/lib/permission/allowlist.ts src/lib/permission/allowlist.test.ts package.json pnpm-lock.yaml
git commit -m "feat: add deny-read glob matching and bash allowlist resolver"
```

---

## Task 4: Permission broker (pending approvals registry + canUseTool bridge)

**Files**

- Create: `src/lib/permission/broker.ts`
- Test: `src/lib/permission/broker.test.ts`

**Interfaces**

- Consumes: `resolveBashCommand` from `./allowlist`; `isDeniedPath` from `./deny-read`; `PermissionDecision` from `@/lib/forge/types`.
- Produces:

```ts
export interface PendingApproval {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  createdAt: string;
}
export function createPermissionBroker(allowlist: string[], denyReadGlobs: string[]): {
  /** The canUseTool-shaped callback; see docs/blueprint/02-agent-sdk-guide.md section 3 for the exact SDK contract this implements. */
  canUseTool: (toolName: string, input: Record<string, unknown>, context: { requestId: string; signal: AbortSignal }) => Promise<{ behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string }>;
  resolve: (requestId: string, decision: "allow" | "always" | "deny") => void;
  pending: () => PendingApproval[];
};
```

**Steps**

- [ ] Write the failing test `src/lib/permission/broker.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createPermissionBroker } from "./broker";

function ctx(): { requestId: string; signal: AbortSignal } {
  return { requestId: "req-1", signal: new AbortController().signal };
}

describe("permission broker", () => {
  it("auto-allows an allowlisted bash command without registering a pending approval", async () => {
    const broker = createPermissionBroker(["pnpm run *"], []);
    const result = await broker.canUseTool("Bash", { command: "pnpm run test" }, ctx());
    expect(result).toEqual({ behavior: "allow", updatedInput: { command: "pnpm run test" } });
    expect(broker.pending()).toEqual([]);
  });

  it("denies a read of a deny-globbed path without prompting", async () => {
    const broker = createPermissionBroker([], [".env*"]);
    const result = await broker.canUseTool("Read", { file_path: "/repo/.env.local" }, ctx());
    expect(result.behavior).toBe("deny");
    expect(broker.pending()).toEqual([]);
  });

  it("pauses a non-allowlisted bash command until resolved", async () => {
    const broker = createPermissionBroker(["pnpm run *"], []);
    const pending = broker.canUseTool("Bash", { command: "rm -rf /tmp/x" }, { requestId: "req-2", signal: new AbortController().signal });
    expect(broker.pending().map((p) => p.requestId)).toEqual(["req-2"]);
    broker.resolve("req-2", "allow");
    const result = await pending;
    expect(result).toEqual({ behavior: "allow", updatedInput: { command: "rm -rf /tmp/x" } });
    expect(broker.pending()).toEqual([]);
  });

  it("denies with a message when the developer clicks deny", async () => {
    const broker = createPermissionBroker([], []);
    const pending = broker.canUseTool("Bash", { command: "curl evil.com" }, { requestId: "req-3", signal: new AbortController().signal });
    broker.resolve("req-3", "deny");
    const result = await pending;
    expect(result.behavior).toBe("deny");
  });

  it("denies automatically when the signal aborts while pending", async () => {
    const controller = new AbortController();
    const broker = createPermissionBroker([], []);
    const pending = broker.canUseTool("Bash", { command: "curl evil.com" }, { requestId: "req-4", signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result.behavior).toBe("deny");
  });

  it("resolving an unknown or already-resolved requestId is a safe no-op", () => {
    const broker = createPermissionBroker([], []);
    expect(() => broker.resolve("req-nope", "allow")).not.toThrow();
  });
});
```

- [ ] Run `pnpm vitest run src/lib/permission/broker.test.ts` and confirm it fails: cannot resolve `./broker`.
- [ ] Write the implementation `src/lib/permission/broker.ts`:

```ts
import { isDeniedPath } from "./deny-read";
import { resolveBashCommand } from "./allowlist";

export interface PendingApproval {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  createdAt: string;
}

type CanUseToolResult =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

interface BrokerContext {
  requestId: string;
  signal: AbortSignal;
}

/**
 * Bridges the app's permission model to the Agent SDK's canUseTool
 * contract (docs/blueprint/02-agent-sdk-guide.md section 3). This
 * function NEVER returns null - an accidental null leaves a tool call
 * blocked forever, since permission prompts have no timeout.
 */
export function createPermissionBroker(
  allowlist: string[],
  denyReadGlobs: string[],
): {
  canUseTool: (
    toolName: string,
    input: Record<string, unknown>,
    context: BrokerContext,
  ) => Promise<CanUseToolResult>;
  resolve: (requestId: string, decision: "allow" | "always" | "deny") => void;
  pending: () => PendingApproval[];
} {
  const waiting = new Map<string, { resolve: (result: CanUseToolResult) => void; approval: PendingApproval }>();

  function readTarget(input: Record<string, unknown>): string | null {
    const target = input.file_path ?? input.path;
    return typeof target === "string" ? target : null;
  }

  async function canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    context: BrokerContext,
  ): Promise<CanUseToolResult> {
    if ((toolName === "Read" || toolName === "Grep" || toolName === "Glob") && denyReadGlobs.length > 0) {
      const target = readTarget(input);
      if (target && isDeniedPath(target, denyReadGlobs)) {
        return { behavior: "deny", message: `Reading ${target} is blocked by the project's deny-read list` };
      }
    }

    if (toolName === "Bash") {
      const command = typeof input.command === "string" ? input.command : "";
      if (resolveBashCommand(command, allowlist).kind === "allowlisted") {
        return { behavior: "allow", updatedInput: input };
      }
    }

    return new Promise<CanUseToolResult>((resolve) => {
      const approval: PendingApproval = {
        requestId: context.requestId,
        toolName,
        input,
        createdAt: new Date().toISOString(),
      };
      waiting.set(context.requestId, { resolve, approval });
      context.signal.addEventListener("abort", () => {
        const entry = waiting.get(context.requestId);
        if (!entry) return;
        waiting.delete(context.requestId);
        entry.resolve({ behavior: "deny", message: "Run interrupted before a permission decision was made" });
      });
    });
  }

  function resolve(requestId: string, decision: "allow" | "always" | "deny"): void {
    const entry = waiting.get(requestId);
    if (!entry) return;
    waiting.delete(requestId);
    if (decision === "deny") {
      entry.resolve({ behavior: "deny", message: "Denied by the developer in the Workbench UI" });
      return;
    }
    entry.resolve({ behavior: "allow", updatedInput: entry.approval.input });
  }

  function pending(): PendingApproval[] {
    return [...waiting.values()].map((entry) => entry.approval);
  }

  return { canUseTool, resolve, pending };
}
```

- [ ] Run `pnpm vitest run src/lib/permission/broker.test.ts` again and confirm all 6 tests pass. (Pure in-memory logic, no Agent SDK call, no API key, safe unattended.)
- [ ] Run `pnpm typecheck` and confirm it exits 0.
- [ ] Commit:

```bash
git add src/lib/permission/broker.ts src/lib/permission/broker.test.ts
git commit -m "feat: add permission broker bridging canUseTool to allowlist and deny-read"
```

---

## Task 5: Agent SDK engine module and the simulator/real-engine seam

> **Manual verification in this task requires `ANTHROPIC_API_KEY` and spends real money. Do not run the manual step without the developer present and having explicitly said to proceed for this session.**

**Files**

- Create: `src/lib/engine.ts`
- Create: `src/lib/session/channel.ts`
- Test: `src/lib/engine.test.ts`
- Test: `src/lib/session/channel.test.ts`

**Interfaces**

- Consumes: nothing new for the seam gate; `@anthropic-ai/claude-agent-sdk`'s `query`, `Options`, `Query`, `SDKUserMessage` types for the channel.
- Produces:

```ts
export function isRealEngineAvailable(): boolean; // false when NODE_ENV === "test" or ANTHROPIC_API_KEY is unset
export class UserMessageChannel implements AsyncIterable<SDKUserMessage> {
  push(content: string): void;
  close(): void;
}
```

**Steps**

- [ ] Add the pinned dependency: `pnpm add @anthropic-ai/claude-agent-sdk@0.3.209` (exact version, no caret - edit `package.json` afterward to confirm the dependency line reads `"@anthropic-ai/claude-agent-sdk": "0.3.209"`, not `"^0.3.209"`).
- [ ] Write the failing test `src/lib/engine.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { isRealEngineAvailable } from "./engine";

describe("isRealEngineAvailable", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is false under NODE_ENV=test even with a key present", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-fake");
    expect(isRealEngineAvailable()).toBe(false);
  });

  it("is false outside test env when no key is set", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(isRealEngineAvailable()).toBe(false);
  });

  it("is true outside test env with a key present", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-fake");
    expect(isRealEngineAvailable()).toBe(true);
  });
});
```

- [ ] Run `pnpm vitest run src/lib/engine.test.ts` and confirm it fails: cannot resolve `./engine`.
- [ ] Write the implementation `src/lib/engine.ts`:

```ts
/**
 * The simulator/real-engine seam (docs/blueprint/02-agent-sdk-guide.md
 * section 10.4, ported from the Forge reference app's isAnthropicReady()).
 * Tests and CI always take the deterministic simulator path and never
 * spawn the Agent SDK subprocess; this is the ONLY gate that decides
 * that, so every other module composes on top of it rather than
 * re-checking env vars itself.
 */
export function isRealEngineAvailable(): boolean {
  if (process.env.NODE_ENV === "test") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim().length > 0);
}
```

- [ ] Run `pnpm vitest run src/lib/engine.test.ts` again and confirm all 3 tests pass.
- [ ] Write the failing test `src/lib/session/channel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { UserMessageChannel } from "./channel";

async function take(iterable: AsyncIterable<{ message: { content: string } }>, n: number): Promise<string[]> {
  const out: string[] = [];
  for await (const message of iterable) {
    out.push(message.message.content);
    if (out.length === n) break;
  }
  return out;
}

describe("UserMessageChannel", () => {
  it("yields a pushed message immediately to an active iterator", async () => {
    const channel = new UserMessageChannel();
    const pending = take(channel, 1);
    channel.push("hello");
    expect(await pending).toEqual(["hello"]);
  });

  it("queues messages pushed before anyone iterates", async () => {
    const channel = new UserMessageChannel();
    channel.push("first");
    channel.push("second");
    expect(await take(channel, 2)).toEqual(["first", "second"]);
  });

  it("ends iteration once closed with no more queued messages", async () => {
    const channel = new UserMessageChannel();
    channel.push("only");
    channel.close();
    const iterator = channel[Symbol.asyncIterator]();
    expect((await iterator.next()).value?.message.content).toBe("only");
    expect((await iterator.next()).done).toBe(true);
  });

  it("ignores a push after close", async () => {
    const channel = new UserMessageChannel();
    channel.close();
    channel.push("too late");
    const iterator = channel[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(true);
  });
});
```

- [ ] Run `pnpm vitest run src/lib/session/channel.test.ts` and confirm it fails: cannot resolve `./channel`.
- [ ] Write the implementation `src/lib/session/channel.ts` (verified pattern, docs/blueprint/02-agent-sdk-guide.md section 2):

```ts
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

type Resolver = (result: IteratorResult<SDKUserMessage, void>) => void;

/**
 * An AsyncIterable the Agent SDK consumes as its streaming-input prompt;
 * our routes push into it to steer a running session. Verified pattern
 * from docs/blueprint/02-agent-sdk-guide.md section 2.
 */
export class UserMessageChannel implements AsyncIterable<SDKUserMessage> {
  private readonly queue: SDKUserMessage[] = [];
  private readonly waiters: Resolver[] = [];
  private closed = false;

  push(content: string): void {
    if (this.closed) return;
    const message: SDKUserMessage = {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
    };
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: message, done: false });
    else this.queue.push(message);
  }

  /** Ends the input stream; the session finishes its current turn and produces a result. */
  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage, void> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage, void>> => {
        const queued = this.queue.shift();
        if (queued) return Promise.resolve({ value: queued, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<SDKUserMessage, void>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}
```

- [ ] Run `pnpm vitest run src/lib/session/channel.test.ts` again and confirm all 4 tests pass.
- [ ] Run `pnpm test` (whole suite) and `pnpm typecheck`, confirm both clean. Nothing in this task's automated tests touches the network or spawns the real SDK subprocess - `isRealEngineAvailable()` is false under `NODE_ENV=test` (vitest's default), so no cost is incurred running the suite.
- [ ] **Manual verification (requires developer present, spends real API credits - do not run unattended):** with `ANTHROPIC_API_KEY` set in the shell, write a short throwaway script that calls `query({ prompt: channel, options: { cwd: <a scratch dir> } })` from `@anthropic-ai/claude-agent-sdk`, pushes one message via `UserMessageChannel`, and logs each `SDKMessage.type` as it arrives, ending on the `result` frame. Confirm a `system`/`init` frame arrives first with a `session_id`, and a `result` frame arrives last with `total_cost_usd`. Delete the throwaway script afterward; do not commit it.
- [ ] Commit (code only, not the throwaway manual-verification script):

```bash
git add package.json pnpm-lock.yaml src/lib/engine.ts src/lib/engine.test.ts src/lib/session/channel.ts src/lib/session/channel.test.ts
git commit -m "feat: add real-engine availability gate and streaming input channel"
```

---

## Task 6: SDKMessage -> RunEvent mapper (the real event source)

> **This task's implementation code has no manual-verification step of its own (it is exercised via the fake-Query test below); the first real end-to-end exercise happens in Task 14 when it is wired into the run manager.**

**Files**

- Create: `src/lib/session/map-events.ts`
- Test: `src/lib/session/map-events.test.ts`

**Interfaces**

- Consumes: `RunEvent`, `RunEventBase` from `@/lib/forge/types`; `SDKMessage` from `@anthropic-ai/claude-agent-sdk`.
- Produces:

```ts
export function mapSdkMessage(message: SDKMessage, seq: number): RunEvent | null; // null when the frame has no RunEvent equivalent (e.g. stream_event without includePartialMessages)
```

**Steps**

- [ ] Write the failing test `src/lib/session/map-events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapSdkMessage } from "./map-events";

describe("mapSdkMessage", () => {
  it("maps a system/init frame to run-started", () => {
    const event = mapSdkMessage(
      {
        type: "system",
        subtype: "init",
        session_id: "sess-1",
        uuid: "u1",
        cwd: "/tmp/wt",
        tools: [],
        model: "claude",
        mcp_servers: [],
        permissionMode: "default",
        slash_commands: [],
        skills: [],
        output_style: "",
        plugins: [],
        apiKeySource: "user",
        claude_code_version: "1.0.0",
      } as never,
      1,
    );
    expect(event).toMatchObject({
      kind: "run-started",
      seq: 1,
      sessionId: "sess-1",
      worktreePath: "/tmp/wt",
    });
  });

  it("maps an assistant text block to a message event", () => {
    const event = mapSdkMessage(
      {
        type: "assistant",
        message: { id: "m1", content: [{ type: "text", text: "Working on it." }], usage: { input_tokens: 10, output_tokens: 5 } },
        parent_tool_use_id: null,
        uuid: "u2",
        session_id: "sess-1",
      } as never,
      2,
    );
    expect(event).toMatchObject({ kind: "message", seq: 2, text: "Working on it." });
  });

  it("maps an assistant tool_use block to a tool-use event", () => {
    const event = mapSdkMessage(
      {
        type: "assistant",
        message: {
          id: "m2",
          content: [{ type: "tool_use", id: "tu-1", name: "Bash", input: { command: "pnpm test" } }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
        parent_tool_use_id: null,
        uuid: "u3",
        session_id: "sess-1",
      } as never,
      3,
    );
    expect(event).toMatchObject({ kind: "tool-use", seq: 3, toolUseId: "tu-1", toolName: "Bash" });
  });

  it("maps a result frame to a terminal phase-change to completed on success", () => {
    const event = mapSdkMessage(
      {
        type: "result",
        subtype: "success",
        result: "done",
        is_error: false,
        num_turns: 3,
        duration_ms: 1000,
        duration_api_ms: 900,
        total_cost_usd: 0.05,
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
        stop_reason: null,
        uuid: "u4",
        session_id: "sess-1",
      } as never,
      4,
    );
    expect(event).toMatchObject({ kind: "phase-change", seq: 4, to: "gates-running" });
  });

  it("maps an error-subtype result frame to a terminal failed phase-change", () => {
    const event = mapSdkMessage(
      {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        num_turns: 1,
        duration_ms: 500,
        duration_api_ms: 400,
        total_cost_usd: 0.01,
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
        stop_reason: null,
        errors: ["boom"],
        uuid: "u5",
        session_id: "sess-1",
      } as never,
      5,
    );
    expect(event).toMatchObject({ kind: "phase-change", seq: 5, to: "failed" });
  });

  it("returns null for a frame type with no RunEvent equivalent", () => {
    expect(mapSdkMessage({ type: "stream_event" } as never, 6)).toBeNull();
  });
});
```

- [ ] Run `pnpm vitest run src/lib/session/map-events.test.ts` and confirm it fails: cannot resolve `./map-events`.
- [ ] Write the implementation `src/lib/session/map-events.ts`:

```ts
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RunEvent } from "@/lib/forge/types";

/**
 * Maps one real Agent SDK message frame to the app's canonical RunEvent
 * protocol (the same protocol the Phase 1 simulator emits), so the
 * reducer, SSE route, and Plan & Progress panel need no changes for
 * Phase 2 (docs/blueprint/02-agent-sdk-guide.md: "spec feature to SDK
 * mechanism map" table). Returns null for frames with no RunEvent
 * equivalent (e.g. stream_event without includePartialMessages, or a
 * system/status frame we do not surface); the caller skips null results.
 */
export function mapSdkMessage(message: SDKMessage, seq: number): RunEvent | null {
  const at = new Date().toISOString();

  if (message.type === "system" && message.subtype === "init") {
    return { kind: "run-started", seq, at, sessionId: message.session_id, worktreePath: message.cwd, branchName: null };
  }

  if (message.type === "assistant") {
    for (const block of message.message.content) {
      if (block.type === "text") {
        return { kind: "message", seq, at, text: block.text };
      }
      if (block.type === "tool_use") {
        return {
          kind: "tool-use",
          seq,
          at,
          toolUseId: block.id,
          toolName: block.name,
          input: block.input as Record<string, unknown>,
        };
      }
    }
    return null;
  }

  if (message.type === "result") {
    const to = message.subtype === "success" ? "gates-running" : "failed";
    return { kind: "phase-change", seq, at, from: "executing", to };
  }

  return null;
}
```

- [ ] Run `pnpm vitest run src/lib/session/map-events.test.ts` again and confirm all 6 tests pass. (Pure function over hand-built fixture objects shaped like real SDK frames - no subprocess, no network, no API key.)
- [ ] Run `pnpm typecheck` and confirm it exits 0.
- [ ] Commit:

```bash
git add src/lib/session/map-events.ts src/lib/session/map-events.test.ts
git commit -m "feat: map agent sdk messages onto the canonical run event protocol"
```

---

## Task 7: Plan/todo tracking (PlanTracker) wired to todo-update events

**Files**

- Create: `src/lib/session/plan-tracker.ts`
- Test: `src/lib/session/plan-tracker.test.ts`

**Interfaces**

- Consumes: `SDKMessage` from `@anthropic-ai/claude-agent-sdk`; `TodoItem`, `TodoStatus` from `@/lib/forge/types`.
- Produces:

```ts
export class PlanTracker {
  ingest(message: SDKMessage): boolean; // true if the plan changed this call
  todos(): TodoItem[]; // ordered: matches insertion order of TaskCreate calls
}
```

**Steps**

- [ ] Write the failing test `src/lib/session/plan-tracker.test.ts`:

```ts
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
```

- [ ] Run `pnpm vitest run src/lib/session/plan-tracker.test.ts` and confirm it fails: cannot resolve `./plan-tracker`.
- [ ] Write the implementation `src/lib/session/plan-tracker.ts` (verified pattern, docs/blueprint/02-agent-sdk-guide.md section 8.2, trimmed to what Workbench's `TodoItem` shape needs):

```ts
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TodoItem, TodoStatus } from "@/lib/forge/types";

const TODO_STATUSES: readonly TodoStatus[] = ["pending", "in_progress", "completed"];

function isTodoStatus(value: unknown): value is TodoStatus {
  return typeof value === "string" && (TODO_STATUSES as readonly string[]).includes(value);
}

/**
 * Tracks TaskCreate/TaskUpdate tool calls into the canonical TodoItem
 * list the Plan & Progress panel renders. Verified parsing gotchas
 * (docs/blueprint/02-agent-sdk-guide.md section 8.1): the task id is NOT
 * in TaskCreate's input, it arrives in the matching tool_result; and the
 * streamed tool_use input is the model's raw emission, so read keys
 * defensively (taskId vs id vs task_id).
 */
export class PlanTracker {
  private readonly items = new Map<string, TodoItem>();
  private readonly pendingCreates = new Map<string, { subject: string }>();

  ingest(message: SDKMessage): boolean {
    let changed = false;

    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type !== "tool_use") continue;
        if (block.name === "TaskCreate") {
          const input = block.input as { subject?: string };
          this.pendingCreates.set(block.id, { subject: input.subject ?? "(untitled)" });
        } else if (block.name === "TaskUpdate") {
          const input = block.input as { taskId?: string; id?: string; task_id?: string; status?: string; subject?: string };
          const taskId = input.taskId ?? input.id ?? input.task_id;
          const item = taskId ? this.items.get(taskId) : undefined;
          if (!item) continue;
          if (isTodoStatus(input.status)) item.status = input.status;
          if (input.subject) {
            item.content = input.subject;
            item.activeForm = input.subject;
          }
          changed = true;
        }
      }
    }

    if (message.type === "user" && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (typeof block !== "object" || block === null) continue;
        const result = block as { type?: string; tool_use_id?: string };
        if (result.type !== "tool_result" || !result.tool_use_id) continue;
        const pending = this.pendingCreates.get(result.tool_use_id);
        if (!pending) continue;
        this.pendingCreates.delete(result.tool_use_id);
        const output = message.tool_use_result as { task?: { id?: string } } | undefined;
        const id = output?.task?.id;
        if (!id) continue;
        this.items.set(id, { content: pending.subject, activeForm: pending.subject, status: "pending" });
        changed = true;
      }
    }

    return changed;
  }

  todos(): TodoItem[] {
    return [...this.items.values()];
  }
}
```

- [ ] Run `pnpm vitest run src/lib/session/plan-tracker.test.ts` again and confirm all 4 tests pass.
- [ ] Run `pnpm typecheck` and confirm it exits 0.
- [ ] Commit:

```bash
git add src/lib/session/plan-tracker.ts src/lib/session/plan-tracker.test.ts
git commit -m "feat: add plan tracker parsing taskcreate/taskupdate into todos"
```

---

## Task 8: Cost tracking (dedupe by message id, accumulate per run)

**Files**

- Create: `src/lib/session/cost-tracker.ts`
- Test: `src/lib/session/cost-tracker.test.ts`

**Interfaces**

- Consumes: `SDKMessage` from `@anthropic-ai/claude-agent-sdk`; `CostRecord` from `@/lib/forge/types`.
- Produces:

```ts
export class CostTracker {
  ingest(message: SDKMessage): CostRecord | null; // returns the new cumulative total when it changed, else null
  total(): CostRecord;
}
```

**Steps**

- [ ] Write the failing test `src/lib/session/cost-tracker.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CostTracker } from "./cost-tracker";

function assistantFrame(id: string, inputTokens: number, outputTokens: number) {
  return {
    type: "assistant",
    message: { id, content: [{ type: "text", text: "..." }], usage: { input_tokens: inputTokens, output_tokens: outputTokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    parent_tool_use_id: null,
    uuid: id,
    session_id: "s1",
  } as never;
}

describe("CostTracker", () => {
  it("accumulates tokens per distinct assistant message id", () => {
    const tracker = new CostTracker();
    const first = tracker.ingest(assistantFrame("m1", 100, 50));
    expect(first?.inputTokens).toBe(100);
    expect(first?.outputTokens).toBe(50);
    const second = tracker.ingest(assistantFrame("m2", 200, 80));
    expect(second?.inputTokens).toBe(300);
    expect(second?.outputTokens).toBe(130);
  });

  it("deduplicates parallel tool calls sharing the same message id", () => {
    const tracker = new CostTracker();
    tracker.ingest(assistantFrame("m1", 100, 50));
    const dup = tracker.ingest(assistantFrame("m1", 100, 50));
    expect(dup).toBeNull();
    expect(tracker.total().inputTokens).toBe(100);
  });

  it("prefers the authoritative result-frame total when one arrives", () => {
    const tracker = new CostTracker();
    tracker.ingest(assistantFrame("m1", 100, 50));
    const result = tracker.ingest({
      type: "result",
      subtype: "success",
      result: "done",
      is_error: false,
      num_turns: 1,
      duration_ms: 1,
      duration_api_ms: 1,
      total_cost_usd: 0.0123,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 },
      modelUsage: {},
      permission_denials: [],
      stop_reason: null,
      uuid: "r1",
      session_id: "s1",
    } as never);
    expect(result?.costUsd).toBe(0.0123);
    expect(tracker.total().costUsd).toBe(0.0123);
  });

  it("starts at zero cost", () => {
    expect(new CostTracker().total()).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 });
  });
});
```

- [ ] Run `pnpm vitest run src/lib/session/cost-tracker.test.ts` and confirm it fails: cannot resolve `./cost-tracker`.
- [ ] Write the implementation `src/lib/session/cost-tracker.ts`:

```ts
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CostRecord } from "@/lib/forge/types";

/**
 * Per-step usage (docs/blueprint/02-agent-sdk-guide.md section 1.5):
 * dedupe by message.message.id since parallel tool calls share one id
 * with identical usage. The result frame's total_cost_usd/usage is
 * authoritative and overrides the running per-step estimate once it
 * arrives - prefer it over summing steps ourselves.
 */
export class CostTracker {
  private cumulative: CostRecord = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
  private readonly seenMessageIds = new Set<string>();

  ingest(message: SDKMessage): CostRecord | null {
    if (message.type === "assistant") {
      const id = message.message.id;
      if (this.seenMessageIds.has(id)) return null;
      this.seenMessageIds.add(id);
      const usage = message.message.usage;
      this.cumulative = {
        inputTokens: this.cumulative.inputTokens + usage.input_tokens,
        outputTokens: this.cumulative.outputTokens + usage.output_tokens,
        cacheReadTokens: this.cumulative.cacheReadTokens + (usage.cache_read_input_tokens ?? 0),
        cacheWriteTokens: this.cumulative.cacheWriteTokens + (usage.cache_creation_input_tokens ?? 0),
        costUsd: this.cumulative.costUsd,
      };
      return this.cumulative;
    }

    if (message.type === "result") {
      this.cumulative = {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
        costUsd: message.total_cost_usd,
      };
      return this.cumulative;
    }

    return null;
  }

  total(): CostRecord {
    return this.cumulative;
  }
}
```

- [ ] Run `pnpm vitest run src/lib/session/cost-tracker.test.ts` again and confirm all 4 tests pass.
- [ ] Run `pnpm typecheck` and confirm it exits 0.
- [ ] Commit:

```bash
git add src/lib/session/cost-tracker.ts src/lib/session/cost-tracker.test.ts
git commit -m "feat: add cost tracker deduping usage by assistant message id"
```

---

## Task 9: Audit log module

**Files**

- Create: `src/lib/audit.ts`
- Test: `src/lib/audit.test.ts`

**Interfaces**

- Consumes: `appendJsonl`, `readJsonl` from `@/lib/forge/jsonl`; `forgeDir` from `@/lib/forge/store`.
- Produces:

```ts
export interface AuditEvent {
  at: string;
  user: string;
  ticketId: string | null;
  event: string; // e.g. "bash_approved", "bash_denied", "read_denied", "run_interrupted"
  detail: Record<string, unknown>;
  appVersion: string;
}
export function appendAuditEvent(projectDir: string, event: Omit<AuditEvent, "at" | "appVersion">): Promise<void>;
export function readAuditEvents(projectDir: string, yyyymm: string): Promise<AuditEvent[]>;
```

**Steps**

- [ ] Write the failing test `src/lib/audit.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeScratchDir } from "@/test/helpers";
import { appendAuditEvent, readAuditEvents } from "./audit";

describe("audit log", () => {
  it("appends to the current month's file and reads it back", async () => {
    const { dir, cleanup } = await makeScratchDir();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00.000Z"));
    await appendAuditEvent(dir, { user: "Dev <dev@example.com>", ticketId: "tkt-1", event: "bash_approved", detail: { command: "pnpm test" } });
    const events = await readAuditEvents(dir, "2026-07");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ user: "Dev <dev@example.com>", ticketId: "tkt-1", event: "bash_approved" });
    expect(events[0].at).toBe("2026-07-16T12:00:00.000Z");
    expect(typeof events[0].appVersion).toBe("string");
    vi.useRealTimers();
    await cleanup();
  });

  it("returns an empty list for a month with no events", async () => {
    const { dir, cleanup } = await makeScratchDir();
    expect(await readAuditEvents(dir, "2020-01")).toEqual([]);
    await cleanup();
  });
});
```

- [ ] Run `pnpm vitest run src/lib/audit.test.ts` and confirm it fails: cannot resolve `./audit`.
- [ ] Write the implementation `src/lib/audit.ts`:

```ts
import { join } from "node:path";
import { appendJsonl, readJsonl } from "@/lib/forge/jsonl";
import { forgeDir } from "@/lib/forge/store";
import { APP_VERSION } from "@/lib/version";

export interface AuditEvent {
  at: string;
  user: string;
  ticketId: string | null;
  event: string;
  detail: Record<string, unknown>;
  appVersion: string;
}

function auditFilePath(projectDir: string, yyyymm: string): string {
  return join(forgeDir(projectDir), "audit", `${yyyymm}.jsonl`);
}

function currentYyyyMm(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Append-only, one file per calendar month (spec: .forge/audit/<YYYY-MM>.jsonl). */
export async function appendAuditEvent(
  projectDir: string,
  event: Omit<AuditEvent, "at" | "appVersion">,
): Promise<void> {
  const full: AuditEvent = { ...event, at: new Date().toISOString(), appVersion: APP_VERSION };
  await appendJsonl(auditFilePath(projectDir, currentYyyyMm()), full);
}

export async function readAuditEvents(projectDir: string, yyyymm: string): Promise<AuditEvent[]> {
  return readJsonl<AuditEvent>(auditFilePath(projectDir, yyyymm));
}
```

- [ ] Run `pnpm vitest run src/lib/audit.test.ts` again and confirm both tests pass.
- [ ] Run `pnpm typecheck` and confirm it exits 0.
- [ ] Commit:

```bash
git add src/lib/audit.ts src/lib/audit.test.ts
git commit -m "feat: add append-only monthly audit log"
```

---

## Task 10: Gate execution module

**Files**

- Create: `src/lib/gates.ts`
- Test: `src/lib/gates.test.ts`

**Interfaces**

- Consumes: `Gate`, `GateName`, `ForgeConfigScripts` from `@/lib/forge/types`.
- Produces:

```ts
export function runGate(worktreePath: string, name: GateName, scriptName: string, packageManager: "npm" | "pnpm" | "yarn", timeoutMs?: number): Promise<Gate>;
```

**Steps**

- [ ] Write the failing test `src/lib/gates.test.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeScratchDir } from "@/test/helpers";
import { runGate } from "./gates";

async function fixtureWithScript(script: string): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const { dir, cleanup } = await makeScratchDir();
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.0.0", scripts: { mygate: script } }, null, 2),
    "utf8",
  );
  return { dir, cleanup };
}

describe("runGate", () => {
  it("passes when the script exits 0", async () => {
    const { dir, cleanup } = await fixtureWithScript("node -e \"process.exit(0)\"");
    const gate = await runGate(dir, "test", "mygate", "npm");
    expect(gate).toMatchObject({ name: "test", basis: "command", status: "passed" });
    await cleanup();
  }, 15_000);

  it("fails when the script exits non-zero, capturing output", async () => {
    const { dir, cleanup } = await fixtureWithScript("node -e \"console.error('boom'); process.exit(1)\"");
    const gate = await runGate(dir, "test", "mygate", "npm");
    expect(gate.status).toBe("failed");
    expect(gate.explanation).toContain("boom");
    await cleanup();
  }, 15_000);

  it("scores warning (never failed) when the script is not configured", async () => {
    const { dir, cleanup } = await makeScratchDir();
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0", scripts: {} }), "utf8");
    const gate = await runGate(dir, "lint", "lint", "npm");
    expect(gate.status).toBe("warning");
    expect(gate.explanation).toMatch(/not configured/);
    await cleanup();
  }, 15_000);

  it("kills the process and fails with a timeout explanation when it exceeds the timeout", async () => {
    const { dir, cleanup } = await fixtureWithScript("node -e \"setTimeout(() => {}, 60000)\"");
    const gate = await runGate(dir, "test", "mygate", "npm", 500);
    expect(gate.status).toBe("failed");
    expect(gate.explanation).toMatch(/timeout/i);
    await cleanup();
  }, 15_000);

  it("truncates very long output keeping the head and tail", async () => {
    const bigOutput = "x".repeat(60_000);
    const { dir, cleanup } = await fixtureWithScript(`node -e "console.error('${bigOutput}'); process.exit(1)"`);
    const gate = await runGate(dir, "test", "mygate", "npm");
    expect(gate.explanation.length).toBeLessThan(bigOutput.length);
    expect(gate.explanation).toContain("truncated");
    await cleanup();
  }, 15_000);
});
```

- [ ] Run `pnpm vitest run src/lib/gates.test.ts` and confirm it fails: cannot resolve `./gates`.
- [ ] Write the implementation `src/lib/gates.ts`:

```ts
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Gate, GateName } from "@/lib/forge/types";

const MAX_OUTPUT_CHARS = 50_000;
const HEAD_TAIL_CHARS = 20_000;

function truncate(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  const head = output.slice(0, HEAD_TAIL_CHARS);
  const tail = output.slice(-HEAD_TAIL_CHARS);
  const cutChars = output.length - HEAD_TAIL_CHARS * 2;
  return `${head}\n... truncated ${Math.round(cutChars / 1000)}k chars ...\n${tail}`;
}

async function scriptExists(worktreePath: string, scriptName: string): Promise<boolean> {
  try {
    const raw = await readFile(join(worktreePath, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return Boolean(pkg.scripts?.[scriptName]);
  } catch {
    return false;
  }
}

/**
 * A gate is a single execFile call (no shell, no agent) against the
 * script name configured in .forge/config.json - the same script name
 * produces the same result regardless of what the agent itself ran
 * (docs/blueprint/06-execution-model.md: gate execution).
 */
export async function runGate(
  worktreePath: string,
  name: GateName,
  scriptName: string,
  packageManager: "npm" | "pnpm" | "yarn",
  timeoutMs = 180_000,
): Promise<Gate> {
  const start = Date.now();

  if (!(await scriptExists(worktreePath, scriptName))) {
    return {
      name,
      basis: "command",
      status: "warning",
      score: 0,
      explanation: `Script "${scriptName}" is not configured in this project's package.json`,
      durationMs: Date.now() - start,
    };
  }

  return new Promise<Gate>((resolve) => {
    const child = execFile(
      packageManager,
      ["run", scriptName],
      { cwd: worktreePath, timeout: timeoutMs, killSignal: "SIGTERM" },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - start;
        const output = `${stdout}${stderr}`;
        if (error && (error as NodeJS.ErrnoException).killed) {
          resolve({
            name,
            basis: "command",
            status: "failed",
            score: 0,
            explanation: `Gate timed out after ${timeoutMs}ms and was killed`,
            durationMs,
          });
          return;
        }
        resolve({
          name,
          basis: "command",
          status: error ? "failed" : "passed",
          score: error ? 0 : 100,
          explanation: error ? truncate(output) : `${scriptName} exited 0`,
          durationMs,
        });
      },
    );
    void child;
  });
}
```

- [ ] Run `pnpm vitest run src/lib/gates.test.ts` again and confirm all 5 tests pass. (Real but tiny `node -e` child processes via a real package manager - no Agent SDK, no network beyond what's already installed locally, no API key.)
- [ ] Run `pnpm typecheck` and confirm it exits 0.
- [ ] Commit:

```bash
git add src/lib/gates.ts src/lib/gates.test.ts
git commit -m "feat: add gate execution with timeout, truncation, and missing-script warning"
```

---

## Task 11: Real run manager - `startAgentRun` wired into the existing seam

> **Manual verification in this task requires `ANTHROPIC_API_KEY` and spends real money. Do not run the manual step without the developer present and having explicitly said to proceed for this session.**

**Files**

- Modify: `src/lib/run/manager.ts`
- Test: `src/lib/run/manager.test.ts` (append a new describe block)

**Interfaces**

- Consumes: everything from Tasks 1-10 (`createWorktree`/`removeWorktree`/`commitAll` from `@/lib/git/worktree`; `startInstall`/`BashGate` from `@/lib/prepare`; `createPermissionBroker` from `@/lib/permission/broker`; `isRealEngineAvailable` from `@/lib/engine`; `UserMessageChannel` from `@/lib/session/channel`; `mapSdkMessage` from `@/lib/session/map-events`; `PlanTracker` from `@/lib/session/plan-tracker`; `CostTracker` from `@/lib/session/cost-tracker`; `runGate` from `@/lib/gates`; `appendAuditEvent` from `@/lib/audit`; `query` from `@anthropic-ai/claude-agent-sdk`.
- Produces:

```ts
export function startRun(projectDir: string, ticket: Ticket, config: ForgeConfig, options?: StartRunOptions): RunHandle;
// Replaces the single call site in src/app/api/tickets/route.ts: startSimulatedRun(...) becomes
// startRun(...), which internally picks startSimulatedRun or startAgentRun via isRealEngineAvailable().
```

**Steps**

- [ ] Append the failing test block to `src/lib/run/manager.test.ts` (this test forces the simulator path deterministically by NOT setting `ANTHROPIC_API_KEY`, so it never spends money or spawns the SDK - it only proves `startRun` correctly delegates to the existing simulator path unchanged):

```ts
import { startRun } from "./manager";
import type { ForgeConfig } from "@/lib/forge/types";
import { DEFAULT_FORGE_CONFIG } from "@/lib/forge/store";

describe("startRun engine seam", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let ticket: Ticket;

  beforeEach(async () => {
    resetRunRegistry();
    ({ dir, cleanup } = await makeScratchDir());
    await initForge(dir);
    ticket = await createTicket(
      dir,
      { type: "generic", title: "Seam check", inputs: { prompt: "Seam check" }, jiraRef: null, source: "manual" },
      DEV,
    );
  });

  afterEach(async () => {
    await cleanup();
  });

  it("delegates to the simulator when the real engine is unavailable (no ANTHROPIC_API_KEY / NODE_ENV=test)", async () => {
    const config: ForgeConfig = DEFAULT_FORGE_CONFIG;
    const handle = startRun(dir, ticket, config);
    await handle.done;
    expect(handle.run.state).toBe("completed");
    expect(handle.run.sessionId).toMatch(/^sim-session-/);
  });
});
```

- [ ] Run `pnpm vitest run src/lib/run/manager.test.ts` and confirm the new block fails: `startRun` is not exported from `./manager`.
- [ ] Rewrite `src/lib/run/manager.ts` in full, adding `startAgentRun` and the `startRun` seam alongside the existing `startSimulatedRun` (kept verbatim - do not delete or rename it):

```ts
import { newId, nowIso } from "@/lib/forge/ids";
import { setTicketStatus } from "@/lib/forge/store";
import { isTerminalState } from "@/lib/forge/types";
import type { ForgeConfig, Run, RunEvent, Ticket } from "@/lib/forge/types";
import { simulateRun } from "@/lib/sim/simulator";
import { initialRunView, reduceRun } from "./reducer";
import type { RunView } from "./reducer";
import { isRealEngineAvailable } from "@/lib/engine";
import { createWorktree, removeWorktree, commitAll } from "@/lib/git/worktree";
import { startInstall, BashGate } from "@/lib/prepare";
import { createPermissionBroker } from "@/lib/permission/broker";
import { UserMessageChannel } from "@/lib/session/channel";
import { mapSdkMessage } from "@/lib/session/map-events";
import { PlanTracker } from "@/lib/session/plan-tracker";
import { CostTracker } from "@/lib/session/cost-tracker";
import { appendAuditEvent } from "@/lib/audit";

/**
 * In-memory registry of runs for the current app process.
 * Phase 1 keeps runs in memory only; Phase 2 adds persistence of the
 * transcript to .forge/local/runs/ so unfinished runs survive an app
 * restart (spec: interrupt, steer, resume) - see Task 13 (Resume/Janitor).
 *
 * The registry hangs off globalThis so Next.js dev-mode module reloads do
 * not orphan running streams.
 */
export interface RunHandle {
  run: Run;
  events: RunEvent[];
  view: RunView;
  done: Promise<void>;
  /** Only present for real agent runs; used by the permission API route and the interrupt/steer routes (Tasks 12-14). */
  control?: {
    channel: UserMessageChannel;
    resolvePermission: (requestId: string, decision: "allow" | "always" | "deny") => void;
    abortController: AbortController;
  };
}

interface RunRecord extends RunHandle {
  listeners: Set<(event: RunEvent) => void>;
}

const globalRuns = globalThis as unknown as { __workbenchRuns?: Map<string, RunRecord> };

function registry(): Map<string, RunRecord> {
  globalRuns.__workbenchRuns ??= new Map();
  return globalRuns.__workbenchRuns;
}

export interface StartRunOptions {
  delayMs?: number;
}

function applyEvent(record: RunRecord, event: RunEvent): void {
  record.events.push(event);
  record.view = reduceRun(record.view, event);
  record.run = {
    ...record.run,
    state: record.view.state,
    sessionId: event.kind === "run-started" ? event.sessionId : record.run.sessionId,
  };
  for (const listener of record.listeners) listener(event);
}

export function startSimulatedRun(
  projectDir: string,
  ticket: Ticket,
  options: StartRunOptions = {},
): RunHandle {
  const runId = newId("run");
  const record: RunRecord = {
    run: {
      id: runId,
      ticketId: ticket.id,
      state: "preparing",
      sessionId: null,
      worktreePath: null,
      iteration: 0,
      approval: null,
      startedAt: nowIso(),
      endedAt: null,
    },
    events: [],
    view: initialRunView(runId),
    listeners: new Set(),
    done: Promise.resolve(),
  };
  registry().set(runId, record);

  record.done = (async (): Promise<void> => {
    try {
      await setTicketStatus(projectDir, ticket.id, "running");
      for await (const event of simulateRun({ runId, delayMs: options.delayMs ?? 0 })) {
        applyEvent(record, event);
      }
      record.run = { ...record.run, endedAt: nowIso() };
      await setTicketStatus(projectDir, ticket.id, "review");
    } catch (error) {
      const seq = (record.events.at(-1)?.seq ?? 0) + 1;
      applyEvent(record, { kind: "error", seq, at: nowIso(), message: error instanceof Error ? error.message : String(error), recoverable: false });
      applyEvent(record, { kind: "phase-change", seq: seq + 1, at: nowIso(), from: record.view.state, to: "failed" });
      record.run = { ...record.run, endedAt: nowIso() };
      try {
        await setTicketStatus(projectDir, ticket.id, "failed");
      } catch {
        // Best-effort: a second disk failure here is already unrecoverable.
      }
    }
  })();

  return record;
}

/**
 * The real Agent SDK path (docs/blueprint/06-execution-model.md: full
 * run lifecycle). Composes every module from Tasks 1-10 behind the same
 * RunHandle/RunEvent shape the simulator produces, so nothing downstream
 * (reducer, SSE route, UI) needs to know which engine produced an event.
 */
export function startAgentRun(projectDir: string, ticket: Ticket, config: ForgeConfig): RunHandle {
  const runId = newId("run");
  const abortController = new AbortController();
  const broker = createPermissionBroker(config.bashAllowlist, config.denyReadGlobs);
  const channel = new UserMessageChannel();
  const bashGate = new BashGate();

  const record: RunRecord = {
    run: {
      id: runId,
      ticketId: ticket.id,
      state: "preparing",
      sessionId: null,
      worktreePath: null,
      iteration: 0,
      approval: null,
      startedAt: nowIso(),
      endedAt: null,
    },
    events: [],
    view: initialRunView(runId),
    listeners: new Set(),
    done: Promise.resolve(),
    control: { channel, resolvePermission: broker.resolve, abortController },
  };
  registry().set(runId, record);

  let seq = 0;
  const nextSeq = (): number => {
    seq += 1;
    return seq;
  };

  record.done = (async (): Promise<void> => {
    try {
      await setTicketStatus(projectDir, ticket.id, "running");
      const { path: worktreePath, branch } = await createWorktree(projectDir, ticket.id, ticket.title, config.baseBranch);
      record.run = { ...record.run, worktreePath };

      void startInstall(worktreePath, config.packageManager).then((result) => {
        bashGate.markReady();
        if (!result.ok) {
          applyEvent(record, { kind: "message", seq: nextSeq(), at: nowIso(), text: `Dependency install reported a problem: ${result.output.slice(0, 500)}` });
        }
      });

      channel.push(ticket.inputs.prompt ?? ticket.title);

      // Lazily imported so this module never pulls the Agent SDK into a
      // bundle that could reach a Client Component (Global Constraints).
      const { query } = await import("@anthropic-ai/claude-agent-sdk");
      const planTracker = new PlanTracker();
      const costTracker = new CostTracker();

      const run = query({
        prompt: channel,
        options: {
          cwd: worktreePath,
          abortController,
          settingSources: ["user", "project", "local"],
          skills: "all",
          canUseTool: async (toolName, input, context) => {
            if (toolName === "Bash") await bashGate.waitUntilReady();
            const result = await broker.canUseTool(toolName, input, context);
            await appendAuditEvent(projectDir, {
              user: ticket.createdBy,
              ticketId: ticket.id,
              event: result.behavior === "allow" ? "tool_allowed" : "tool_denied",
              detail: { toolName, input },
            });
            return result;
          },
        },
      });

      for await (const message of run) {
        const event = mapSdkMessage(message, nextSeq());
        if (event) applyEvent(record, event);

        if (planTracker.ingest(message)) {
          applyEvent(record, { kind: "todo-update", seq: nextSeq(), at: nowIso(), todos: planTracker.todos() });
        }
        const cost = costTracker.ingest(message);
        if (cost) {
          applyEvent(record, { kind: "cost-update", seq: nextSeq(), at: nowIso(), cumulative: cost });
        }
      }
      channel.close();

      applyEvent(record, { kind: "phase-change", seq: nextSeq(), at: nowIso(), from: record.view.state, to: "gates-running" });
      for (const gateName of ticket.gates) {
        const scriptName = config.scripts[gateName as keyof typeof config.scripts] ?? gateName;
        const { runGate } = await import("@/lib/gates");
        const gate = await runGate(worktreePath, gateName, scriptName, config.packageManager);
        applyEvent(record, { kind: "gate-result", seq: nextSeq(), at: nowIso(), gate });
      }

      applyEvent(record, { kind: "phase-change", seq: nextSeq(), at: nowIso(), from: "gates-running", to: "completed" });
      await commitAll(worktreePath, `${ticket.type}: ${ticket.title}\n\nTicket: ${ticket.id}`);
      record.run = { ...record.run, endedAt: nowIso(), branchName: branch };
      await setTicketStatus(projectDir, ticket.id, "review");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      applyEvent(record, { kind: "error", seq: nextSeq(), at: nowIso(), message, recoverable: false });
      applyEvent(record, { kind: "phase-change", seq: nextSeq(), at: nowIso(), from: record.view.state, to: "failed" });
      record.run = { ...record.run, endedAt: nowIso() };
      if (record.run.worktreePath) {
        await removeWorktree(projectDir, record.run.worktreePath).catch(() => {});
      }
      try {
        await setTicketStatus(projectDir, ticket.id, "failed");
      } catch {
        // Best-effort.
      }
    }
  })();

  return record;
}

/** The seam every API route calls; picks the engine so callers never branch on env themselves. */
export function startRun(
  projectDir: string,
  ticket: Ticket,
  config: ForgeConfig,
  options: StartRunOptions = {},
): RunHandle {
  return isRealEngineAvailable() ? startAgentRun(projectDir, ticket, config) : startSimulatedRun(projectDir, ticket, options);
}

export function getRun(runId: string): RunHandle | null {
  return registry().get(runId) ?? null;
}

export function findLatestRunForTicket(ticketId: string): RunHandle | null {
  let latest: RunHandle | null = null;
  for (const record of registry().values()) {
    if (record.run.ticketId === ticketId) latest = record;
  }
  return latest;
}

export function subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
  const record = registry().get(runId);
  if (!record) return () => {};
  for (const event of record.events) listener(event);
  if (isTerminalState(record.view.state)) {
    return () => {};
  }
  record.listeners.add(listener);
  return () => record.listeners.delete(listener);
}

/** Test-only: clears the in-memory run registry between tests. */
export function resetRunRegistry(): void {
  registry().clear();
}
```

**Note for the implementer:** this is a large rewrite of an existing file. Before starting, re-read the CURRENT `src/lib/run/manager.ts` on disk (it has already been extended once, in the final-review fixes after Phase 1, to add try/catch error handling around the simulator's IIFE) and merge that existing error-handling behavior into `startSimulatedRun` above rather than reverting it - the block shown here already includes it, but diff against disk before overwriting to make sure no other Phase-1-era change is lost.

- [ ] Run `pnpm vitest run src/lib/run/manager.test.ts` and confirm the new "startRun engine seam" test passes, and every pre-existing test in this file (from Phase 1 and the final-review fix) still passes too.
- [ ] Update the one caller, `src/app/api/tickets/route.ts`: replace the import and call `startSimulatedRun(projectDir, ticket, { delayMs: getSimDelayMs() })` with `startRun(projectDir, ticket, await readForgeConfig(projectDir), { delayMs: getSimDelayMs() })` (import `readForgeConfig` from `@/lib/forge/store`; the `{ delayMs }` option is ignored by `startAgentRun` but still respected by `startSimulatedRun` under the hood, so existing Phase 1 tests and the Playwright e2e - which never set `ANTHROPIC_API_KEY` - keep working unchanged).
- [ ] Run `pnpm test` (whole suite) and `pnpm typecheck`, confirm both clean. Confirm `pnpm e2e` still passes (it runs with no `ANTHROPIC_API_KEY` set, so `startRun` takes the simulator path exactly as before - zero cost, zero behavior change for e2e).
- [ ] **Manual verification (requires developer present, spends real API credits - do not run unattended):** with `ANTHROPIC_API_KEY` set and a real scratch git project as `FORGE_PROJECT_DIR`, run `pnpm dev` and create one real ticket from the UI. Confirm: a real worktree appears under `~/.agent-workbench/worktrees/`, the Plan & Progress panel shows real todos and a real ticking cost, and the ticket lands in Review with `.forge/tickets/<id>/ticket.json`'s `branchName` set to a real `forge/<slug>` branch that exists in the target repo. Clean up the scratch project and its worktree afterward.
- [ ] Commit:

```bash
git add src/lib/run/manager.ts src/lib/run/manager.test.ts src/app/api/tickets/route.ts
git commit -m "feat: add real agent run engine wired through the existing run manager seam"
```

---

## Task 12: Interrupt and steer routes

**Files**

- Create: `src/app/api/runs/[runId]/interrupt/route.ts`
- Create: `src/app/api/runs/[runId]/steer/route.ts`
- Test: `src/app/api/runs/[runId]/interrupt/route.test.ts`
- Test: `src/app/api/runs/[runId]/steer/route.test.ts`

**Interfaces**

- Consumes: `getRun` from `@/lib/run/manager`.
- Produces:

```ts
export function POST(req: Request, ctx: { params: Promise<{ runId: string }> }): Promise<Response>; // both routes
```

**Steps**

- [ ] Write the failing test `src/app/api/runs/[runId]/interrupt/route.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createTicket, initForge } from "@/lib/forge/store";
import { resetRunRegistry, startSimulatedRun } from "@/lib/run/manager";
import { makeScratchDir } from "@/test/helpers";
import { POST } from "./route";

describe("POST /api/runs/[runId]/interrupt", () => {
  it("returns 404 for an unknown run", async () => {
    resetRunRegistry();
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ runId: "run-nope" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a simulated run with no control channel (nothing to interrupt)", async () => {
    resetRunRegistry();
    const { dir, cleanup } = await makeScratchDir();
    await initForge(dir);
    const ticket = await createTicket(dir, { type: "generic", title: "t", inputs: { prompt: "t" }, jiraRef: null, source: "manual" }, "Dev <d@e.com>");
    const handle = startSimulatedRun(dir, ticket, { delayMs: 50 });
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ runId: handle.run.id }) });
    expect(res.status).toBe(400);
    await handle.done;
    await cleanup();
  });
});
```

- [ ] Run `pnpm vitest run "src/app/api/runs/[runId]/interrupt/route.test.ts"` and confirm it fails: cannot resolve `./route`.
- [ ] Write the implementation `src/app/api/runs/[runId]/interrupt/route.ts`:

```ts
import { getRun } from "@/lib/run/manager";

export const dynamic = "force-dynamic";

/** Stop button: aborts the run's Agent SDK session (docs/blueprint/06-execution-model.md: interrupt). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await params;
  const handle = getRun(runId);
  if (!handle) return Response.json({ error: "run not found" }, { status: 404 });
  if (!handle.control) return Response.json({ error: "this run cannot be interrupted" }, { status: 400 });
  handle.control.abortController.abort();
  return Response.json({ ok: true });
}
```

- [ ] Run `pnpm vitest run "src/app/api/runs/[runId]/interrupt/route.test.ts"` again and confirm both tests pass.
- [ ] Write the failing test `src/app/api/runs/[runId]/steer/route.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTicket, initForge } from "@/lib/forge/store";
import { resetRunRegistry, startSimulatedRun } from "@/lib/run/manager";
import { makeScratchDir } from "@/test/helpers";
import { POST } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("POST /api/runs/[runId]/steer", () => {
  it("returns 404 for an unknown run", async () => {
    resetRunRegistry();
    const res = await POST(jsonRequest({ message: "hi" }), { params: Promise.resolve({ runId: "run-nope" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a run with no control channel", async () => {
    resetRunRegistry();
    const { dir, cleanup } = await makeScratchDir();
    await initForge(dir);
    const ticket = await createTicket(dir, { type: "generic", title: "t", inputs: { prompt: "t" }, jiraRef: null, source: "manual" }, "Dev <d@e.com>");
    const handle = startSimulatedRun(dir, ticket, { delayMs: 50 });
    const res = await POST(jsonRequest({ message: "hi" }), { params: Promise.resolve({ runId: handle.run.id }) });
    expect(res.status).toBe(400);
    await handle.done;
    await cleanup();
  });

  it("returns 400 for an empty message", async () => {
    resetRunRegistry();
    const res = await POST(jsonRequest({ message: "  " }), { params: Promise.resolve({ runId: "run-nope" }) });
    expect(res.status).toBe(400);
  });
});
```

- [ ] Run `pnpm vitest run "src/app/api/runs/[runId]/steer/route.test.ts"` and confirm it fails: cannot resolve `./route`.
- [ ] Write the implementation `src/app/api/runs/[runId]/steer/route.ts`:

```ts
import { getRun } from "@/lib/run/manager";

export const dynamic = "force-dynamic";

interface SteerBody {
  message?: unknown;
}

/** Pushes a chat message onto a running session's input stream (docs/blueprint/06-execution-model.md: steer). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await params;
  const parsed: unknown = await req.json().catch(() => null);
  const body = (typeof parsed === "object" && parsed !== null ? parsed : {}) as SteerBody;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length === 0) return Response.json({ error: "message must not be empty" }, { status: 400 });

  const handle = getRun(runId);
  if (!handle) return Response.json({ error: "run not found" }, { status: 404 });
  if (!handle.control) return Response.json({ error: "this run cannot be steered" }, { status: 400 });
  handle.control.channel.push(message);
  return Response.json({ ok: true });
}
```

- [ ] Run `pnpm vitest run "src/app/api/runs/[runId]/steer/route.test.ts"` again and confirm all 3 tests pass.
- [ ] Run `pnpm test` (whole suite) and `pnpm typecheck`, confirm both clean.
- [ ] Commit:

```bash
git add "src/app/api/runs/[runId]/interrupt/route.ts" "src/app/api/runs/[runId]/interrupt/route.test.ts" "src/app/api/runs/[runId]/steer/route.ts" "src/app/api/runs/[runId]/steer/route.test.ts"
git commit -m "feat: add interrupt and steer routes for live runs"
```

---

## Task 13: Permission decision route + UI prompt in the Plan & Progress panel

**Files**

- Create: `src/app/api/runs/[runId]/approvals/[requestId]/route.ts`
- Test: `src/app/api/runs/[runId]/approvals/[requestId]/route.test.ts`
- Modify: `src/components/run/plan-progress-panel.tsx`

**Interfaces**

- Consumes: `getRun` from `@/lib/run/manager`.
- Produces:

```ts
export function POST(req: Request, ctx: { params: Promise<{ runId: string; requestId: string }> }): Promise<Response>;
```

**Steps**

- [ ] Write the failing test `src/app/api/runs/[runId]/approvals/[requestId]/route.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { POST } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("POST /api/runs/[runId]/approvals/[requestId]", () => {
  it("returns 404 for an unknown run", async () => {
    const res = await POST(jsonRequest({ decision: "allow" }), { params: Promise.resolve({ runId: "run-nope", requestId: "req-1" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid decision value", async () => {
    const res = await POST(jsonRequest({ decision: "maybe" }), { params: Promise.resolve({ runId: "run-nope", requestId: "req-1" }) });
    expect(res.status).toBe(400);
  });
});
```

- [ ] Run `pnpm vitest run "src/app/api/runs/[runId]/approvals/[requestId]/route.test.ts"` and confirm it fails: cannot resolve `./route`.
- [ ] Write the implementation `src/app/api/runs/[runId]/approvals/[requestId]/route.ts`:

```ts
import { getRun } from "@/lib/run/manager";

export const dynamic = "force-dynamic";

const VALID_DECISIONS = ["allow", "always", "deny"] as const;
type Decision = (typeof VALID_DECISIONS)[number];

function isDecision(value: unknown): value is Decision {
  return typeof value === "string" && (VALID_DECISIONS as readonly string[]).includes(value);
}

/** Resolves a paused permission_request from the UI's approve/allowlist/deny buttons. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string; requestId: string }> },
): Promise<Response> {
  const { runId, requestId } = await params;
  const parsed: unknown = await req.json().catch(() => null);
  const body = (typeof parsed === "object" && parsed !== null ? parsed : {}) as { decision?: unknown };
  if (!isDecision(body.decision)) {
    return Response.json({ error: "decision must be one of allow, always, deny" }, { status: 400 });
  }

  const handle = getRun(runId);
  if (!handle || !handle.control) return Response.json({ error: "run not found" }, { status: 404 });
  handle.control.resolvePermission(requestId, body.decision);
  return Response.json({ ok: true });
}
```

- [ ] Run `pnpm vitest run "src/app/api/runs/[runId]/approvals/[requestId]/route.test.ts"` again and confirm both tests pass.
- [ ] Modify `src/components/run/plan-progress-panel.tsx`: read its current contents first (it already renders todos, gates, and cost from `RunView`), then add a permission-prompt block that renders when `view.state === "awaiting-permission"`. Since the current `RunView`/reducer (Phase 1) does not yet carry the pending request's `toolName`/`input`/`requestId`, this step also requires: (a) confirming `RunEvent`'s existing `permission-request`/`permission-decision` variants (already defined in `src/lib/forge/types.ts` since Phase 1's canonical model included the full 16-variant union) are folded by `reduceRun` into a new `RunView.pendingPermission: { requestId: string; toolName: string; input: Record<string, unknown> } | null` field, (b) adding that fold logic to `src/lib/run/reducer.ts` with a matching reducer test, (c) rendering an inline approve/allowlist/deny button group that POSTs to `/api/runs/${runId}/approvals/${pendingPermission.requestId}` with `{ decision }` and calls `router.refresh()`-equivalent (the existing SSE stream will naturally emit the next event once resolved, so no manual refresh is needed here, only a temporary "sending..." disabled state on the clicked button).
- [ ] Add a reducer test to `src/lib/run/reducer.test.ts` asserting a `permission-request` event sets `view.pendingPermission` and a subsequent `permission-decision` event clears it back to `null`.
- [ ] Run `pnpm test` (whole suite) and `pnpm typecheck`, confirm both clean.
- [ ] Commit:

```bash
git add "src/app/api/runs/[runId]/approvals/[requestId]/route.ts" "src/app/api/runs/[runId]/approvals/[requestId]/route.test.ts" src/lib/run/reducer.ts src/lib/run/reducer.test.ts src/components/run/plan-progress-panel.tsx
git commit -m "feat: add permission decision route and inline approval UI"
```

---

## Task 14: Resume after restart and the launch-time janitor

**Files**

- Create: `src/lib/run/persist.ts`
- Create: `src/lib/run/janitor.ts`
- Test: `src/lib/run/persist.test.ts`
- Test: `src/lib/run/janitor.test.ts`

**Interfaces**

- Consumes: `appendJsonl`, `readJsonl` from `@/lib/forge/jsonl`; `RunState` from `@/lib/forge/types`.
- Produces:

```ts
export interface RunStateLine {
  type: "state";
  state: RunState;
  sessionId: string | null;
  worktreePath: string | null;
  branch: string | null;
  iteration: number;
  at: string;
}
export function runTranscriptPath(projectDir: string, ticketId: string, runId: string): string;
export function appendRunState(projectDir: string, ticketId: string, runId: string, line: Omit<RunStateLine, "type" | "at">): Promise<void>;
export function readLastRunState(projectDir: string, ticketId: string, runId: string): Promise<RunStateLine | null>;

export interface OrphanedRun { ticketId: string; runId: string; state: RunStateLine }
export function findOrphanedRuns(projectDir: string, liveRunIds: Set<string>): Promise<OrphanedRun[]>;
```

**Steps**

- [ ] Write the failing test `src/lib/run/persist.test.ts`:

```ts
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
```

- [ ] Run `pnpm vitest run src/lib/run/persist.test.ts` and confirm it fails: cannot resolve `./persist`.
- [ ] Write the implementation `src/lib/run/persist.ts`:

```ts
import { join } from "node:path";
import { appendJsonl, readJsonl } from "@/lib/forge/jsonl";
import { forgeDir } from "@/lib/forge/store";
import type { RunState } from "@/lib/forge/types";

export interface RunStateLine {
  type: "state";
  state: RunState;
  sessionId: string | null;
  worktreePath: string | null;
  branch: string | null;
  iteration: number;
  at: string;
}

/**
 * One state line per transition, shared with the full event transcript
 * under the same file (distinguished by "type"), so resume only ever
 * reads one file and takes its last type:"state" line
 * (docs/blueprint/06-execution-model.md: resume after app restart).
 */
export function runTranscriptPath(projectDir: string, ticketId: string, runId: string): string {
  return join(forgeDir(projectDir), "local", "runs", ticketId, `${runId}.jsonl`);
}

export async function appendRunState(
  projectDir: string,
  ticketId: string,
  runId: string,
  line: Omit<RunStateLine, "type" | "at">,
): Promise<void> {
  await appendJsonl(runTranscriptPath(projectDir, ticketId, runId), { type: "state", ...line, at: new Date().toISOString() });
}

export async function readLastRunState(
  projectDir: string,
  ticketId: string,
  runId: string,
): Promise<RunStateLine | null> {
  const lines = await readJsonl<RunStateLine | { type: string }>(runTranscriptPath(projectDir, ticketId, runId));
  const stateLines = lines.filter((line): line is RunStateLine => line.type === "state");
  return stateLines.at(-1) ?? null;
}
```

- [ ] Run `pnpm vitest run src/lib/run/persist.test.ts` again and confirm both tests pass.
- [ ] Write the failing test `src/lib/run/janitor.test.ts`:

```ts
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
```

- [ ] Run `pnpm vitest run src/lib/run/janitor.test.ts` and confirm it fails: cannot resolve `./janitor`.
- [ ] Write the implementation `src/lib/run/janitor.ts`:

```ts
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { forgeDir } from "@/lib/forge/store";
import { isTerminalState } from "@/lib/forge/types";
import { readLastRunState, type RunStateLine } from "./persist";

export interface OrphanedRun {
  ticketId: string;
  runId: string;
  state: RunStateLine;
}

async function listDirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Scans .forge/local/runs/ for runs whose last persisted state is
 * non-terminal but which have no live in-memory tracker in the current
 * process (docs/blueprint/06-execution-model.md: janitor on launch).
 * Orphaned runs with no state record at all (crash before any state
 * line was written) are a separate janitor case, handled at the UI
 * layer by listing worktree directories with no matching ticket/run.
 */
export async function findOrphanedRuns(projectDir: string, liveRunIds: Set<string>): Promise<OrphanedRun[]> {
  const runsDir = join(forgeDir(projectDir), "local", "runs");
  const orphans: OrphanedRun[] = [];
  for (const ticketId of await listDirs(runsDir)) {
    const ticketRunsDir = join(runsDir, ticketId);
    let runFiles: string[];
    try {
      runFiles = (await readdir(ticketRunsDir)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of runFiles) {
      const runId = file.replace(/\.jsonl$/, "");
      if (liveRunIds.has(runId)) continue;
      const state = await readLastRunState(projectDir, ticketId, runId);
      if (!state || isTerminalState(state.state)) continue;
      orphans.push({ ticketId, runId, state });
    }
  }
  return orphans;
}
```

- [ ] Run `pnpm vitest run src/lib/run/janitor.test.ts` again and confirm all 4 tests pass.
- [ ] Wire `appendRunState` into `startAgentRun` (Task 11): call it after every `record.run` update inside the try block (after worktree creation, and again in the final catch block on failure) so a real crash mid-run leaves a resumable transcript. This wiring is intentionally left to the implementer of this task rather than fully inlined here, since it touches the large `manager.ts` function from Task 11 - add the calls at each of the state transitions already present in that function's try/catch, matching the shape `{ state: record.run.state, sessionId: record.run.sessionId, worktreePath: record.run.worktreePath, branch: record.run.branchName, iteration: record.run.iteration }`.
- [ ] Add one integration test to `src/lib/run/manager.test.ts` asserting that after a real (or simulated, for the automated test - reuse `startSimulatedRun` here since this is testing the persistence wiring, not the SDK) run completes, `readLastRunState` for that run's ticket/run id returns a terminal state matching `handle.run.state`.
- [ ] Run `pnpm test` (whole suite) and `pnpm typecheck`, confirm both clean.
- [ ] Commit:

```bash
git add src/lib/run/persist.ts src/lib/run/persist.test.ts src/lib/run/janitor.ts src/lib/run/janitor.test.ts src/lib/run/manager.ts src/lib/run/manager.test.ts
git commit -m "feat: add run state persistence and launch-time janitor for orphaned runs"
```

---

## Task 15: Approval and rejection routes

**Files**

- Create: `src/app/api/tickets/[id]/approve/route.ts`
- Create: `src/app/api/tickets/[id]/reject/route.ts`
- Test: `src/app/api/tickets/[id]/approve/route.test.ts`
- Test: `src/app/api/tickets/[id]/reject/route.test.ts`
- Modify: `src/app/tasks/[id]/page.tsx` (add approve/reject buttons, visible only when `ticket.status === "review"`)

**Interfaces**

- Consumes: `readTicket`, `setTicketStatus` from `@/lib/forge/store`; `getProjectDir` from `@/lib/project`; `getRun`, `findLatestRunForTicket` from `@/lib/run/manager`; `hasDiff` from `@/lib/git/worktree` (branch-has-commits check for rejection's keep-vs-delete rule uses `git log baseBranch..HEAD --oneline` instead, added as a small addition to `src/lib/git/worktree.ts` in this task: `export function hasCommitsSinceBase(worktreePath: string, baseBranch: string): Promise<boolean>`).
- Produces:

```ts
export function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response>; // both routes, 200 { ok: true } or 404/400
```

**Steps**

- [ ] Add the failing test and implementation for `hasCommitsSinceBase` in `src/lib/git/worktree.ts`/`worktree.test.ts` first (append to the existing describe block from Task 1):

```ts
// Appended to src/lib/git/worktree.test.ts:
it("detects whether a worktree branch has commits beyond its base", async () => {
  const { path } = await createWorktree(dir, "tkt-approve01", "Approve check", "main");
  createdWorktrees.push(path);
  expect(await hasCommitsSinceBase(path, "main")).toBe(false);
  await writeFile(join(path, "README.md"), "hello\nedited\n", "utf8");
  await commitAll(path, "real work");
  expect(await hasCommitsSinceBase(path, "main")).toBe(true);
});
```

```ts
// Appended to src/lib/git/worktree.ts:
export async function hasCommitsSinceBase(worktreePath: string, baseBranch: string): Promise<boolean> {
  const { stdout } = await execFileAsync("git", ["log", `${baseBranch}..HEAD`, "--oneline"], { cwd: worktreePath });
  return stdout.trim().length > 0;
}
```

- [ ] Run `pnpm vitest run src/lib/git/worktree.test.ts` and confirm all 8 tests (7 original + 1 new) pass.
- [ ] Write the failing test `src/app/api/tickets/[id]/approve/route.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createTicket, initForge, readTicket } from "@/lib/forge/store";
import { resetRunRegistry } from "@/lib/run/manager";
import { makeScratchDir } from "@/test/helpers";
import { POST } from "./route";

describe("POST /api/tickets/[id]/approve", () => {
  it("returns 404 for an unknown ticket", async () => {
    resetRunRegistry();
    const { dir, cleanup } = await makeScratchDir();
    vi.stubEnv("FORGE_PROJECT_DIR", dir);
    await initForge(dir);
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id: "tkt-nope" }) });
    expect(res.status).toBe(404);
    vi.unstubAllEnvs();
    await cleanup();
  });

  it("returns 400 for a ticket not in review status", async () => {
    resetRunRegistry();
    const { dir, cleanup } = await makeScratchDir();
    vi.stubEnv("FORGE_PROJECT_DIR", dir);
    await initForge(dir);
    const ticket = await createTicket(dir, { type: "generic", title: "t", inputs: { prompt: "t" }, jiraRef: null, source: "manual" }, "Dev <d@e.com>");
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id: ticket.id }) });
    expect(res.status).toBe(400);
    vi.unstubAllEnvs();
    await cleanup();
  });

  it("marks a review ticket done when no live run/worktree remains (simulator-completed case)", async () => {
    resetRunRegistry();
    const { dir, cleanup } = await makeScratchDir();
    vi.stubEnv("FORGE_PROJECT_DIR", dir);
    await initForge(dir);
    let ticket = await createTicket(dir, { type: "generic", title: "t", inputs: { prompt: "t" }, jiraRef: null, source: "manual" }, "Dev <d@e.com>");
    const { setTicketStatus } = await import("@/lib/forge/store");
    ticket = await setTicketStatus(dir, ticket.id, "review");
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id: ticket.id }) });
    expect(res.status).toBe(200);
    expect((await readTicket(dir, ticket.id))?.status).toBe("done");
    vi.unstubAllEnvs();
    await cleanup();
  });
});
```

- [ ] Run `pnpm vitest run "src/app/api/tickets/[id]/approve/route.test.ts"` and confirm it fails: cannot resolve `./route`.
- [ ] Write the implementation `src/app/api/tickets/[id]/approve/route.ts`:

```ts
import { commitAll, removeWorktree } from "@/lib/git/worktree";
import { readTicket, setTicketStatus } from "@/lib/forge/store";
import { getProjectDir } from "@/lib/project";
import { findLatestRunForTicket } from "@/lib/run/manager";

export const dynamic = "force-dynamic";

/**
 * Approval (docs/blueprint/06-execution-model.md): the app's own commit
 * step is the sole authority for what lands, run unconditionally even
 * if the agent already committed mid-session; worktree removed, branch
 * kept for the developer to merge/push manually.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  let projectDir: string;
  try {
    projectDir = getProjectDir();
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }

  const ticket = await readTicket(projectDir, id);
  if (!ticket) return Response.json({ error: "ticket not found" }, { status: 404 });
  if (ticket.status !== "review") {
    return Response.json({ error: `ticket is not awaiting review (status: ${ticket.status})` }, { status: 400 });
  }

  const handle = findLatestRunForTicket(id);
  const worktreePath = handle?.run.worktreePath ?? null;
  if (worktreePath) {
    await commitAll(worktreePath, `${ticket.type}: ${ticket.title}\n\nTicket: ${ticket.id}`);
    await removeWorktree(projectDir, worktreePath);
  }

  await setTicketStatus(projectDir, id, "done");
  return Response.json({ ok: true });
}
```

- [ ] Run `pnpm vitest run "src/app/api/tickets/[id]/approve/route.test.ts"` again and confirm all 3 tests pass.
- [ ] Write the failing test `src/app/api/tickets/[id]/reject/route.test.ts` (mirrors approve's three cases, swapping the expected terminal status to `"rejected"`):

```ts
import { describe, expect, it, vi } from "vitest";
import { createTicket, initForge, readTicket, setTicketStatus } from "@/lib/forge/store";
import { resetRunRegistry } from "@/lib/run/manager";
import { makeScratchDir } from "@/test/helpers";
import { POST } from "./route";

describe("POST /api/tickets/[id]/reject", () => {
  it("returns 404 for an unknown ticket", async () => {
    resetRunRegistry();
    const { dir, cleanup } = await makeScratchDir();
    vi.stubEnv("FORGE_PROJECT_DIR", dir);
    await initForge(dir);
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id: "tkt-nope" }) });
    expect(res.status).toBe(404);
    vi.unstubAllEnvs();
    await cleanup();
  });

  it("returns 400 for a ticket not in review status", async () => {
    resetRunRegistry();
    const { dir, cleanup } = await makeScratchDir();
    vi.stubEnv("FORGE_PROJECT_DIR", dir);
    await initForge(dir);
    const ticket = await createTicket(dir, { type: "generic", title: "t", inputs: { prompt: "t" }, jiraRef: null, source: "manual" }, "Dev <d@e.com>");
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id: ticket.id }) });
    expect(res.status).toBe(400);
    vi.unstubAllEnvs();
    await cleanup();
  });

  it("marks a review ticket rejected when no live run/worktree remains", async () => {
    resetRunRegistry();
    const { dir, cleanup } = await makeScratchDir();
    vi.stubEnv("FORGE_PROJECT_DIR", dir);
    await initForge(dir);
    let ticket = await createTicket(dir, { type: "generic", title: "t", inputs: { prompt: "t" }, jiraRef: null, source: "manual" }, "Dev <d@e.com>");
    ticket = await setTicketStatus(dir, ticket.id, "review");
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id: ticket.id }) });
    expect(res.status).toBe(200);
    expect((await readTicket(dir, ticket.id))?.status).toBe("rejected");
    vi.unstubAllEnvs();
    await cleanup();
  });
});
```

- [ ] Run `pnpm vitest run "src/app/api/tickets/[id]/reject/route.test.ts"` and confirm it fails: cannot resolve `./route`.
- [ ] Write the implementation `src/app/api/tickets/[id]/reject/route.ts`:

```ts
import { commitAll, hasCommitsSinceBase, removeWorktree } from "@/lib/git/worktree";
import { readForgeConfig, readTicket, setTicketStatus } from "@/lib/forge/store";
import { getProjectDir } from "@/lib/project";
import { findLatestRunForTicket } from "@/lib/run/manager";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Rejection (docs/blueprint/06-execution-model.md): same auto-commit as
 * approval so no diff is lost, but the branch is deleted rather than
 * kept when it has zero commits beyond base (nothing worth inspecting).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  let projectDir: string;
  try {
    projectDir = getProjectDir();
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }

  const ticket = await readTicket(projectDir, id);
  if (!ticket) return Response.json({ error: "ticket not found" }, { status: 404 });
  if (ticket.status !== "review") {
    return Response.json({ error: `ticket is not awaiting review (status: ${ticket.status})` }, { status: 400 });
  }

  const handle = findLatestRunForTicket(id);
  const worktreePath = handle?.run.worktreePath ?? null;
  const branch = handle?.run.branchName ?? null;
  if (worktreePath) {
    await commitAll(worktreePath, `${ticket.type}: ${ticket.title}\n\nTicket: ${ticket.id}`);
    const config = await readForgeConfig(projectDir);
    const keepBranch = await hasCommitsSinceBase(worktreePath, config.baseBranch);
    await removeWorktree(projectDir, worktreePath);
    if (!keepBranch && branch) {
      await execFileAsync("git", ["branch", "-D", branch], { cwd: projectDir }).catch(() => {});
    }
  }

  await setTicketStatus(projectDir, id, "rejected");
  return Response.json({ ok: true });
}
```

- [ ] Run `pnpm vitest run "src/app/api/tickets/[id]/reject/route.test.ts"` again and confirm all 3 tests pass.
- [ ] Modify `src/app/tasks/[id]/page.tsx`: read its current contents first, then add an "Approve" and "Reject" button pair (a small new client component, e.g. `src/components/run/approval-actions.tsx`, following the existing `create-box.tsx` pattern of a `"use client"` component with local pending/error state) rendered only when `ticket.status === "review"`, POSTing to `/api/tickets/${ticket.id}/approve` or `/reject` and calling `router.push("/")` plus `router.refresh()` on success.
- [ ] Run `pnpm test` (whole suite), `pnpm typecheck`, `pnpm lint`, confirm all clean.
- [ ] Commit:

```bash
git add "src/app/api/tickets/[id]/approve/route.ts" "src/app/api/tickets/[id]/approve/route.test.ts" "src/app/api/tickets/[id]/reject/route.ts" "src/app/api/tickets/[id]/reject/route.test.ts" src/lib/git/worktree.ts src/lib/git/worktree.test.ts src/components/run/approval-actions.tsx src/app/tasks/[id]/page.tsx
git commit -m "feat: add approve and reject routes with worktree cleanup"
```

---

## Known gaps - required before this plan satisfies the Phase 2 exit criteria in full

Self-review against `docs/blueprint/08-roadmap.md`'s Phase 2 key-deliverables list found four real gaps Tasks 1-15 do not close. Rather than silently omit them or paper over them with a vague step, they are named here specifically so a Task 16+ addendum (written the same way as this plan, task-by-task with complete code, per the roadmap's "each phase gets its own detailed plan" rule) can close them before Phase 2 is actually declared done:

1. **Gate-feedback loop (iteration state machine) is not implemented.** Task 10 builds `runGate` (a single execution), and Task 11's `startAgentRun` currently runs each configured gate exactly once with no retry. Missing: the `awaiting-iteration-approval` `RunState` transition, resuming the agent session with the previous gate failure's truncated output fed back as the next user message (via `channel.push(...)`, reusing the same `UserMessageChannel` and `resume`+`cwd` pattern from `docs/blueprint/02-agent-sdk-guide.md` section 4.2), the 3-iteration cap (docs/blueprint/06-execution-model.md: "Gate-feedback loop"), the projected-retry-cost calculation shown before iteration 2 (average of the cost-so-far, projected one iteration forward), and accumulating `CostTracker` totals *across* iterations rather than resetting per `query()` call (each resumed `query()` reports only its own cost - the execution model doc is explicit that the run record itself must sum them).
2. **Plan-then-approve mode (`permissionMode: 'plan'`) is not implemented.** `docs/blueprint/02-agent-sdk-guide.md` section 8.3 and `docs/blueprint/06-execution-model.md`'s lifecycle overview both call for a `planning` / `awaiting-plan-approval` sub-phase for templates with `plan_then_approve: true`: start the session in `permissionMode: 'plan'`, intercept the `ExitPlanMode` tool call in the `canUseTool` broker (Task 4's `createPermissionBroker` would need a new branch for this tool name), render the proposed plan for approval, and call `run.setPermissionMode('default')` on approval or feed back rejection feedback on decline. None of Tasks 1-15 touch `permissionMode` or `ExitPlanMode`. Templates themselves (`TaskType` beyond `"generic"`, `.forge/templates/`) are also not yet modeled in the Phase 1 canonical types beyond the `TicketType` union already present - a template system with a real `plan_then_approve` flag per type is itself a prerequisite this gap depends on.
3. **Task 11's gate loop does not distinguish `basis: "command"` gates from `basis: "heuristic"` gates.** `docs/blueprint/06-execution-model.md` ("Gate execution") is explicit that `accessibility`, `security`, and `maintainability` are a separate, LLM-narrated heuristic pass over the diff, never routed through `runGate`'s `execFile` path the way `typecheck`/`lint`/`test` are. Task 11's `startAgentRun` loop as written calls `runGate` for every entry in `ticket.gates` uniformly, which is wrong for the three heuristic gate names (there is no matching script in `ForgeConfigScripts` for them, so they would incorrectly fall through the "missing script" warning path in Task 10's `runGate` instead of running an actual heuristic pass). This has zero practical effect through Task 15 because Phase 1's `ticket.gates` is always empty (template snapshots arrive in a later phase - see the Phase 1 plan's own scope-boundary note), but the addendum that adds templates and populates `gates` must also split this loop: command-basis names go through `runGate`, heuristic-basis names go through a separate LLM-narrated pass this plan does not design.
4. **Split transcript storage's "sanitized summary committed under the ticket" half is only half-built.** Task 14 persists the full local run-state transcript under `.forge/local/runs/` (gitignored, matches the spec's "full transcript stays local"), but nothing yet writes a `RunSummary`-shaped sanitized summary into the ticket's own (committed) folder, which the spec's split-transcript policy and later phases (the run inspector, QA handover packs) depend on. `RunSummary` is not yet in `src/lib/forge/types.ts`'s Phase 1 subset either - it needs to be added there first, matching whatever shape `docs/blueprint/05-data-model.md` defines for it (check that doc; if it does not yet define one, that is itself a blueprint gap to flag back, not something to invent ad hoc here).

None of these four block starting Tasks 1-15 - they are independent additions layered on top once the base real-execution machinery (worktrees, sessions, permissions, gates-once, interrupt/steer/resume) is working and manually verified. But they must land before Phase 2 is actually exit-clean against the roadmap, and the Phase 2 exit checklist below is written against Tasks 1-15's scope only - re-check it against the roadmap's own Phase 2 exit criteria once the addendum lands.

### Additional gaps found in the final whole-branch review (2026-07-16)

The final whole-branch review over the full branch (`ccaf03d..6c698cd`) surfaced these smaller gaps, none of which block finishing the branch. They are documented here (not fixed) per the review's own triage - the four load-bearing findings from that review WERE fixed in the post-review fix round (commit `a83b7ea`: the two `PlanTracker` data-corruption bugs, the missing route/worktree-create audit events, the `interrupted` run-state transition, and the missing `executing` phase-change). What remains, deferred:

5. **`"always"` permission decisions do not persist to `config.bashAllowlist`.** The permission-decision UI offers an "always allow" choice and the broker resolves it, but the decision is not written back to `.forge/config.json`, so the same command prompts again on the next run despite the UI implying durability. A future task should persist an `"always"` decision into the project's Bash allowlist.
6. **Non-Bash tool permission decisions are never audited.** `startAgentRun`'s `canUseTool` wrapper only appends `bash-command-{approved,allowlisted,denied}` audit events; Read/Grep/Glob/Write/etc. permission decisions are not audited because the canonical `AuditEvent` union has no generic tool-decision kind. Closing this needs either a new canonical kind (added to `src/lib/forge/types.ts` and `docs/blueprint/05-data-model.md` together, not invented ad hoc) or a deliberate decision that non-Bash tools are out of audit scope.
7. **A gate producing >1MB of output is mislabeled as a timeout.** `src/lib/gates.ts`'s `execFile` sets no `maxBuffer` override, so a gate script whose combined stdout/stderr exceeds Node's default 1MB cap fails with `error.killed` set - the same flag a real timeout sets - and `runGate` reports it as a timeout rather than a buffer overflow. Add an explicit `maxBuffer` and distinguish the overflow error from a genuine timeout.
8. **Resume is detection-only.** Task 14's launch-time janitor (`src/lib/run/janitor.ts`) finds orphaned/dead runs from the persisted run state, but nothing actually re-attaches to or continues an interrupted run - the roadmap's manual exit-checklist item says "interrupt and resume a run", and only the interrupt half is real. A resume task must reconstruct the `Run` from the local transcript and continue the session.
9. **`src/lib/gates.ts` duplicates the `"npm" | "pnpm" | "yarn"` union inline** instead of importing the existing `PackageManager` type from `src/lib/forge/types.ts`. Trivial; fold into whichever task next touches `gates.ts`.
10. **Worktree removal is not audited.** The audit fix round (commit `a83b7ea`) added a `run-started` audit event at worktree creation, but worktree *removal* has no canonical `AuditEvent` kind, so it is not audited (removal on approve/reject is implied by the `run-approved`/`run-rejected` events; removal in the failure `catch` has no kind). Fabricating a `worktree-removed` kind was deliberately avoided, matching this plan's established precedent (Tasks 9, 11) of not inventing audit kinds. Same resolution path as gap 6: add a canonical kind deliberately or decide it is out of scope.
11. **An interrupted run's ticket still shows `"failed"` at the ticket level.** The fix round (commit `a83b7ea`) made the run-level `RunState` correctly transition to `"interrupted"`, but there is no `"interrupted"` `TicketStatus` (the enum is backlog/running/review/done/rejected/failed), so `setTicketStatus` on the interrupt path still lands on `"failed"`. Closing this needs an `"interrupted"` `TicketStatus` added to the canonical model, threaded through the ticket board UI.

---

## Phase 2 exit checklist

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm e2e` all pass from a clean checkout, with no `ANTHROPIC_API_KEY` set at all (proving the simulator seam and Playwright e2e never touch the real engine or spend money).
- [ ] **Manual, developer-present only:** a real ticket run against a real scratch project, with `ANTHROPIC_API_KEY` set: create a bug-fix ticket, watch the real agent work in the live panel, approve a non-allowlisted Bash command from the UI, see real gate results, interrupt and resume a run, and end with a local commit on a `forge/<slug>` branch - all without opening an editor.
- [ ] **Manual, developer-present only:** two tickets run concurrently in separate worktrees without touching each other or the developer's own working tree.
- [~] Every new mutation emits an audit event via `appendAuditEvent`. Done (commit `a83b7ea`): worktree create (`run-started`), approve (`run-approved`), reject (`run-rejected`), interrupt (`run-interrupted`), steer (`run-steered`), and Bash permission decisions (`bash-command-{approved,allowlisted,denied}`). Remaining gaps (see Known gaps 6 and 10): worktree *removal* and non-Bash tool permission decisions are not audited (no canonical `AuditEvent` kind exists for either).
- [ ] No test in the automated suite (`pnpm test`, `pnpm e2e`) spends API credits or requires `ANTHROPIC_API_KEY` to pass.
