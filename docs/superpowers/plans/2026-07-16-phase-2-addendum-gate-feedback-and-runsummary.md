# Phase 2 Addendum Implementation Plan - Gate-Feedback Loop + RunSummary (Agent Workbench)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **STOP before the Manual Verification section without explicit confirmation.** Every automated test in Tasks 1-9 runs fully offline against the mocked-`query()` harness in `manager.test.ts`, the simulator, and real-fs/real-git unit tests in scratch dirs - no `ANTHROPIC_API_KEY`, no network, no spend. The ONLY step that touches a real Agent SDK `query()` against a funded key is the single, developer-present Manual Verification item at the end of this plan. Gate it behind an explicit developer go-ahead exactly like Phase 2 Tasks 5/11; never run it in CI or unattended.

**Goal:** Close the two deferred Phase 2 gaps - the gate-feedback iteration loop (Gap 1) and the sanitized `RunSummary` committed-transcript half (Gap 4) - without changing any of the Phase 2 seams already merged to `main`.

**Architecture:** Both gaps live entirely inside the already-merged real-engine path (`src/lib/run/manager.ts`'s `startAgentRun`) plus one new pure module (`src/lib/run/summary.ts`), one new git helper (`changedFiles` in `src/lib/git/worktree.ts`), one new API route (`/api/runs/[runId]/iteration`), and one new UI control component. The canonical `RunEvent`/`Gate`/`RunState` protocol from `src/lib/forge/types.ts` and the reducer/SSE/UI pipeline are reused unchanged except for the additive `pendingIteration` field on `RunView`. Gap 4 is built first because it is independent, needs no SDK, and is the lower-risk half; Gap 1 (the loop) is built on top afterward.

**Tech Stack:** Existing Phase 2 stack only - Next.js 16 App Router, TypeScript strict, `@anthropic-ai/claude-agent-sdk@0.3.209` (pinned exact), vitest (node environment), pnpm. No new dependencies.

## Scope

This addendum closes EXACTLY two gaps:

- **Gap 1 - gate-feedback iteration loop.** Today gates run once with no retry (`manager.ts` lines ~366-370). This adds the up-to-3-iteration fix loop with the before-iteration-2 human cost checkpoint.
- **Gap 4 - RunSummary sanitized committed transcript half.** Today no `RunSummary` type exists and nothing writes the committed, sanitized `<run-id>.summary.json`. This adds the type, a `changedFiles` git helper, a `summary.ts` builder/writer, and wires it into the run manager's terminal paths.

Explicitly OUT OF SCOPE and deferred to a separate later plan (do not touch, do not plan): plan-then-approve mode (the `planning`/`awaiting-plan-approval` sub-phase), the command-vs-heuristic gate-basis split (the LLM-narrated `basis: "heuristic"` gates), any template system, and the full `awaiting-approval -> completed` approval-lifecycle restructure (see the LOCKED DEVIATION below).

**LOCKED DEVIATION (documented here and in code):** The blueprint's target lifecycle routes the gate loop's exit through a run-pausing `awaiting-approval` terminal (`06-execution-model.md` state table: `gates-running -> awaiting-approval`). That approval-lifecycle restructure is deferred to Phase 3. In this addendum the gate loop instead exits to the EXISTING Phase 2 tail: `phase-change -> "completed"`, `commitAll`, `setTicketStatus(..., "review", { branchName })`. We do NOT introduce `awaiting-approval` as a run-pausing terminal. This keeps the loop change surgical and preserves the merged tail behavior. The single new pause state this plan DOES add is `awaiting-iteration-approval` (already present in `RUN_STATES`), used only transiently at the before-iteration-2 checkpoint. This deviation is restated in a code comment at the loop-exit tail.

## Global Constraints

Every task's requirements implicitly include this section.

- **No real Agent SDK / API spend in any automated test.** Everything is tested against the mocked-`query()` harness in `src/lib/run/manager.test.ts`, the simulator, and real-fs/real-git unit tests in scratch dirs. The ONLY step needing a funded `ANTHROPIC_API_KEY` is the single, developer-present, end-of-plan Manual Verification of a real resume-with-feedback iteration - gated behind explicit developer go-ahead exactly like Phase 2 Tasks 5/11; never run it in CI or unattended.
- **TypeScript strict:** explicit return types on exported functions, no `any` (use `unknown` + type guards), `import type` for type-only imports, `node:` protocol on node builtins, no `enum` (use `as const` + `(typeof X)[number]`).
- **Commits:** name files explicitly (never `git add -A` / `git add .`), no `Co-Authored-By` line, conventional-commit prefixes, use `printf` for multi-line messages (`cat` is aliased to `bat` in this shell).
- **Surgical edits; match existing style.** Do not "improve" adjacent code. Do NOT touch `docs/progress-log.md`.
- **Canonical domain model:** `docs/blueprint/05-data-model.md` is the single source of truth for every type. Copy the Gap 4 types VERBATIM from it.
- **Never import the Agent SDK into a Client Component.** Only server modules touch `@anthropic-ai/claude-agent-sdk`.
- All paths below are relative to the app repo root: `/Users/mikulgohil/Developer/work/horizontal/active/agent-workbench`.
- Test commands: `pnpm test` (vitest), `pnpm typecheck`, `pnpm lint`, `pnpm e2e` (Playwright).

**Testing note (repo reality):** vitest runs with `environment: "node"` and `include: ["src/**/*.test.ts"]` (see `vitest.config.ts`). There is NO jsdom, NO `@testing-library`, and `.test.tsx` files are not even collected. Consequently this repo has ZERO React component render tests - `approval-actions.tsx` and `plan-progress-panel.tsx` are untested by design. Do NOT add jsdom/testing-library in this addendum (out of scope). UI logic that CAN be tested in node (the reducer) is unit-tested; the UI component itself is verified by the Manual Verification checklist, mirroring how the existing permission-prompt UI is covered.

---

## Task 1: RunSummary + dependent canonical types in `types.ts`

**Files:**
- Modify: `src/lib/forge/types.ts` (add a new "Run summary" section after the `RunEvent` union, ~after line 305; update the header comment ~lines 5-8)
- Test: `src/lib/forge/types.test.ts` (append cases)

**Interfaces:**
- Consumes: existing `Gate`, `CostRecord`, `ApprovalDecision`, `RunState`, `BashCommandSource` from the same file.
- Produces (copied VERBATIM from `docs/blueprint/05-data-model.md` lines 471-508):

```ts
export const FILE_CHANGE_KINDS = ["added", "modified", "deleted"] as const;
export type FileChangeKind = (typeof FILE_CHANGE_KINDS)[number];
export interface FileTouch { path: string; kind: FileChangeKind; }
export interface CommandRecord { command: string; source: BashCommandSource; exitCode: number; durationMs: number; }
export interface RunSummary {
  id: string; ticketId: string; state: RunState;
  filesTouched: FileTouch[]; commandsRun: CommandRecord[]; gates: Gate[];
  iteration: number; cost: CostRecord; approval: ApprovalDecision | null;
  startedAt: string; endedAt: string; durationMs: number; appVersion: string;
}
```

- [ ] **Step 1: Write the failing test** - append to `src/lib/forge/types.test.ts`:

```ts
import { FILE_CHANGE_KINDS, type FileTouch, type CommandRecord, type RunSummary } from "./types";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/forge/types.test.ts`
Expected: FAIL - `FILE_CHANGE_KINDS`, `FileTouch`, `CommandRecord`, `RunSummary` are not exported (module has no such exports / type errors).

- [ ] **Step 3: Implement** - in `src/lib/forge/types.ts`, first update the header comment block (lines ~5-8) to remove `RunSummary` from the "types later phases must add" list. Change:

```ts
 * Every name and field here matches that document exactly; later phases
 * extend this file with the remaining canonical types (RunSummary,
 * Lesson, TaskTemplate, ...) instead of renaming anything. AuditEvent
 * was added in Phase 2 Task 9.
```

to:

```ts
 * Every name and field here matches that document exactly; later phases
 * extend this file with the remaining canonical types (Lesson,
 * TaskTemplate, ...) instead of renaming anything. AuditEvent was added
 * in Phase 2 Task 9; RunSummary and its dependent types (FileTouch,
 * CommandRecord, FileChangeKind) were added in the Phase 2 addendum.
```

Then insert a new section immediately AFTER the `isTerminalEvent` function (after line ~310), BEFORE the `/* Audit log */` section:

```ts
/* ------------------------------------------------------------------ */
/* Run summary - sanitized, committed record of a completed run        */
/* .forge/tickets/<ticket-id>/runs/<run-id>.summary.json               */
/* ------------------------------------------------------------------ */

export const FILE_CHANGE_KINDS = ["added", "modified", "deleted"] as const;
export type FileChangeKind = (typeof FILE_CHANGE_KINDS)[number];

export interface FileTouch {
  path: string;
  kind: FileChangeKind;
}

export interface CommandRecord {
  command: string;
  source: BashCommandSource;
  exitCode: number;
  durationMs: number;
}

/**
 * The sanitized run summary committed to git.
 * Invariant: NEVER contains file contents, diffs, or snippets - only
 * paths, commands, gate results, durations, and cost. This is what makes
 * split transcript storage safe to commit (locked decision 11).
 * Invariant: written exactly once, when `state` reaches a terminal value.
 */
export interface RunSummary {
  id: string;
  ticketId: string;
  /** One of the four terminal RunState values. */
  state: RunState;
  filesTouched: FileTouch[];
  commandsRun: CommandRecord[];
  gates: Gate[];
  iteration: number;
  cost: CostRecord;
  approval: ApprovalDecision | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  appVersion: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/forge/types.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/forge/types.ts src/lib/forge/types.test.ts
git commit -m "$(printf '%s\n\n%s' \
  "feat: add RunSummary and dependent canonical types" \
  "- FileTouch, CommandRecord, FileChangeKind, RunSummary copied verbatim from 05-data-model.md
- removes RunSummary from the deferred-types header comment")"
```

---

## Task 2: `changedFiles` git helper in `worktree.ts`

**Files:**
- Modify: `src/lib/git/worktree.ts` (add `changedFiles` after `hasCommitsSinceBase`, ~line 76)
- Test: `src/lib/git/worktree.test.ts` (append a case; the file already has an `initGitRepo` helper and a `createdWorktrees` cleanup array)

**Interfaces:**
- Consumes: existing `execFileAsync` (a `promisify(execFile)` already at the top of `worktree.ts`), `createWorktree`, `commitAll` (in tests); `FileTouch` from `@/lib/forge/types`.
- Produces:

```ts
export function changedFiles(worktreePath: string, baseBranch: string): Promise<FileTouch[]>;
```

Semantics: runs `git diff --name-status <baseBranch>` (no shell) inside the worktree, mapping each porcelain status letter to a `FileChangeKind`: `A` -> `added`, `M` -> `modified`, `D` -> `deleted`, `R`/`C` -> `modified` (renames/copies use the NEW path, which is the last tab-separated field), any other status -> `modified`. This compares the worktree's tree (committed + uncommitted) against the base-branch tip, which is what the run manager wants after `commitAll` (post-commit diff vs base) and remains meaningful best-effort in the failure path.

- [ ] **Step 1: Write the failing test** - append to `src/lib/git/worktree.test.ts` inside the existing `describe("worktree module", ...)` block. Add `changedFiles` to the existing import from `"./worktree"`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/git/worktree.test.ts`
Expected: FAIL - `changedFiles` is not exported.

- [ ] **Step 3: Implement** - add the import and function to `src/lib/git/worktree.ts`. At the top, add a type-only import:

```ts
import type { FileChangeKind, FileTouch } from "@/lib/forge/types";
```

Then append after `hasCommitsSinceBase`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/git/worktree.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/git/worktree.ts src/lib/git/worktree.test.ts
git commit -m "$(printf '%s\n\n%s' \
  "feat: add changedFiles git helper for RunSummary.filesTouched" \
  "- git diff --name-status vs base branch, no shell (execFile)
- maps A/M/D/R/C status letters to FileChangeKind (renames -> modified of new path)")"
```

---

## Task 3: `summary.ts` - build + write the sanitized RunSummary

**Files:**
- Create: `src/lib/run/summary.ts`
- Test: `src/lib/run/summary.test.ts`

**Interfaces:**
- Consumes: `RunSummary`, `FileTouch`, `CommandRecord`, `Gate`, `CostRecord`, `ApprovalDecision`, `RunState` from `@/lib/forge/types`; `forgeDir` from `@/lib/forge/store`; `APP_VERSION` from `@/lib/version`; `node:fs/promises` (`mkdir`, `writeFile`); `node:path` (`join`).
- Produces:

```ts
export interface BuildRunSummaryInput {
  id: string;
  ticketId: string;
  state: RunState;
  filesTouched: FileTouch[];
  commandsRun: CommandRecord[];
  gates: Gate[];
  iteration: number;
  cost: CostRecord;
  approval: ApprovalDecision | null;
  startedAt: string;
  endedAt: string;
}
export function buildRunSummary(input: BuildRunSummaryInput): RunSummary; // pure; durationMs and appVersion derived here
export function writeRunSummary(projectDir: string, ticketId: string, summary: RunSummary): Promise<void>;
```

`buildRunSummary` is pure: it copies every input field through and derives `durationMs = Date.parse(endedAt) - Date.parse(startedAt)` and `appVersion = APP_VERSION`. `writeRunSummary` writes pretty JSON + trailing newline to `join(forgeDir(projectDir), "tickets", ticketId, "runs", `${summary.id}.summary.json`)`, `mkdir`-ing the `runs/` directory first (matching `store.ts`'s raw-`writeFile` style; there is no shared writeJson helper).

- [ ] **Step 1: Write the failing test** - `src/lib/run/summary.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/run/summary.test.ts`
Expected: FAIL - `./summary` does not exist.

- [ ] **Step 3: Implement** - `src/lib/run/summary.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { forgeDir } from "@/lib/forge/store";
import { APP_VERSION } from "@/lib/version";
import type {
  ApprovalDecision,
  CommandRecord,
  CostRecord,
  FileTouch,
  Gate,
  RunState,
  RunSummary,
} from "@/lib/forge/types";

/**
 * Pure input for building a sanitized RunSummary. `commandsRun` is passed
 * in (see below); the caller sources `filesTouched` from the git
 * `changedFiles` helper and `gates` from the run's last gate pass.
 */
export interface BuildRunSummaryInput {
  id: string;
  ticketId: string;
  state: RunState;
  filesTouched: FileTouch[];
  commandsRun: CommandRecord[];
  gates: Gate[];
  iteration: number;
  cost: CostRecord;
  approval: ApprovalDecision | null;
  startedAt: string;
  endedAt: string;
}

/**
 * Assembles the sanitized, committed RunSummary
 * (docs/blueprint/05-data-model.md). Pure - derives only `durationMs`
 * (endedAt - startedAt) and stamps `appVersion`; every other field is
 * copied straight from the input.
 *
 * KNOWN GAP: `commandsRun` is always passed in as `[]` today. The
 * permission-only Bash path does not capture per-command exit codes or
 * durations, so there is nothing truthful to populate here yet; a future
 * task that parses Bash tool-results will fill it. We never fabricate
 * exit codes.
 */
export function buildRunSummary(input: BuildRunSummaryInput): RunSummary {
  return {
    id: input.id,
    ticketId: input.ticketId,
    state: input.state,
    filesTouched: input.filesTouched,
    commandsRun: input.commandsRun,
    gates: input.gates,
    iteration: input.iteration,
    cost: input.cost,
    approval: input.approval,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs: Date.parse(input.endedAt) - Date.parse(input.startedAt),
    appVersion: APP_VERSION,
  };
}

/**
 * Writes the summary to
 * `.forge/tickets/<ticketId>/runs/<run-id>.summary.json` as pretty JSON
 * with a trailing newline (matching store.ts's writeTicket style). This
 * file IS committed to git, unlike the gitignored full transcript under
 * `.forge/local/runs/`.
 */
export async function writeRunSummary(projectDir: string, ticketId: string, summary: RunSummary): Promise<void> {
  const runsDir = join(forgeDir(projectDir), "tickets", ticketId, "runs");
  await mkdir(runsDir, { recursive: true });
  await writeFile(join(runsDir, `${summary.id}.summary.json`), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/run/summary.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/run/summary.ts src/lib/run/summary.test.ts
git commit -m "$(printf '%s\n\n%s' \
  "feat: add buildRunSummary + writeRunSummary" \
  "- pure builder derives durationMs and stamps appVersion
- writer emits committed .forge/tickets/<id>/runs/<run>.summary.json
- commandsRun kept [] for now (documented gap; no fabricated exit codes)")"
```

---

## Task 4: Wire RunSummary writing into `manager.ts` terminal paths

**Files:**
- Modify: `src/lib/run/manager.ts` (imports ~lines 1-19; the `startAgentRun` `record.done` async body: hoist a `lastGates` var ~line 196, collect gates in the gate loop ~lines 366-370, write the summary in the success tail ~after line 373, write best-effort in the `catch` block ~before line 404)
- Test: `src/lib/run/manager.test.ts` (extend the `@/lib/git/worktree` mock ~lines 23-27; add an assertion in the "channel lifecycle" describe block)

**Interfaces:**
- Consumes: `buildRunSummary`, `writeRunSummary` from `./summary`; `changedFiles` from `@/lib/git/worktree`; `APP_VERSION` is used inside `buildRunSummary` (not imported here); `FileTouch`, `Gate` types from `@/lib/forge/types`; existing `record.run` (`id`, `ticketId`, `state`, `iteration`, `approval`, `startedAt`, `endedAt`), `record.view.cost`, `config.baseBranch`.
- Produces: no new exports. Side effect only: exactly one `<run-id>.summary.json` per terminal run, in BOTH the success tail (`completed`) and the `catch` (`failed`/`interrupted`), best-effort in the catch so a write failure never masks the original error. `rejected` is NOT produced by this writer - reject is a post-run ticket op handled elsewhere; note that in a code comment.

- [ ] **Step 1: Write the failing test** - extend the worktree mock at the top of `src/lib/run/manager.test.ts` (lines 23-27) to add a `changedFiles` stub:

```ts
vi.mock("@/lib/git/worktree", () => ({
  createWorktree: vi.fn().mockResolvedValue({ path: "/tmp/mock-worktree", branch: "forge/mock-branch" }),
  removeWorktree: vi.fn().mockResolvedValue(undefined),
  commitAll: vi.fn().mockResolvedValue(undefined),
  changedFiles: vi.fn().mockResolvedValue([{ path: "src/x.ts", kind: "modified" }]),
}));
```

Then add this test inside the existing `describe("startAgentRun channel lifecycle (mocked SDK, no real API calls)", ...)` block (add `readFile`/`join`/`forgeDir` imports at the top of the file if not present: `import { readFile } from "node:fs/promises";`, `import { join } from "node:path";`, and `forgeDir` from `@/lib/forge/store`):

```ts
  it(
    "writes a sanitized RunSummary to runs/<id>.summary.json when the run completes",
    async () => {
      const config: ForgeConfig = DEFAULT_FORGE_CONFIG;
      const handle = startAgentRun(dir, ticket, config);
      await handle.done;

      const path = join(forgeDir(dir), "tickets", ticket.id, "runs", `${handle.run.id}.summary.json`);
      const raw = await readFile(path, "utf8");
      const summary = JSON.parse(raw) as import("@/lib/forge/types").RunSummary;
      expect(summary.id).toBe(handle.run.id);
      expect(summary.ticketId).toBe(ticket.id);
      expect(summary.state).toBe("completed");
      expect(summary.filesTouched).toEqual([{ path: "src/x.ts", kind: "modified" }]);
      expect(summary.commandsRun).toEqual([]);
      expect(summary.gates).toEqual([]); // ticket.gates is [] by default in these tests
      expect(raw).not.toContain("\"diff\"");
    },
    3000,
  );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/run/manager.test.ts`
Expected: FAIL - the summary file does not exist (ENOENT on `readFile`).

- [ ] **Step 3: Implement** - in `src/lib/run/manager.ts`:

First, update imports. Change line 9:

```ts
import { createWorktree, removeWorktree, commitAll } from "@/lib/git/worktree";
```

to:

```ts
import { createWorktree, removeWorktree, commitAll, changedFiles } from "@/lib/git/worktree";
```

Add after line 19 (`import { appendRunState } from "./persist";`):

```ts
import { buildRunSummary, writeRunSummary } from "./summary";
import type { FileTouch, Gate } from "@/lib/forge/types";
```

(Note: `FileTouch`/`Gate` join the existing `import type { ForgeConfig, Run, RunEvent, Ticket } from "@/lib/forge/types";` line - either extend that line or add a second `import type` line; extending the existing line is preferred to match style.)

Inside `startAgentRun`'s `record.done` async body, hoist a mutable gates accumulator next to `let branch` (line 196):

```ts
    let branch: string | null = null;
    let lastGates: Gate[] = [];
```

Replace the gate loop (lines 366-370) so it collects the results:

```ts
      for (const gateName of ticket.gates) {
        const scriptName = config.scripts[gateName as keyof typeof config.scripts] ?? gateName;
        const gate = await runGate(worktreePath, gateName, scriptName, config.packageManager);
        applyEvent(record, { kind: "gate-result", seq: nextSeq(), at: nowIso(), gate });
        lastGates.push(gate);
      }
```

In the success tail, AFTER `record.run = { ...record.run, endedAt: nowIso() };` (line 374) and its `appendRunState` (lines 375-381), and BEFORE `setTicketStatus(..., "review", ...)` (line 382), insert the summary write. The worktree still exists here (it is only removed on catch/approval):

```ts
      // Write the sanitized, committed run summary exactly once, while the
      // worktree still exists (changedFiles diffs it against the base
      // branch). commandsRun is [] for now (see summary.ts KNOWN GAP).
      const filesTouched = await changedFiles(worktreePath, config.baseBranch).catch((): FileTouch[] => []);
      await writeRunSummary(
        projectDir,
        ticket.id,
        buildRunSummary({
          id: record.run.id,
          ticketId: record.run.ticketId,
          state: record.run.state,
          filesTouched,
          commandsRun: [],
          gates: lastGates,
          iteration: record.run.iteration,
          cost: record.view.cost,
          approval: record.run.approval,
          startedAt: record.run.startedAt,
          endedAt: record.run.endedAt ?? nowIso(),
        }),
      );
```

In the `catch` block, AFTER `record.run = { ...record.run, endedAt: nowIso() };` (line 392) and its best-effort `appendRunState` (lines 393-402), and BEFORE `removeWorktree` (line 403) - because `changedFiles` needs the worktree to still exist - insert a best-effort summary write:

```ts
      // Best-effort terminal summary for failed/interrupted runs. Wrapped
      // so a write failure here never masks the original error. Note:
      // `rejected` is never produced by this writer - rejection is a
      // post-run ticket op handled outside startAgentRun.
      if (record.run.worktreePath) {
        try {
          const wt = record.run.worktreePath;
          const filesTouched = await changedFiles(wt, config.baseBranch).catch((): FileTouch[] => []);
          await writeRunSummary(
            projectDir,
            ticket.id,
            buildRunSummary({
              id: record.run.id,
              ticketId: record.run.ticketId,
              state: record.run.state,
              filesTouched,
              commandsRun: [],
              gates: lastGates,
              iteration: record.run.iteration,
              cost: record.view.cost,
              approval: record.run.approval,
              startedAt: record.run.startedAt,
              endedAt: record.run.endedAt ?? nowIso(),
            }),
          );
        } catch {
          // Best-effort: never let a summary-write failure mask the run's
          // original failure/interrupt handling below.
        }
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/run/manager.test.ts && pnpm typecheck`
Expected: PASS - all existing manager tests still green (they use `gates: []`, so `lastGates` stays `[]`), plus the new summary assertion.

- [ ] **Step 5: Commit**

```bash
git add src/lib/run/manager.ts src/lib/run/manager.test.ts
git commit -m "$(printf '%s\n\n%s' \
  "feat: write sanitized RunSummary on terminal run states" \
  "- success tail writes summary after commitAll while worktree exists
- catch writes best-effort before worktree removal (never masks the error)
- filesTouched via changedFiles best-effort; commandsRun [] for now")"
```

---

## Task 5: `CostTracker` cross-session accumulation via `sealSession()`

**Files:**
- Modify: `src/lib/session/cost-tracker.ts`
- Test: `src/lib/session/cost-tracker.test.ts` (append cases)

**Interfaces:**
- Consumes: existing `CostRecord`, `SDKMessage`.
- Produces:

```ts
sealSession(): void; // commits the current session's cost into a running total and resets the per-session state
total(): CostRecord; // now returns committed + current (unchanged for a single session)
ingest(message: SDKMessage): CostRecord | null; // now returns the committed + current total (unchanged for a single session)
```

Rationale: each resumed `query()` session produces its OWN `result` with its own `total_cost_usd` (`docs/blueprint/02-agent-sdk-guide.md` 4.2: "Each resumed call produces its own result with its own total_cost_usd; accumulate per ticket"). Today `ingest` OVERWRITES `cumulative` on the result frame, so a second session would erase the first session's cost. `sealSession()` moves the finished session's cost into a committed accumulator and resets per-session state (including the message-id dedup set, since ids are per session). Single-session behavior is byte-identical because `committed` starts at zero.

- [ ] **Step 1: Write the failing test** - append to `src/lib/session/cost-tracker.test.ts`:

```ts
function resultFrame(costUsd: number, inputTokens: number, outputTokens: number) {
  return {
    type: "result",
    subtype: "success",
    result: "done",
    is_error: false,
    num_turns: 1,
    duration_ms: 1,
    duration_api_ms: 1,
    total_cost_usd: costUsd,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    stop_reason: null,
    uuid: "r",
    session_id: "s",
  } as never;
}

describe("CostTracker cross-session accumulation", () => {
  it("accumulates cost across sealed sessions instead of overwriting", () => {
    const tracker = new CostTracker();
    tracker.ingest(resultFrame(0.01, 100, 50));
    tracker.sealSession();
    const afterSecond = tracker.ingest(resultFrame(0.02, 200, 80));
    expect(afterSecond?.costUsd).toBeCloseTo(0.03, 10);
    expect(tracker.total().costUsd).toBeCloseTo(0.03, 10);
    expect(tracker.total().inputTokens).toBe(300);
    expect(tracker.total().outputTokens).toBe(130);
  });

  it("keeps single-session behavior identical (sealing an unsealed tracker with no committed cost is a no-op on totals)", () => {
    const tracker = new CostTracker();
    tracker.ingest(resultFrame(0.0123, 100, 50));
    expect(tracker.total().costUsd).toBe(0.0123);
  });

  it("resets per-session message-id dedup on seal so a new session's first message counts", () => {
    const tracker = new CostTracker();
    tracker.ingest(assistantFrame("m1", 100, 50));
    tracker.sealSession();
    const next = tracker.ingest(assistantFrame("m1", 10, 5));
    expect(next?.inputTokens).toBe(110); // 100 committed + 10 current, not deduped away
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/session/cost-tracker.test.ts`
Expected: FAIL - `sealSession` is not a function; accumulation assertions fail (current code overwrites).

- [ ] **Step 3: Implement** - rewrite `src/lib/session/cost-tracker.ts`:

```ts
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CostRecord } from "@/lib/forge/types";

const ZERO: CostRecord = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };

function addCost(a: CostRecord, b: CostRecord): CostRecord {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

/**
 * Per-step usage (docs/blueprint/02-agent-sdk-guide.md section 1.5):
 * dedupe by message.message.id since parallel tool calls share one id
 * with identical usage. The result frame's total_cost_usd/usage is
 * authoritative and overrides the running per-step estimate once it
 * arrives - prefer it over summing steps ourselves.
 *
 * Cross-session (gate-feedback loop, resume): each resumed query() session
 * produces its own result with its own total_cost_usd (guide 4.2), so per
 * ticket we accumulate. `current` holds the in-flight session; `committed`
 * holds the sum of every already-sealed session. `total()` and `ingest()`
 * both return committed + current, so a single-session run is unchanged
 * (committed is zero).
 */
export class CostTracker {
  private committed: CostRecord = { ...ZERO };
  private current: CostRecord = { ...ZERO };
  private seenMessageIds = new Set<string>();

  ingest(message: SDKMessage): CostRecord | null {
    if (message.type === "assistant") {
      const id = message.message.id;
      if (this.seenMessageIds.has(id)) return null;
      this.seenMessageIds.add(id);
      const usage = message.message.usage;
      this.current = {
        inputTokens: this.current.inputTokens + usage.input_tokens,
        outputTokens: this.current.outputTokens + usage.output_tokens,
        cacheReadTokens: this.current.cacheReadTokens + (usage.cache_read_input_tokens ?? 0),
        cacheWriteTokens: this.current.cacheWriteTokens + (usage.cache_creation_input_tokens ?? 0),
        costUsd: this.current.costUsd,
      };
      return this.total();
    }

    if (message.type === "result") {
      this.current = {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
        costUsd: message.total_cost_usd,
      };
      return this.total();
    }

    return null;
  }

  /**
   * Folds the finished session's cost into the committed total and resets
   * per-session state so the next resumed session accumulates rather than
   * overwrites. Message-id dedup is per session, so its set is cleared too.
   */
  sealSession(): void {
    this.committed = addCost(this.committed, this.current);
    this.current = { ...ZERO };
    this.seenMessageIds = new Set<string>();
  }

  total(): CostRecord {
    return addCost(this.committed, this.current);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/session/cost-tracker.test.ts && pnpm typecheck`
Expected: PASS - the three existing tests plus the three new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session/cost-tracker.ts src/lib/session/cost-tracker.test.ts
git commit -m "$(printf '%s\n\n%s' \
  "feat: add CostTracker.sealSession for cross-session accumulation" \
  "- committed + current split; total()/ingest() return the sum
- single-session behavior unchanged; seal resets per-session dedup
- lets the gate-feedback loop accumulate per-ticket cost across resumes")"
```

---

## Task 6: Behavior-preserving refactor of `manager.ts` - `runGatesOnce`, shared query builder, shared session consumer

**Files:**
- Modify: `src/lib/run/manager.ts` (inside `startAgentRun`'s `record.done` body: extract three local helpers and rewire the initial session + gate pass to use them)
- Test: `src/lib/run/manager.test.ts` (no new tests; all existing tests must stay green - this task is pure refactor)

**Interfaces:**
- Consumes: everything already in scope inside `startAgentRun` (`broker`, `bashGate`, `config`, `projectDir`, `ticket`, `runId`, `record`, `applyEvent`, `nextSeq`, `abortController`, `planTracker`, `costTracker`, `describeToolRequest`, `resolveBashCommand`, `appendAuditEvent`, `mapSdkMessages`).
- Produces (three local closures inside `startAgentRun`, not exported):

```ts
function buildQueryOptions(resume: string | null): QueryOptions; // the options object incl. the shared canUseTool closure
async function consumeSession(run: AsyncIterable<SDKMessage>, channel: UserMessageChannel): Promise<void>; // drains one session's stream, applies events, closes channel + returns on the result frame
async function runGatesOnce(worktreePath: string): Promise<Gate[]>; // runs every ticket gate once, emits gate-result events, returns the results
```

This task introduces NO loop and NO new events. It only factors the existing initial-session message loop, the existing `canUseTool`/options object, and the existing single gate pass into reusable local helpers, then calls them exactly where the inline code was. The observable event sequence for a plain run is unchanged.

Note on types: `query()`'s real options type is strict. To avoid fighting it, type `buildQueryOptions`'s return as the exact object literal shape the current inline call uses (do NOT introduce a hand-written `QueryOptions` interface). The cleanest approach that keeps strict-mode happy is to have `buildQueryOptions` return a `Parameters<typeof query>[0]["options"]` value; if that proves awkward under the pinned SDK types, inline-construct the options at each call site through a shared `canUseTool` closure + a small `sharedOptionsBase` object spread with `{ resume }`. Prefer the smallest change that typechecks; the load-bearing requirement is that the initial call and the (Task 7) resume calls share ONE `canUseTool` definition (DRY).

- [ ] **Step 1: Establish the green baseline**

Run: `pnpm test -- src/lib/run/manager.test.ts`
Expected: PASS (this is the behavior we must preserve).

- [ ] **Step 2: Implement the refactor** - inside `startAgentRun`, replace the inline `canUseTool`/`query(...)` construction (lines ~242-316), the message `for await` loop (lines ~320-356), and the inline gate loop (lines ~366-370) with calls to three local helpers defined at the top of the `record.done` async body (after `let branch`/`let lastGates`, and after `planTracker`/`costTracker` are created - note these currently live inside the `try`; move the `const planTracker = new PlanTracker(); const costTracker = new CostTracker();` declarations up to just before the helpers so the helpers can close over them, and remove the later duplicate declarations at lines ~239-240).

Add the shared `canUseTool` closure and options builder. Extract the EXACT body currently inside the inline `canUseTool` into a named local:

```ts
      // Lazily imported so this module never pulls the Agent SDK into a
      // bundle that could reach a Client Component (Global Constraints).
      const { query } = await import("@anthropic-ai/claude-agent-sdk");

      // ONE canUseTool definition, shared by the initial session and every
      // gate-fix resume session (DRY - options are per-process and must be
      // re-passed on every query() call; guide 4.2).
      const canUseTool = async (
        toolName: string,
        input: Record<string, unknown>,
        context: { requestId: string; signal: AbortSignal },
      ): Promise<Awaited<ReturnType<Parameters<typeof query>[0]["options"]["canUseTool"] & object>> extends never ? never : ReturnType<NonNullable<Parameters<typeof query>[0]["options"]>["canUseTool"] extends (...a: never[]) => infer R ? R : never> => {
        if (toolName === "Bash") {
          await bashGate.waitUntilReady();
        }
        const command = toolName === "Bash" && typeof input.command === "string" ? input.command : "";
        const requestLabel = toolName === "Bash" ? command : describeToolRequest(toolName, input);

        const resultPromise = broker.canUseTool(toolName, input, context);
        const isPending = broker.pending().some((pending) => pending.requestId === context.requestId);
        if (isPending) {
          applyEvent(record, {
            kind: "permission-request",
            seq: nextSeq(),
            at: nowIso(),
            requestId: context.requestId,
            command: requestLabel,
          });
        }

        const result = await resultPromise;

        if (isPending) {
          applyEvent(record, {
            kind: "permission-decision",
            seq: nextSeq(),
            at: nowIso(),
            requestId: context.requestId,
            decision: result.behavior === "allow" ? "approved" : "denied",
          });
        }

        if (toolName !== "Bash") {
          return result;
        }

        const isAllowlisted = resolveBashCommand(command, config.bashAllowlist).kind === "allowlisted";
        const kind =
          result.behavior === "deny"
            ? "bash-command-denied"
            : isAllowlisted
              ? "bash-command-allowlisted"
              : "bash-command-approved";
        await appendAuditEvent(projectDir, {
          user: ticket.createdBy,
          ticketId: ticket.id,
          kind,
          runId,
          command,
          detail: `${kind}: ${command}`,
        });
        return result;
      };
```

IMPLEMENTER NOTE on the return type above: the verbose conditional type is only a suggestion to satisfy the SDK's strict `canUseTool` signature. If it does not compile cleanly under `@anthropic-ai/claude-agent-sdk@0.3.209`, replace the annotation with the concrete permission-result union the broker returns - inspect `broker.canUseTool`'s return type in `src/lib/permission/broker.ts` and annotate `canUseTool` with that exact `Promise<...>` type. Do NOT use `any`. The body must be byte-for-byte the current inline body.

Add the options builder:

```ts
      const buildQueryOptions = (resume: string | null): Parameters<typeof query>[0]["options"] => ({
        cwd: worktreePath,
        abortController,
        settingSources: ["user", "project", "local"],
        skills: "all",
        canUseTool,
        ...(resume ? { resume } : {}),
      });
```

Add the shared session consumer (this is the exact current loop body, minus the redundant post-loop `channel.close()` which is folded in as the safety net):

```ts
      // Consume ONE query() session's message stream until its result
      // frame, applying every mapped RunEvent, plan update, and cost
      // update, then closing the channel (idempotent) - the same handling
      // for the initial session and every gate-fix resume session.
      const consumeSession = async (run: AsyncIterable<SDKMessage>, sessionChannel: UserMessageChannel): Promise<void> => {
        for await (const message of run) {
          for (const event of mapSdkMessages(message, nextSeq)) {
            applyEvent(record, event);
          }
          if (planTracker.ingest(message)) {
            applyEvent(record, { kind: "todo-update", seq: nextSeq(), at: nowIso(), todos: planTracker.todos() });
          }
          const cost = costTracker.ingest(message);
          if (cost) {
            applyEvent(record, { kind: "cost-update", seq: nextSeq(), at: nowIso(), cumulative: cost });
          }
          if (message.type === "result") {
            // A streaming-input session stays open waiting for more input;
            // close and stop consuming as soon as the result frame is seen
            // (docs/blueprint/02-agent-sdk-guide.md; the Phase 2 deadlock
            // fix). close() is idempotent.
            sessionChannel.close();
            return;
          }
        }
        // Safety net for any exit path that ends without a result frame.
        sessionChannel.close();
      };
```

Add `SDKMessage` to the SDK type imports if not already present. Since the SDK is dynamically imported, add a top-of-file type-only import: `import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";`

Add the gate-pass helper (this replaces the inline gate loop; it collects and returns the results and keeps populating `lastGates`):

```ts
      const runGatesOnce = async (gatesWorktreePath: string): Promise<Gate[]> => {
        const gates: Gate[] = [];
        for (const gateName of ticket.gates) {
          const scriptName = config.scripts[gateName as keyof typeof config.scripts] ?? gateName;
          const gate = await runGate(gatesWorktreePath, gateName, scriptName, config.packageManager);
          applyEvent(record, { kind: "gate-result", seq: nextSeq(), at: nowIso(), gate });
          gates.push(gate);
        }
        return gates;
      };
```

Now rewire the three call sites. Replace the inline `const run = query({...})` + the `for await` loop + the trailing `channel.close()` with:

```ts
      const run = query({ prompt: channel, options: buildQueryOptions(null) });

      applyEvent(record, { kind: "phase-change", seq: nextSeq(), at: nowIso(), from: record.view.state, to: "executing" });

      await consumeSession(run, channel);
      costTracker.sealSession();
```

Then the existing `phase-change -> gates-running` + `appendRunState` stay as-is, and replace the inline gate loop with:

```ts
      lastGates = await runGatesOnce(worktreePath);
```

Leave the success tail (`phase-change -> completed`, `commitAll`, summary write from Task 4, `setTicketStatus`) unchanged except that the summary already reads `lastGates`.

IMPLEMENTER NOTE: `costTracker.sealSession()` after the initial `consumeSession` is intentional and safe - with a single session, `committed` becomes the session's cost and `current` resets to zero, so `total()` is unchanged. It sets up Task 7's per-session accumulation.

- [ ] **Step 3: Run the full manager suite to verify NO behavior changed**

Run: `pnpm test -- src/lib/run/manager.test.ts && pnpm typecheck`
Expected: PASS - every existing test (channel lifecycle, audit event, executing-before-gates ordering, interrupt handling, permission-request/decision, and the Task 4 summary test) still green. If the interrupt or permission tests regress, the `consumeSession`/`canUseTool` extraction changed behavior - revert and re-extract more carefully; the bodies must be identical to the originals.

- [ ] **Step 4: Commit**

```bash
git add src/lib/run/manager.ts
git commit -m "$(printf '%s\n\n%s' \
  "refactor: extract runGatesOnce, shared query options, session consumer" \
  "- behavior-preserving; no new events or loop yet
- one canUseTool + options builder shared by initial and (future) resume calls
- consumeSession drains one session to its result frame; seals cost per session")"
```

---

## Task 7: The gate-feedback iteration loop (LARGEST / RISKIEST - flag for a most-capable-model reviewer)

**Files:**
- Modify: `src/lib/run/manager.ts` (extend `RunHandle.control` type ~lines 39-43; add `iterationDecider` + the loop inside `startAgentRun`; the loop-exit tail deviation comment)
- Modify: `src/app/api/runs/[runId]/steer/route.test.ts:46` and `src/app/api/runs/[runId]/interrupt/route.test.ts:36` (their hand-rolled `handle.control = {...}` literals must add `resolveIteration` to keep compiling under the extended type)
- Test: `src/lib/run/manager.test.ts` (add a new `describe` block with `vi.mock("@/lib/gates", ...)` and multi-iteration tests)

**Interfaces:**
- Consumes: `runGatesOnce`, `buildQueryOptions`, `consumeSession` (Task 6); `UserMessageChannel` (already imported); `costTracker.sealSession`/`total` (Task 5); `record.run.iteration`, `record.control`, `abortController`.
- Produces:
  - Extended control shape:
    ```ts
    control?: {
      channel: UserMessageChannel;
      resolvePermission: (requestId: string, decision: "allow" | "always" | "deny") => void;
      abortController: AbortController;
      resolveIteration: (decision: "continue" | "stop") => void;
    };
    ```
  - Loop semantics (LOCKED - do not re-derive): iteration 0 = the initial gate run. On any gate `status: "failed"`, up to 3 fix cycles run. Iteration 1 is automatic (no checkpoint). Before iteration 2 ONLY, emit `gate-retry-projection` then `phase-change gates-running -> awaiting-iteration-approval` and WAIT for `resolveIteration`. Continue -> iteration 2 runs; if it still fails, iteration 3 runs automatically (no second checkpoint). Stop -> break to the tail. Cap: `record.run.iteration >= 3` breaks the loop. All loop exits fall through to the EXISTING completed/commit/review tail (LOCKED DEVIATION).
  - Projected cost: at the checkpoint, `projectedCostUsd = costTracker.total().costUsd / (record.run.iteration + 1)`; emit `{ kind: "gate-retry-projection", iteration: record.run.iteration + 1, projectedCostUsd }` (i.e. `iteration: 2`, `sessionsSoFar = 2`).
  - Each fix cycle: a NEW `UserMessageChannel` (the original is closed and cannot reopen); swap `record.control!.channel = newChannel` before pushing; push a feedback message; `query({ prompt: newChannel, options: buildQueryOptions(record.run.sessionId) })`; `consumeSession(fixRun, newChannel)`; `costTracker.sealSession()`.

- [ ] **Step 1: Write the failing tests** - add to `src/lib/run/manager.test.ts`. At the TOP of the file (with the other `vi.mock` calls), add a mock for the gates module whose default resolves a passing gate, so existing `gates: []` tests never trigger it and are unaffected:

```ts
vi.mock("@/lib/gates", () => ({
  runGate: vi.fn().mockResolvedValue({
    name: "typecheck",
    basis: "command",
    status: "passed",
    score: 100,
    explanation: "typecheck exited 0",
    durationMs: 5,
  }),
}));
```

Add `import { runGate } from "@/lib/gates";` to the test imports so `vi.mocked(runGate)` is available. Add a helper and a new describe block:

```ts
const PASSED_GATE = { name: "typecheck", basis: "command", status: "passed", score: 100, explanation: "ok", durationMs: 5 } as const;
const FAILED_GATE = { name: "typecheck", basis: "command", status: "failed", score: 0, explanation: "TS2322: type error", durationMs: 5 } as const;

describe("startAgentRun gate-feedback loop (mocked SDK + mocked gates, no real API calls)", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let ticket: Ticket;

  beforeEach(async () => {
    resetRunRegistry();
    ({ dir, cleanup } = await makeScratchDir());
    await initForge(dir);
    const base = await createTicket(
      dir,
      { type: "generic", title: "Gate loop", inputs: { prompt: "Gate loop" }, jiraRef: null, source: "manual" },
      DEV,
    );
    // startAgentRun receives the ticket object directly; give it one gate so
    // the loop has something to fail/pass on (createTicket defaults gates to []).
    ticket = { ...base, gates: ["typecheck"] };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  it("runs iteration 1 automatically and completes when the fix passes", async () => {
    vi.mocked(runGate).mockResolvedValueOnce(FAILED_GATE).mockResolvedValue(PASSED_GATE);
    const handle = startAgentRun(dir, ticket, DEFAULT_FORGE_CONFIG);
    await handle.done;

    expect(handle.run.iteration).toBe(1);
    expect(handle.run.state).toBe("completed");
    const phases = handle.events.filter((e): e is Extract<RunEvent, { kind: "phase-change" }> => e.kind === "phase-change");
    // gates-running -> executing (fix), then executing -> gates-running.
    expect(phases.some((p) => p.from === "gates-running" && p.to === "executing")).toBe(true);
    expect(handle.events.some((e) => e.kind === "gate-retry-projection")).toBe(false);
  }, 5000);

  it("pauses at awaiting-iteration-approval before iteration 2 and resumes on continue", async () => {
    vi.mocked(runGate).mockResolvedValueOnce(FAILED_GATE).mockResolvedValueOnce(FAILED_GATE).mockResolvedValue(PASSED_GATE);
    const handle = startAgentRun(dir, ticket, DEFAULT_FORGE_CONFIG);

    await vi.waitFor(() => {
      expect(handle.view.state).toBe("awaiting-iteration-approval");
    }, { timeout: 3000, interval: 5 });

    const projection = handle.events.find((e): e is Extract<RunEvent, { kind: "gate-retry-projection" }> => e.kind === "gate-retry-projection");
    expect(projection?.iteration).toBe(2);
    // two sealed sessions so far (initial + iteration 1), 0.01 each in the
    // default fake stream, total 0.02, / (iteration(=1) + 1) = 0.01.
    expect(projection?.projectedCostUsd).toBeCloseTo(0.01, 10);
    expect(handle.view.pendingIteration).toEqual({ iteration: 2, projectedCostUsd: projection?.projectedCostUsd });

    handle.control?.resolveIteration("continue");
    await handle.done;

    expect(handle.run.iteration).toBe(2);
    expect(handle.run.state).toBe("completed");
    expect(handle.view.pendingIteration).toBeNull();
  }, 6000);

  it("exits to completed on stop, leaving the failing gates shown", async () => {
    vi.mocked(runGate).mockResolvedValueOnce(FAILED_GATE).mockResolvedValue(FAILED_GATE);
    const handle = startAgentRun(dir, ticket, DEFAULT_FORGE_CONFIG);

    await vi.waitFor(() => {
      expect(handle.view.state).toBe("awaiting-iteration-approval");
    }, { timeout: 3000, interval: 5 });

    handle.control?.resolveIteration("stop");
    await handle.done;

    expect(handle.run.iteration).toBe(1); // never advanced to iteration 2
    expect(handle.run.state).toBe("completed");
    expect(handle.view.gates.some((g) => g.status === "failed")).toBe(true);
  }, 6000);

  it("caps at iteration 3 when gates keep failing after the checkpoint", async () => {
    vi.mocked(runGate).mockResolvedValue(FAILED_GATE); // always fails
    const handle = startAgentRun(dir, ticket, DEFAULT_FORGE_CONFIG);

    await vi.waitFor(() => {
      expect(handle.view.state).toBe("awaiting-iteration-approval");
    }, { timeout: 3000, interval: 5 });

    handle.control?.resolveIteration("continue"); // iteration 2, then iteration 3 auto
    await handle.done;

    expect(handle.run.iteration).toBe(3);
    expect(handle.run.state).toBe("completed");
    const projections = handle.events.filter((e) => e.kind === "gate-retry-projection");
    expect(projections).toHaveLength(1); // only the before-iteration-2 checkpoint
  }, 8000);

  it("accumulates cost across the initial session and fix sessions", async () => {
    vi.mocked(runGate).mockResolvedValueOnce(FAILED_GATE).mockResolvedValue(PASSED_GATE);
    const handle = startAgentRun(dir, ticket, DEFAULT_FORGE_CONFIG);
    await handle.done;
    // initial + iteration-1 sessions, 0.01 each in the default fake stream.
    expect(handle.view.cost.costUsd).toBeCloseTo(0.02, 10);
  }, 5000);

  it("treats an abort during the checkpoint wait as an interrupt", async () => {
    vi.mocked(runGate).mockResolvedValueOnce(FAILED_GATE).mockResolvedValue(FAILED_GATE);
    const handle = startAgentRun(dir, ticket, DEFAULT_FORGE_CONFIG);

    await vi.waitFor(() => {
      expect(handle.view.state).toBe("awaiting-iteration-approval");
    }, { timeout: 3000, interval: 5 });

    handle.control?.abortController.abort();
    await handle.done;

    expect(handle.run.state).toBe("interrupted");
    expect(handle.events.some((e) => e.kind === "error")).toBe(false);
  }, 6000);
});
```

Also update the two existing route tests so their hand-rolled control literals compile under the extended type:

`src/app/api/runs/[runId]/steer/route.test.ts:46` and `src/app/api/runs/[runId]/interrupt/route.test.ts:36` - change each `handle.control = { channel: new UserMessageChannel(), resolvePermission: () => {}, abortController: new AbortController() };` to:

```ts
    handle.control = { channel: new UserMessageChannel(), resolvePermission: () => {}, abortController: new AbortController(), resolveIteration: () => {} };
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- src/lib/run/manager.test.ts`
Expected: FAIL - `resolveIteration` not on control; loop does not exist so no `gate-retry-projection`, no `awaiting-iteration-approval` pause; `pendingIteration` not on view (that field lands in Task 9 - so the `pendingIteration` assertions ALSO fail here). To keep Task 7 self-contained and its tests runnable, the `pendingIteration` view assertions in the "continue" test above depend on Task 9. Split: if executing strictly task-by-task, comment out the two `pendingIteration` lines in the "continue" test with a `// enabled in Task 9` note and re-enable them in Task 9. (The loop, projection event, and pause-state assertions all stand on their own in Task 7.)

- [ ] **Step 3: Implement** - in `src/lib/run/manager.ts`:

Extend the `control` type in the `RunHandle` interface (lines 39-43):

```ts
  control?: {
    channel: UserMessageChannel;
    resolvePermission: (requestId: string, decision: "allow" | "always" | "deny") => void;
    abortController: AbortController;
    /** Resolves the before-iteration-2 gate-feedback cost checkpoint. */
    resolveIteration: (decision: "continue" | "stop") => void;
  };
```

At the top of `startAgentRun` (before building `record`), add the decider slot and wire `resolveIteration` into the control literal (line 185):

```ts
  let iterationDecider: ((decision: "continue" | "stop") => void) | null = null;
  const resolveIteration = (decision: "continue" | "stop"): void => {
    iterationDecider?.(decision);
    iterationDecider = null;
  };
```

Change the control literal (line 185) to include it:

```ts
    control: { channel, resolvePermission: broker.resolve, abortController, resolveIteration },
```

Add two helpers inside the `record.done` body, next to the other local helpers from Task 6. The feedback-message builder:

```ts
      const buildGateFeedback = (failed: Gate[]): string => {
        const header = "Some quality gates failed. Please fix them, then stop.";
        const sections = failed.map((gate) => `\n\n## ${gate.name}\n${gate.explanation}`).join("");
        return `${header}${sections}`;
      };
```

The checkpoint wait (mirrors the Task 4/12-era pre-aborted-signal guard):

```ts
      const waitForIterationDecision = (): Promise<"continue" | "stop"> =>
        new Promise<"continue" | "stop">((resolve, reject) => {
          iterationDecider = resolve;
          if (abortController.signal.aborted) {
            reject(new Error("aborted"));
            return;
          }
          abortController.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
```

Now replace the single `lastGates = await runGatesOnce(worktreePath);` line (from Task 6) with the loop. Keep the `phase-change -> gates-running` + `appendRunState` that precede it. The loop:

```ts
      lastGates = await runGatesOnce(worktreePath);

      // Gate-feedback loop (docs/blueprint/06-execution-model.md). Iteration
      // 0 was the initial gate run above. Up to 3 fix cycles: iteration 1 is
      // automatic; before iteration 2 ONLY we show the projected retry cost
      // and wait for a continue/stop decision; iteration 3 (if reached) runs
      // automatically. The cap is 3.
      while (lastGates.some((gate) => gate.status === "failed") && record.run.iteration < 3) {
        const nextIteration = record.run.iteration + 1;

        if (nextIteration === 2) {
          // Before-iteration-2 human cost checkpoint. Projected cost is the
          // observed cost so far averaged across the sessions run so far
          // (initial + iteration 1 = record.run.iteration + 1 = 2).
          const projectedCostUsd = costTracker.total().costUsd / (record.run.iteration + 1);
          applyEvent(record, { kind: "gate-retry-projection", seq: nextSeq(), at: nowIso(), iteration: nextIteration, projectedCostUsd });
          applyEvent(record, { kind: "phase-change", seq: nextSeq(), at: nowIso(), from: record.view.state, to: "awaiting-iteration-approval" });
          const decision = await waitForIterationDecision();
          if (decision === "stop") break;
        }

        // Enter the fix cycle: resume the agent session with gate feedback.
        applyEvent(record, { kind: "phase-change", seq: nextSeq(), at: nowIso(), from: record.view.state, to: "executing" });
        record.run = { ...record.run, iteration: nextIteration };
        await appendRunState(projectDir, ticket.id, runId, {
          state: record.run.state,
          sessionId: record.run.sessionId,
          worktreePath: record.run.worktreePath,
          branch,
          iteration: record.run.iteration,
        });

        const failedGates = lastGates.filter((gate) => gate.status === "failed");
        // A resumed session needs a NEW channel (the initial one is closed
        // after its result frame and cannot reopen). Swap it onto control so
        // steer keeps targeting the live session (guide 4.2: re-pass options).
        const fixChannel = new UserMessageChannel();
        record.control!.channel = fixChannel;
        fixChannel.push(buildGateFeedback(failedGates));
        const fixRun = query({ prompt: fixChannel, options: buildQueryOptions(record.run.sessionId) });
        await consumeSession(fixRun, fixChannel);
        costTracker.sealSession();

        applyEvent(record, { kind: "phase-change", seq: nextSeq(), at: nowIso(), from: record.view.state, to: "gates-running" });
        await appendRunState(projectDir, ticket.id, runId, {
          state: record.run.state,
          sessionId: record.run.sessionId,
          worktreePath: record.run.worktreePath,
          branch,
          iteration: record.run.iteration,
        });
        lastGates = await runGatesOnce(worktreePath);
      }
```

Immediately before the existing success-tail `phase-change -> "completed"` (line ~372), add the deviation comment and use `record.view.state` as the `from`:

```ts
      // LOCKED DEVIATION (Phase 2 addendum): the blueprint routes the gate
      // loop's exit through a run-pausing `awaiting-approval` terminal. That
      // approval-lifecycle restructure is deferred to Phase 3; here every
      // loop exit (fix passed, developer stopped, or cap reached) falls
      // through to the existing Phase 2 completed/commit/review tail, with
      // any still-failing gates shown as-is. `from` is record.view.state so
      // a stop-at-checkpoint exit reports the accurate prior state.
      applyEvent(record, { kind: "phase-change", seq: nextSeq(), at: nowIso(), from: record.view.state, to: "completed" });
```

IMPLEMENTER NOTE: an abort during `waitForIterationDecision()` rejects the promise, which propagates out of the `record.done` `try` into the existing `catch`, where `abortController.signal.aborted === true` routes it to `interrupted` (the Gap 3 behavior already in place). No new catch handling is needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/lib/run/manager.test.ts src/app/api/runs/[runId]/steer/route.test.ts src/app/api/runs/[runId]/interrupt/route.test.ts && pnpm typecheck`
Expected: PASS - the new loop tests plus all existing manager/steer/interrupt tests. (The two `pendingIteration` assertions stay commented until Task 9.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/run/manager.ts src/lib/run/manager.test.ts src/app/api/runs/[runId]/steer/route.test.ts src/app/api/runs/[runId]/interrupt/route.test.ts
git commit -m "$(printf '%s\n\n%s' \
  "feat: add the gate-feedback iteration loop" \
  "- up to 3 fix cycles: iter 1 auto, checkpoint before iter 2, iter 3 auto
- resume via new UserMessageChannel + buildGateFeedback + shared options
- resolveIteration control API; abort during wait -> interrupted
- cost accumulates per session (sealSession); projected cost = total/(iter+1)
- LOCKED DEVIATION: loop exits to existing completed/commit/review tail")"
```

---

## Task 8: `POST /api/runs/[runId]/iteration` route

**Files:**
- Create: `src/app/api/runs/[runId]/iteration/route.ts`
- Test: `src/app/api/runs/[runId]/iteration/route.test.ts`

**Interfaces:**
- Consumes: `getRun` from `@/lib/run/manager`; `RunHandle` type; `handle.control.resolveIteration` (Task 7).
- Produces: a `POST` handler. Body `{ decision: "continue" | "stop" }`. Validation: 400 if the decision is not one of the two literals; 404 if no run; 400 if `!handle.control`; 400 if the run is not currently at `awaiting-iteration-approval`. On success calls `handle.control.resolveIteration(decision)` and returns `{ ok: true }`. Mirrors the steer/interrupt route shape and JSON-error style. No audit event (there is no matching `AuditEvent` kind, and the steer/interrupt precedent audits only their own kinds).

- [ ] **Step 1: Write the failing test** - `src/app/api/runs/[runId]/iteration/route.test.ts` (mirror `interrupt/route.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { createTicket, initForge } from "@/lib/forge/store";
import { resetRunRegistry, startSimulatedRun } from "@/lib/run/manager";
import type { RunHandle } from "@/lib/run/manager";
import { UserMessageChannel } from "@/lib/session/channel";
import { makeScratchDir } from "@/test/helpers";
import { POST } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("POST /api/runs/[runId]/iteration", () => {
  it("returns 404 for an unknown run", async () => {
    resetRunRegistry();
    const res = await POST(jsonRequest({ decision: "continue" }), { params: Promise.resolve({ runId: "run-nope" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid decision", async () => {
    resetRunRegistry();
    const res = await POST(jsonRequest({ decision: "maybe" }), { params: Promise.resolve({ runId: "run-nope" }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a run with no control", async () => {
    resetRunRegistry();
    const { dir, cleanup } = await makeScratchDir();
    await initForge(dir);
    const ticket = await createTicket(dir, { type: "generic", title: "t", inputs: { prompt: "t" }, jiraRef: null, source: "manual" }, "Dev <d@e.com>");
    const handle = startSimulatedRun(dir, ticket, { delayMs: 50 });
    const res = await POST(jsonRequest({ decision: "continue" }), { params: Promise.resolve({ runId: handle.run.id }) });
    expect(res.status).toBe(400);
    await handle.done;
    await cleanup();
  });

  it("returns 400 when the run is not at the iteration checkpoint", async () => {
    resetRunRegistry();
    const { dir, cleanup } = await makeScratchDir();
    await initForge(dir);
    const ticket = await createTicket(dir, { type: "generic", title: "t", inputs: { prompt: "t" }, jiraRef: null, source: "manual" }, "Dev <d@e.com>");
    const handle: RunHandle = startSimulatedRun(dir, ticket, { delayMs: 20 });
    handle.control = { channel: new UserMessageChannel(), resolvePermission: () => {}, abortController: new AbortController(), resolveIteration: () => {} };
    // The simulated run's view.state is not awaiting-iteration-approval.
    const res = await POST(jsonRequest({ decision: "continue" }), { params: Promise.resolve({ runId: handle.run.id }) });
    expect(res.status).toBe(400);
    await handle.done;
    await cleanup();
  });

  it("resolves the checkpoint and returns 200 when the run is awaiting the decision", async () => {
    resetRunRegistry();
    const { dir, cleanup } = await makeScratchDir();
    await initForge(dir);
    const ticket = await createTicket(dir, { type: "generic", title: "t", inputs: { prompt: "t" }, jiraRef: null, source: "manual" }, "Dev <d@e.com>");
    const handle: RunHandle = startSimulatedRun(dir, ticket, { delayMs: 20 });
    let resolved: "continue" | "stop" | null = null;
    handle.control = {
      channel: new UserMessageChannel(),
      resolvePermission: () => {},
      abortController: new AbortController(),
      resolveIteration: (d) => { resolved = d; },
    };
    // Force the view into the checkpoint state so the route's guard passes.
    handle.view = { ...handle.view, state: "awaiting-iteration-approval" };

    const res = await POST(jsonRequest({ decision: "stop" }), { params: Promise.resolve({ runId: handle.run.id }) });
    expect(res.status).toBe(200);
    expect(resolved).toBe("stop");
    await handle.done;
    await cleanup();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- "src/app/api/runs/[runId]/iteration/route.test.ts"`
Expected: FAIL - `./route` does not exist.

- [ ] **Step 3: Implement** - `src/app/api/runs/[runId]/iteration/route.ts`:

```ts
import { getRun } from "@/lib/run/manager";

export const dynamic = "force-dynamic";

const VALID_DECISIONS = ["continue", "stop"] as const;
type IterationDecision = (typeof VALID_DECISIONS)[number];

function isDecision(value: unknown): value is IterationDecision {
  return typeof value === "string" && (VALID_DECISIONS as readonly string[]).includes(value);
}

/** Resolves the before-iteration-2 gate-feedback cost checkpoint (docs/blueprint/06-execution-model.md: gate-feedback loop). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await params;
  const parsed: unknown = await req.json().catch(() => null);
  const body = (typeof parsed === "object" && parsed !== null ? parsed : {}) as { decision?: unknown };
  if (!isDecision(body.decision)) {
    return Response.json({ error: "decision must be one of continue, stop" }, { status: 400 });
  }

  const handle = getRun(runId);
  if (!handle) return Response.json({ error: "run not found" }, { status: 404 });
  if (!handle.control) return Response.json({ error: "this run has no iteration checkpoint" }, { status: 400 });
  if (handle.view.state !== "awaiting-iteration-approval") {
    return Response.json({ error: "run is not awaiting an iteration decision" }, { status: 400 });
  }
  handle.control.resolveIteration(body.decision);
  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- "src/app/api/runs/[runId]/iteration/route.test.ts" && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/runs/[runId]/iteration/route.ts" "src/app/api/runs/[runId]/iteration/route.test.ts"
git commit -m "$(printf '%s\n\n%s' \
  "feat: add POST /api/runs/[runId]/iteration route" \
  "- validates continue/stop; 404 no run, 400 no control / wrong state
- resolves the gate-feedback cost checkpoint via control.resolveIteration")"
```

---

## Task 9: `RunView.pendingIteration` + reducer handling + iteration-checkpoint UI

**Files:**
- Modify: `src/lib/run/reducer.ts` (add `pendingIteration` to `RunView`, to `initialRunView`, and reducer handling for `gate-retry-projection` + `phase-change`)
- Modify: `src/lib/run/manager.test.ts` (re-enable the two `pendingIteration` assertions commented out in Task 7)
- Modify: `src/lib/run/reducer.test.ts` (append set/clear cases)
- Create: `src/components/run/iteration-checkpoint.tsx`
- Modify: `src/components/run/plan-progress-panel.tsx` (render the checkpoint when `view.pendingIteration` is set)
- Modify: `src/lib/ui/format.ts` only IF a cost formatter is needed by the component - reuse the existing `formatCost` already imported by the panel (no change expected).

**Interfaces:**
- Consumes: `RunEvent`, `RunView`; `formatCost` from `@/lib/ui/format`.
- Produces:
  - `RunView.pendingIteration: { iteration: number; projectedCostUsd: number } | null` (default `null` in `initialRunView`).
  - Reducer: on `gate-retry-projection` set `pendingIteration = { iteration, projectedCostUsd }`; on `phase-change` where `event.to !== "awaiting-iteration-approval"` clear `pendingIteration` to `null` (so it shows ONLY while paused at the checkpoint). All other reducer behavior identical.
  - `IterationCheckpoint` client component: shows the projected cost + Continue/Stop buttons, `POST`s to `/api/runs/[runId]/iteration`.

- [ ] **Step 1: Write the failing reducer test** - append to `src/lib/run/reducer.test.ts`:

```ts
describe("reduceRun pendingIteration (gate-feedback checkpoint)", () => {
  it("sets pendingIteration on gate-retry-projection", () => {
    const view = reduceRun(initialRunView("run-p"), {
      kind: "gate-retry-projection", seq: 1, at: "t", iteration: 2, projectedCostUsd: 0.05,
    });
    expect(view.pendingIteration).toEqual({ iteration: 2, projectedCostUsd: 0.05 });
  });

  it("keeps pendingIteration while transitioning INTO awaiting-iteration-approval", () => {
    let view = reduceRun(initialRunView("run-p"), { kind: "gate-retry-projection", seq: 1, at: "t", iteration: 2, projectedCostUsd: 0.05 });
    view = reduceRun(view, { kind: "phase-change", seq: 2, at: "t", from: "gates-running", to: "awaiting-iteration-approval" });
    expect(view.pendingIteration).toEqual({ iteration: 2, projectedCostUsd: 0.05 });
  });

  it("clears pendingIteration on any other phase-change", () => {
    let view = reduceRun(initialRunView("run-p"), { kind: "gate-retry-projection", seq: 1, at: "t", iteration: 2, projectedCostUsd: 0.05 });
    view = reduceRun(view, { kind: "phase-change", seq: 2, at: "t", from: "awaiting-iteration-approval", to: "executing" });
    expect(view.pendingIteration).toBeNull();
  });

  it("defaults pendingIteration to null", () => {
    expect(initialRunView("run-p").pendingIteration).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/run/reducer.test.ts`
Expected: FAIL - `pendingIteration` is not on `RunView`.

- [ ] **Step 3: Implement the reducer** - in `src/lib/run/reducer.ts`:

Add to the `RunView` interface (after `pendingPermission`, line ~25):

```ts
  /**
   * The paused gate-feedback cost checkpoint the UI shows continue/stop
   * buttons for, or null when the run is not at the before-iteration-2
   * checkpoint. Set by `gate-retry-projection`; cleared by any phase-change
   * that leaves `awaiting-iteration-approval`.
   */
  pendingIteration: { iteration: number; projectedCostUsd: number } | null;
```

Add to `initialRunView` (after `pendingPermission: null`, line ~44):

```ts
    pendingIteration: null,
```

Update the `phase-change` case (line 50-51) to clear `pendingIteration` unless entering the checkpoint:

```ts
    case "phase-change":
      return {
        ...view,
        state: event.to,
        pendingIteration: event.to === "awaiting-iteration-approval" ? view.pendingIteration : null,
      };
```

Move `gate-retry-projection` OUT of the no-op group (lines 66-77) into its own case that sets `pendingIteration`:

```ts
    case "gate-retry-projection":
      return { ...view, pendingIteration: { iteration: event.iteration, projectedCostUsd: event.projectedCostUsd } };
```

And remove `"gate-retry-projection"` from the fall-through group's case labels so the remaining group is:

```ts
    case "run-started":
    case "plan-proposed":
    case "plan-decision":
    case "steer-message":
    case "tool-use":
    case "tool-result":
    case "bash-command":
      return view;
```

- [ ] **Step 4: Run reducer test + re-enable manager assertions**

Run: `pnpm test -- src/lib/run/reducer.test.ts`
Expected: PASS.

Re-enable the two `pendingIteration` assertions in the Task 7 "continue" test in `src/lib/run/manager.test.ts` (uncomment them), then:

Run: `pnpm test -- src/lib/run/manager.test.ts`
Expected: PASS - `handle.view.pendingIteration` now populated at the checkpoint and null after resume.

- [ ] **Step 5: Build the UI component** - `src/components/run/iteration-checkpoint.tsx` (mirror the permission-prompt block in `plan-progress-panel.tsx` and `approval-actions.tsx`):

```tsx
"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import { formatCost } from "@/lib/ui/format";

const DECISIONS = ["continue", "stop"] as const;
type Decision = (typeof DECISIONS)[number];

const DECISION_LABEL: Record<Decision, string> = {
  continue: "Continue",
  stop: "Stop here",
};

export function IterationCheckpoint({
  runId,
  iteration,
  projectedCostUsd,
}: {
  runId: string;
  iteration: number;
  projectedCostUsd: number;
}): ReactElement {
  const [sending, setSending] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: Decision): Promise<void> {
    if (sending) return;
    setSending(decision);
    setError(null);
    const res = await fetch(`/api/runs/${runId}/iteration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `request failed (${res.status})`);
    }
    // No manual refresh: the SSE stream emits the run's next phase-change
    // once the checkpoint resolves, folding pendingIteration back to null.
    setSending(null);
  }

  return (
    <div className="mt-3 rounded-lg border border-amber-900 bg-amber-950/40 p-3 text-sm">
      <p className="text-amber-200">
        Gates still failing. Run fix iteration {iteration}? Projected added cost:{" "}
        <span className="text-amber-100">{formatCost(projectedCostUsd)}</span>
      </p>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-400">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex gap-2">
        {DECISIONS.map((decision) => (
          <button
            key={decision}
            type="button"
            disabled={sending !== null}
            onClick={() => void decide(decision)}
            className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 disabled:opacity-50"
          >
            {sending === decision ? "Sending..." : DECISION_LABEL[decision]}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Render it in the panel** - in `src/components/run/plan-progress-panel.tsx`, add the import at the top:

```tsx
import { IterationCheckpoint } from "./iteration-checkpoint";
```

Destructure `pendingIteration` alongside `pendingPermission` (line 56):

```tsx
  const { pendingPermission, pendingIteration } = view;
```

Add the render block immediately AFTER the closing of the `pendingPermission ? (...) : null` block (after line 147), before the closing `</section>`:

```tsx
      {pendingIteration ? (
        <IterationCheckpoint
          runId={view.runId}
          iteration={pendingIteration.iteration}
          projectedCostUsd={pendingIteration.projectedCostUsd}
        />
      ) : null}
```

- [ ] **Step 7: Verify build + lint + full suite**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS across the whole suite. (The UI component has no node-runnable render test by repo convention - see the Testing note in Global Constraints; it is exercised in Manual Verification.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/run/reducer.ts src/lib/run/reducer.test.ts src/lib/run/manager.test.ts src/components/run/iteration-checkpoint.tsx src/components/run/plan-progress-panel.tsx
git commit -m "$(printf '%s\n\n%s' \
  "feat: surface the gate-feedback cost checkpoint in the run view" \
  "- RunView.pendingIteration set by gate-retry-projection, cleared on exit
- IterationCheckpoint component POSTs continue/stop to the iteration route
- rendered in PlanProgressPanel next to the permission prompt")"
```

---

## Manual Verification (developer-present, funded key, NOT in CI)

> STOP: this is the ONLY step in this plan that spends money. Do NOT run it without the developer present and having explicitly said "go ahead" for this session, exactly like Phase 2 Tasks 5/11. Never run in CI or unattended.

Prerequisites: a real target project on disk with a `.forge/config.json` whose `gates` include at least one command gate (e.g. `typecheck`) that can be made to fail, a valid `ANTHROPIC_API_KEY` in the environment, and the app running against the real engine (`isRealEngineAvailable()` true).

- [ ] Create a ticket whose worktree will fail a gate (e.g. introduce a deliberate type error the agent's first pass leaves, or a task that plausibly needs a fix pass). Set the ticket's `gates` to include the failing gate.
- [ ] Start the run. Confirm: the initial session runs, gates run (iteration 0), and on failure iteration 1 starts automatically with `phase-change gates-running -> executing`, a fresh feedback message appears in the run stream, and the resumed session continues the SAME `sessionId` (check the run transcript's state lines).
- [ ] If gates still fail after iteration 1, confirm the run pauses at `awaiting-iteration-approval`, the `gate-retry-projection` event fires with `iteration: 2` and a plausible `projectedCostUsd`, and the `IterationCheckpoint` UI shows the projected cost with Continue/Stop buttons.
- [ ] Click Continue: confirm iteration 2 runs, and if it still fails, iteration 3 runs automatically with NO second checkpoint, then the run exits to `completed` -> commit -> ticket status `review` regardless of the final gate state.
- [ ] Re-run and click Stop at the checkpoint: confirm the loop exits immediately to `completed` -> `review` with the still-failing gates shown as-is.
- [ ] Interrupt during the checkpoint wait: confirm the run ends `interrupted` (not `failed`). NOTE: WIP-commit-on-interrupt is a separate roadmap item NOT in this addendum - the current `catch` path removes the worktree (discarding uncommitted work), so verify only the terminal state label here (`interrupted`), not any commit/branch-retention behavior.
- [ ] After any completed run, open `.forge/tickets/<ticket-id>/runs/<run-id>.summary.json` and confirm it exists, is valid JSON, has the correct terminal `state`, real `filesTouched` paths (no contents/diffs), `commandsRun: []`, the last iteration's `gates`, the accumulated `cost`, and the correct `iteration` count.

## Known gaps carried forward (document, do not fix here)

- `RunSummary.commandsRun` is always `[]` for now. The permission-only Bash path does not capture per-command exit codes/durations; a future task parsing Bash tool-results will populate it. Exit codes are never fabricated.
- The `awaiting-approval -> completed` approval-lifecycle restructure remains deferred to Phase 3. The gate loop deliberately exits to the existing `completed`/commit/`review` tail (the LOCKED DEVIATION documented in the intro and in a code comment at the loop-exit tail).
- Plan-then-approve mode, the command-vs-heuristic gate-basis split, and the template system remain out of scope for this addendum (separate later plan).
- **A gate-feedback run paused at the `awaiting-iteration-approval` checkpoint does not survive an app restart.** The checkpoint block emits the phase-change but does not `appendRunState` (the persisted state stays `gates-running` while paused), and the `resolveIteration` decider lives only in the in-memory run closure. On restart the launch janitor treats the run as orphaned and it cannot resume. This is inherent to an in-memory human-pause (persisting the label alone would not enable resume); surfaced by the final whole-branch review as a documentation note, not a defect. A real resume-across-restart for a paused checkpoint would need the resume task (deferred Phase 2 gap 8) plus a persisted pending-decision.
- **A checkpoint-paused run leaves its ticket in `running` until the developer decides or interrupts.** Correct by design (the run genuinely is paused). Combined with the restart limitation above, a checkpoint run lost to a restart can strand a ticket at `running` until the janitor or a subsequent run touches it.

---

## Self-Review

**1. Spec coverage vs the two gaps:**

- Gap 1 (gate-feedback loop): iteration definition + cap (T7), automatic iteration 1 (T7), before-iteration-2 checkpoint with projection + `awaiting-iteration-approval` pause (T7), continue/stop (T7 + T8 route), iteration 3 auto (T7 cap test), resume via new channel + shared options + feedback message (T6 builder, T7 loop), `costTracker.sealSession()` per session (T5 + T7), `resolveIteration` control API + abort handling (T7), projected-cost formula `total/(iteration+1)` (T7), view `pendingIteration` + UI (T9), loop-exit-to-completed DEVIATION documented (intro + T7 comment). Covered.
- Gap 4 (RunSummary): canonical types verbatim (T1), `changedFiles` helper (T2), `buildRunSummary`/`writeRunSummary` (T3), wired into success + catch terminal paths best-effort (T4), `commandsRun: []` documented (T3 + T4 + Known gaps), sanitization invariant asserted (T1 + T3 tests), `rejected` not written by this writer noted (T4 comment). Covered.

**2. Placeholder scan:** No "TBD"/"TODO"/"similar to Task N"/"add error handling". Every code step has complete code. The one deliberate cross-task dependency (T7's `pendingIteration` assertions needing T9's field) is called out explicitly with a comment-out/re-enable instruction, not left as a silent gap. The one place with a judgment latitude - the `canUseTool` return-type annotation in T6 - carries an explicit IMPLEMENTER NOTE with a concrete fallback (annotate from `broker.canUseTool`'s real return type; never `any`), because the exact SDK type expression cannot be verified without compiling against the pinned SDK.

**3. Type consistency across tasks:** `FileTouch`/`FileChangeKind`/`CommandRecord`/`RunSummary` (T1) are consumed identically in T2 (`changedFiles: Promise<FileTouch[]>`), T3 (`BuildRunSummaryInput`, `buildRunSummary`, `writeRunSummary`), and T4 (manager wiring). `CostTracker.sealSession()`/`total()`/`ingest()` (T5) are used exactly as named in T6/T7. `runGatesOnce`/`buildQueryOptions`/`consumeSession` (T6) are called with the same signatures in T7. `control.resolveIteration(decision: "continue" | "stop")` is defined in T7 and consumed identically in T8's route and the T8/steer/interrupt test literals. `RunView.pendingIteration: { iteration: number; projectedCostUsd: number } | null` (T9) matches the `gate-retry-projection` event fields (`iteration`, `projectedCostUsd`) emitted in T7 and the `IterationCheckpoint` props. Consistent.
