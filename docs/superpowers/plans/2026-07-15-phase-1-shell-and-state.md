# Phase 1 Implementation Plan - Shell and State (Agent Workbench)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Stand up the Agent Workbench app shell with `.forge/` state on disk, a grouped task sidebar, a prompt-first create box, and a deterministic simulator that drives a fake run stream end to end through an SSE route into a live Plan & Progress panel.

## Architecture

A Next.js App Router app is stateless about projects; all shared state lives in the target project's `.forge/` folder, addressed via the `FORGE_PROJECT_DIR` env var (the project picker arrives in a later phase).
A deterministic simulator emits a scripted `RunEvent` stream (the canonical transcript protocol from docs/blueprint/05-data-model.md) behind the same seam a real Agent SDK adapter will implement in Phase 2; an in-memory run manager buffers events, folds them into a derived `RunView` projection via a pure reducer, and serves them over SSE.
Server components read tickets from the forge store, and client components subscribe to the SSE stream and render the Plan & Progress panel from the reducer output.

## Tech Stack

- Next.js (App Router, `src/` dir) + React 19
- TypeScript strict
- Tailwind CSS v4
- pnpm, Node >= 20
- vitest (unit and integration tests, node environment)
- Playwright CLI (e2e smoke test)

## Global Constraints

- TypeScript strict mode; no `enum`, no `any`; string-literal unions via `as const` arrays; `import type` for type-only imports.
- Explicit return types on all exported functions.
- **Canonical domain model**: docs/blueprint/05-data-model.md is the single source of truth for type names and shapes; this phase implements the subset it needs, but every name and field it defines must match that document exactly so later phases extend rather than rename.
- pnpm only; Node >= 20.
- vitest for unit tests, node environment, tests colocated as `*.test.ts` next to the module under test.
- No em dashes anywhere in docs or code comments; use "-".
- Conventional commit messages; never add a `Co-Authored-By` line.
- Never `git add -A` or `git add .`; stage named files and directories explicitly.
- Phase 1 scope boundaries: project resolution is env-var based (`FORGE_PROJECT_DIR`) and the project picker UI is deferred; the "Needs Attention" sidebar group exists but stays empty until Phase 2 wires permission prompts and plan approvals into it; sidebar groups are computed in the UI from `TicketStatus` (plus `RunState` from Phase 2 on) and are never persisted; the domain word is "ticket" (persisted under `.forge/tickets/`) while the UI word is "task"; no real Agent SDK calls anywhere in this phase.

All paths below are relative to the app repo root: `/Users/mikulgohil/Developer/work/horizontal/active/agent-workbench`.

---

## Task 1: Scaffold the app with strict TypeScript, Tailwind v4, and vitest

**Files**

- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `src/app/*` (via `create-next-app`)
- Create: `vitest.config.ts`
- Create: `src/lib/version.ts`
- Test: `src/lib/version.test.ts`

**Interfaces**

- Consumes: nothing (first task).
- Produces:

```ts
export const APP_VERSION: string;
```

**Steps**

- [ ] Verify the toolchain: run `node --version` (must be >= 20) and `pnpm --version`.
- [ ] Scaffold into a temp subfolder because the repo root already contains `docs/`:

```bash
cd /Users/mikulgohil/Developer/work/horizontal/active/agent-workbench
pnpm dlx create-next-app@latest .scaffold --ts --app --tailwind --eslint --src-dir --use-pnpm --skip-install --yes
```

- [ ] Move the scaffold up to the repo root and remove the temp folder:

```bash
rsync -a .scaffold/ ./ && rm -rf .scaffold
```

- [ ] Install dependencies: `pnpm install`.
- [ ] Open `tsconfig.json` and confirm `"strict": true` and the `"@/*": ["./src/*"]` path alias are present (both are `create-next-app` defaults; add them if missing).
- [ ] Add vitest: `pnpm add -D vitest`.
- [ ] Edit `package.json` so the `scripts` block is exactly:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] Add an `engines` field to `package.json`:

```json
{
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] Write `vitest.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

// The domain layer is framework-free (pure functions over plain data plus
// node:fs against scratch dirs), so tests run in a plain node environment.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] Write the failing test `src/lib/version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "@/lib/version";

describe("APP_VERSION", () => {
  it("is a semver string, stamped onto audit events and run summaries later", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] Run `pnpm vitest run src/lib/version.test.ts` and confirm it fails: vitest cannot resolve the import `@/lib/version` because the module does not exist yet.
- [ ] Write the minimal implementation `src/lib/version.ts`:

```ts
/**
 * App version stamped onto audit events and run summaries, so output
 * differences between app versions stay diagnosable (spec: audit log).
 */
export const APP_VERSION = "0.1.0";
```

- [ ] Run `pnpm vitest run src/lib/version.test.ts` again and confirm 1 test passes.
- [ ] Run `pnpm typecheck` and `pnpm lint` and confirm both exit 0.
- [ ] Commit:

```bash
git add package.json pnpm-lock.yaml tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs next-env.d.ts .gitignore README.md public src vitest.config.ts
git commit -m "chore: scaffold next.js app shell with strict typescript and vitest"
```

---

## Task 2: Canonical domain types (subset of 05-data-model.md) and id helpers

`src/lib/forge/types.ts` is the Phase 1 subset of the canonical model in docs/blueprint/05-data-model.md, copied name-for-name and field-for-field.
It includes the full canonical `RunEvent` union (all 16 variants) even though the Phase 1 simulator only emits some of them, so the SSE protocol never changes shape later.
The only non-canonical additions are small helpers (`isTicketType`, `isTerminalState`, `isTerminalEvent`, `RUN_EVENT_KINDS`); derived UI projections like `RunView` live in later tasks, never in this file.

**Files**

- Create: `src/lib/forge/types.ts`
- Create: `src/lib/forge/ids.ts`
- Test: `src/lib/forge/types.test.ts`
- Test: `src/lib/forge/ids.test.ts`

**Interfaces**

- Consumes: docs/blueprint/05-data-model.md (canonical shapes).
- Produces (full code below; canonical highlights):

```ts
export type TicketType = "figma-to-component" | "bug-fix" | "improvement" | "generic";
export type TicketStatus = "backlog" | "running" | "review" | "done" | "rejected" | "failed";
export interface Ticket { /* canonical: id, type, title, status, jiraRef, inputs, attachments, checklist, gates, planThenApprove, currentRunId, branchName, createdBy (git-identity string), createdAt, updatedAt, source */ }
export interface ForgeConfig { formatVersion: number; packageManager: PackageManager; baseBranch: string; concurrencyCap: number; scripts: ForgeConfigScripts; bashAllowlist: string[]; denyReadGlobs: string[]; }
export interface Gate { name: GateName; basis: GateBasis; status: GateStatus; score: number; explanation: string; durationMs: number; }
export interface CostRecord { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number; }
export type RunState = "queued" | "preparing" | "planning" | "awaiting-plan-approval" | "executing" | "awaiting-permission" | "gates-running" | "awaiting-iteration-approval" | "awaiting-approval" | "completed" | "rejected" | "interrupted" | "failed";
export interface Run { id: string; ticketId: string; state: RunState; sessionId: string | null; worktreePath: string | null; iteration: number; approval: ApprovalDecision | null; startedAt: string; endedAt: string | null; }
export interface TodoItem { content: string; activeForm: string; status: TodoStatus; }
export type RunEvent = RunEventBase & ({ kind: "run-started"; sessionId: string; worktreePath: string | null; branchName: string | null } | /* ...all 16 canonical variants, full code below */ { kind: "error"; message: string; recoverable: boolean });
export function isTicketType(value: string): value is TicketType;
export function isTerminalState(state: RunState): boolean;
export function isTerminalEvent(event: RunEvent): boolean;
export function newId(prefix: string): string;
export function nowIso(): string;
```

**Steps**

- [ ] Write the failing test `src/lib/forge/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  RUN_EVENT_KINDS,
  RUN_STATES,
  TICKET_STATUSES,
  isTerminalEvent,
  isTerminalState,
  isTicketType,
  type RunEvent,
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
```

- [ ] Run `pnpm vitest run src/lib/forge/types.test.ts` and confirm it fails: vitest cannot resolve the import `./types`.
- [ ] Write the implementation `src/lib/forge/types.ts`:

```ts
/**
 * Core domain model for Agent Workbench - Phase 1 subset.
 *
 * CANONICAL SOURCE: docs/blueprint/05-data-model.md.
 * Every name and field here matches that document exactly; later phases
 * extend this file with the remaining canonical types (RunSummary,
 * AuditEvent, Lesson, TaskTemplate, ...) instead of renaming anything.
 *
 * Design notes:
 * - String-literal unions (not enums) keep every type JSON-serializable.
 * - Discriminated unions (RunEvent) are keyed by `kind`.
 * - All timestamps are ISO strings, never Date.
 * - Identity fields are the git-identity string, never a structured object.
 */

/* ------------------------------------------------------------------ */
/* .forge/config.json                                                  */
/* ------------------------------------------------------------------ */

export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export interface ForgeConfigScripts {
  typecheck: string;
  lint: string;
  test: string;
  storybook: string;
}

export interface ForgeConfig {
  formatVersion: number;
  packageManager: PackageManager;
  baseBranch: string;
  concurrencyCap: number;
  scripts: ForgeConfigScripts;
  bashAllowlist: string[];
  denyReadGlobs: string[];
}

/* ------------------------------------------------------------------ */
/* Tickets                                                             */
/* ------------------------------------------------------------------ */

export const TICKET_TYPES = [
  "figma-to-component",
  "bug-fix",
  "improvement",
  "generic",
] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export function isTicketType(value: string): value is TicketType {
  return (TICKET_TYPES as readonly string[]).includes(value);
}

export const GATE_NAMES = [
  "typecheck",
  "lint",
  "test",
  "accessibility",
  "security",
  "maintainability",
] as const;
export type GateName = (typeof GATE_NAMES)[number];

export const CHECKLIST_ITEM_ORIGINS = ["command", "manual"] as const;
export type ChecklistItemOrigin = (typeof CHECKLIST_ITEM_ORIGINS)[number];

export interface ChecklistItem {
  id: string;
  label: string;
  origin: ChecklistItemOrigin;
  gate: GateName | null;
  checked: boolean;
  checkedBy: string | null;
  checkedAt: string | null;
  note: string | null;
}

export const TICKET_STATUSES = [
  "backlog",
  "running",
  "review",
  "done",
  "rejected",
  "failed",
] as const;
/**
 * The only persisted lifecycle field on a ticket. Sidebar groups
 * (Needs Attention / Running / Review / Idle) are computed in the UI from
 * this field plus the current run's RunState - never persisted.
 */
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_SOURCES = ["manual", "chat", "file-explorer"] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];

export const ATTACHMENT_KINDS = [
  "figma-screenshot",
  "figma-variables",
  "figma-component-structure",
  "upload",
] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export interface Attachment {
  fileName: string;
  kind: AttachmentKind;
  addedAt: string;
}

export interface Ticket {
  id: string;
  type: TicketType;
  title: string;
  status: TicketStatus;
  jiraRef: string | null;
  /** Keyed by the owning template's requiredInputs[].key; prompt-first creation stores the prompt under "prompt". */
  inputs: Record<string, string>;
  attachments: Attachment[];
  checklist: ChecklistItem[];
  gates: GateName[];
  planThenApprove: boolean;
  currentRunId: string | null;
  branchName: string | null;
  /** Git identity string, e.g. "Jane Dev <jane@example.com>". */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  source: TicketSource;
}

/* ------------------------------------------------------------------ */
/* Quality gates                                                       */
/* ------------------------------------------------------------------ */

export const GATE_BASES = ["command", "heuristic"] as const;
export type GateBasis = (typeof GATE_BASES)[number];

export const GATE_STATUSES = ["passed", "warning", "failed"] as const;
export type GateStatus = (typeof GATE_STATUSES)[number];

export interface Gate {
  name: GateName;
  basis: GateBasis;
  status: GateStatus;
  /** 0-100. */
  score: number;
  explanation: string;
  durationMs: number;
}

/* ------------------------------------------------------------------ */
/* Cost                                                                */
/* ------------------------------------------------------------------ */

export interface CostRecord {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

export const RUN_STATES = [
  "queued",
  "preparing",
  "planning",
  "awaiting-plan-approval",
  "executing",
  "awaiting-permission",
  "gates-running",
  "awaiting-iteration-approval",
  "awaiting-approval",
  "completed",
  "rejected",
  "interrupted",
  "failed",
] as const;
export type RunState = (typeof RUN_STATES)[number];

const TERMINAL_RUN_STATES: readonly RunState[] = [
  "completed",
  "rejected",
  "interrupted",
  "failed",
];

export function isTerminalState(state: RunState): boolean {
  return TERMINAL_RUN_STATES.includes(state);
}

export interface ApprovalDecision {
  decidedBy: string;
  approved: boolean;
  note: string;
  decidedAt: string;
}

/**
 * The live, in-memory shape of a run (canonical). Phase 1 keeps it in the
 * run manager only; Phase 2 reconstructs it from the local run transcript
 * for resume.
 */
export interface Run {
  id: string;
  ticketId: string;
  state: RunState;
  sessionId: string | null;
  worktreePath: string | null;
  iteration: number;
  approval: ApprovalDecision | null;
  startedAt: string;
  endedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* Run events - the full local transcript protocol                     */
/* ------------------------------------------------------------------ */

export const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface TodoItem {
  content: string;
  activeForm: string;
  status: TodoStatus;
}

export const PLAN_DECISIONS = ["approved", "changes-requested"] as const;
export type PlanDecision = (typeof PLAN_DECISIONS)[number];

export const PERMISSION_DECISIONS = ["approved", "denied"] as const;
export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number];

export const BASH_COMMAND_SOURCES = ["allowlisted", "approved"] as const;
export type BashCommandSource = (typeof BASH_COMMAND_SOURCES)[number];

export interface RunEventBase {
  /** Monotonic sequence number within this run's transcript, for ordering and SSE resume. */
  seq: number;
  at: string;
}

/** Helper (not in the canonical doc): the SSE route and client listen per kind. */
export const RUN_EVENT_KINDS = [
  "run-started",
  "plan-proposed",
  "plan-decision",
  "todo-update",
  "message",
  "steer-message",
  "tool-use",
  "tool-result",
  "permission-request",
  "permission-decision",
  "bash-command",
  "gate-result",
  "gate-retry-projection",
  "cost-update",
  "phase-change",
  "error",
] as const;
export type RunEventKind = (typeof RUN_EVENT_KINDS)[number];

export type RunEvent = RunEventBase &
  (
    | {
        kind: "run-started";
        sessionId: string;
        worktreePath: string | null;
        branchName: string | null;
      }
    | { kind: "plan-proposed"; planMarkdown: string }
    | { kind: "plan-decision"; decision: PlanDecision; note: string }
    | { kind: "todo-update"; todos: TodoItem[] }
    | { kind: "message"; text: string }
    | { kind: "steer-message"; text: string; from: string }
    | {
        kind: "tool-use";
        toolUseId: string;
        toolName: string;
        input: Record<string, unknown>;
      }
    | { kind: "tool-result"; toolUseId: string; output: string; isError: boolean }
    | { kind: "permission-request"; requestId: string; command: string }
    | { kind: "permission-decision"; requestId: string; decision: PermissionDecision }
    | {
        kind: "bash-command";
        command: string;
        source: BashCommandSource;
        exitCode: number;
        durationMs: number;
      }
    | { kind: "gate-result"; gate: Gate }
    | { kind: "gate-retry-projection"; iteration: number; projectedCostUsd: number }
    | { kind: "cost-update"; cumulative: CostRecord }
    | { kind: "phase-change"; from: RunState; to: RunState }
    | { kind: "error"; message: string; recoverable: boolean }
  );

/** A run ends when a phase-change lands in one of the four terminal states. */
export function isTerminalEvent(event: RunEvent): boolean {
  return event.kind === "phase-change" && isTerminalState(event.to);
}
```

- [ ] Run `pnpm vitest run src/lib/forge/types.test.ts` again and confirm 5 tests pass.
- [ ] Write the failing test `src/lib/forge/ids.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { newId, nowIso } from "./ids";

describe("ids", () => {
  it("prefixes ids and keeps them unique", () => {
    const a = newId("tkt");
    const b = newId("tkt");
    expect(a).toMatch(/^tkt-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });

  it("returns ISO-8601 timestamps", () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
```

- [ ] Run `pnpm vitest run src/lib/forge/ids.test.ts` and confirm it fails: vitest cannot resolve the import `./ids`.
- [ ] Write the implementation `src/lib/forge/ids.ts`:

```ts
import { randomUUID } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
```

- [ ] Run `pnpm vitest run src/lib/forge/ids.test.ts` again and confirm 2 tests pass.
- [ ] Run `pnpm typecheck` and confirm it exits 0.
- [ ] Commit:

```bash
git add src/lib/forge/types.ts src/lib/forge/types.test.ts src/lib/forge/ids.ts src/lib/forge/ids.test.ts
git commit -m "feat: add canonical domain types and id helpers"
```

---

## Task 3: JSONL append and read utility

**Files**

- Create: `src/lib/forge/jsonl.ts`
- Create: `src/test/helpers.ts`
- Test: `src/lib/forge/jsonl.test.ts`

**Interfaces**

- Consumes: nothing.
- Produces:

```ts
export function appendJsonl(filePath: string, record: unknown): Promise<void>;
export function readJsonl<T>(filePath: string): Promise<T[]>;
// test helper
export function makeScratchDir(): Promise<{ dir: string; cleanup: () => Promise<void> }>;
```

**Steps**

- [ ] Write the shared scratch-dir test helper `src/test/helpers.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Creates an isolated scratch directory per test and a cleanup function.
 * Every fs-touching test in this repo runs against one of these, never
 * against the app repo or a real project.
 */
export async function makeScratchDir(): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "forge-test-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
```

- [ ] Write the failing test `src/lib/forge/jsonl.test.ts`:

```ts
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeScratchDir } from "@/test/helpers";
import { appendJsonl, readJsonl } from "./jsonl";

interface Entry {
  n: number;
  label: string;
}

describe("jsonl", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await makeScratchDir());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns [] for a missing file", async () => {
    expect(await readJsonl<Entry>(join(dir, "missing.jsonl"))).toEqual([]);
  });

  it("appends records one per line and reads them back in order", async () => {
    const file = join(dir, "nested", "log.jsonl");
    await appendJsonl(file, { n: 1, label: "first" });
    await appendJsonl(file, { n: 2, label: "second" });
    expect(await readJsonl<Entry>(file)).toEqual([
      { n: 1, label: "first" },
      { n: 2, label: "second" },
    ]);
  });

  it("ignores blank lines when reading", async () => {
    const file = join(dir, "log.jsonl");
    await appendJsonl(file, { n: 1, label: "only" });
    const { appendFile } = await import("node:fs/promises");
    await appendFile(file, "\n\n", "utf8");
    expect(await readJsonl<Entry>(file)).toEqual([{ n: 1, label: "only" }]);
  });
});
```

- [ ] Run `pnpm vitest run src/lib/forge/jsonl.test.ts` and confirm it fails: vitest cannot resolve the import `./jsonl`.
- [ ] Write the implementation `src/lib/forge/jsonl.ts`:

```ts
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Append-only JSONL, chosen deliberately: appends minimize git merge
 * conflicts when two developers touch the same ticket (spec: .forge layout).
 */
export async function appendJsonl(filePath: string, record: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

export async function readJsonl<T>(filePath: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}
```

- [ ] Run `pnpm vitest run src/lib/forge/jsonl.test.ts` again and confirm 3 tests pass.
- [ ] Commit:

```bash
git add src/lib/forge/jsonl.ts src/lib/forge/jsonl.test.ts src/test/helpers.ts
git commit -m "feat: add jsonl append and read utility"
```

---

## Task 4: Forge store - init and config

**Files**

- Create: `src/lib/forge/store.ts`
- Test: `src/lib/forge/store.test.ts`

**Interfaces**

- Consumes: `ForgeConfig` from `@/lib/forge/types`.
- Produces:

```ts
export const DEFAULT_FORGE_CONFIG: ForgeConfig;
export function forgeDir(projectDir: string): string;
export function initForge(projectDir: string): Promise<void>;
export function readForgeConfig(projectDir: string): Promise<ForgeConfig>;
```

**Steps**

- [ ] Write the failing test `src/lib/forge/store.test.ts`:

```ts
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeScratchDir } from "@/test/helpers";
import { DEFAULT_FORGE_CONFIG, forgeDir, initForge, readForgeConfig } from "./store";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("forge store: init and config", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await makeScratchDir());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("creates the .forge skeleton with a gitignored local folder", async () => {
    await initForge(dir);
    const root = forgeDir(dir);
    for (const sub of ["tickets", "knowledge", "audit", "templates", "local/runs", "local/notes"]) {
      expect(await exists(join(root, sub))).toBe(true);
    }
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe("local/\n");
  });

  it("writes default config on first init and leaves an existing one alone", async () => {
    await initForge(dir);
    const configPath = join(forgeDir(dir), "config.json");
    const written = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    expect(written).toEqual(DEFAULT_FORGE_CONFIG);

    const { writeFile } = await import("node:fs/promises");
    await writeFile(configPath, JSON.stringify({ baseBranch: "develop" }), "utf8");
    await initForge(dir);
    const kept = JSON.parse(await readFile(configPath, "utf8")) as { baseBranch: string };
    expect(kept.baseBranch).toBe("develop");
  });

  it("merges a partial config file over the defaults when reading", async () => {
    await initForge(dir);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(forgeDir(dir), "config.json"),
      JSON.stringify({ baseBranch: "develop", scripts: { test: "test:unit" } }),
      "utf8",
    );
    const config = await readForgeConfig(dir);
    expect(config.baseBranch).toBe("develop");
    expect(config.scripts.test).toBe("test:unit");
    expect(config.scripts.typecheck).toBe(DEFAULT_FORGE_CONFIG.scripts.typecheck);
    expect(config.concurrencyCap).toBe(DEFAULT_FORGE_CONFIG.concurrencyCap);
    expect(config.formatVersion).toBe(DEFAULT_FORGE_CONFIG.formatVersion);
  });

  it("returns pure defaults when no .forge exists", async () => {
    expect(await readForgeConfig(dir)).toEqual(DEFAULT_FORGE_CONFIG);
  });
});
```

- [ ] Run `pnpm vitest run src/lib/forge/store.test.ts` and confirm it fails: vitest cannot resolve the import `./store`.
- [ ] Write the implementation `src/lib/forge/store.ts`:

```ts
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ForgeConfig } from "./types";

export const DEFAULT_FORGE_CONFIG: ForgeConfig = {
  formatVersion: 1,
  packageManager: "pnpm",
  baseBranch: "main",
  concurrencyCap: 3,
  scripts: {
    typecheck: "typecheck",
    lint: "lint",
    test: "test",
    storybook: "storybook",
  },
  bashAllowlist: ["pnpm install", "pnpm run *"],
  denyReadGlobs: [".env*", "*.pem", "*secret*"],
};

export function forgeDir(projectDir: string): string {
  return join(projectDir, ".forge");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Idempotent: safe to call on every app start and on every ticket creation.
 * The app (not the developer) writes the .gitignore entry that keeps
 * .forge/local/ out of git (spec: .forge layout).
 */
export async function initForge(projectDir: string): Promise<void> {
  const root = forgeDir(projectDir);
  const subdirs = [
    "tickets",
    "knowledge",
    "audit",
    "templates",
    join("local", "runs"),
    join("local", "notes"),
  ];
  for (const sub of subdirs) {
    await mkdir(join(root, sub), { recursive: true });
  }
  const configPath = join(root, "config.json");
  if (!(await exists(configPath))) {
    await writeFile(configPath, `${JSON.stringify(DEFAULT_FORGE_CONFIG, null, 2)}\n`, "utf8");
  }
  await writeFile(join(root, ".gitignore"), "local/\n", "utf8");
}

export async function readForgeConfig(projectDir: string): Promise<ForgeConfig> {
  const configPath = join(forgeDir(projectDir), "config.json");
  if (!(await exists(configPath))) return DEFAULT_FORGE_CONFIG;
  const parsed = JSON.parse(await readFile(configPath, "utf8")) as Partial<ForgeConfig>;
  return {
    ...DEFAULT_FORGE_CONFIG,
    ...parsed,
    scripts: { ...DEFAULT_FORGE_CONFIG.scripts, ...(parsed.scripts ?? {}) },
  };
}
```

- [ ] Run `pnpm vitest run src/lib/forge/store.test.ts` again and confirm 4 tests pass.
- [ ] Commit:

```bash
git add src/lib/forge/store.ts src/lib/forge/store.test.ts
git commit -m "feat: add forge store init and config read"
```

---

## Task 5: Forge store - ticket create, read, list, and status update

**Files**

- Modify: `src/lib/forge/store.ts`
- Test: `src/lib/forge/store.test.ts` (append a new describe block)

**Interfaces**

- Consumes: `Ticket`, `TicketStatus`, `TicketType`, `TicketSource` from `@/lib/forge/types`; `newId`, `nowIso` from `@/lib/forge/ids`.
- Produces:

```ts
/** Write-input for createTicket; an internal supporting shape, not part of the canonical model. */
export interface TicketDraft {
  type: TicketType;
  title: string;
  inputs: Record<string, string>;
  jiraRef: string | null;
  source: TicketSource;
}
export function createTicket(projectDir: string, draft: TicketDraft, createdBy: string): Promise<Ticket>;
export function readTicket(projectDir: string, ticketId: string): Promise<Ticket | null>;
export function listTickets(projectDir: string): Promise<Ticket[]>;
export function setTicketStatus(projectDir: string, ticketId: string, status: TicketStatus): Promise<Ticket>;
```

**Steps**

- [ ] Append the failing describe block to `src/lib/forge/store.test.ts`:

```ts
import { createTicket, listTickets, readTicket, setTicketStatus } from "./store";
import type { TicketDraft } from "./store";

const DEV = "Test Dev <dev@example.com>";

function draft(title: string): TicketDraft {
  return {
    type: "generic",
    title,
    inputs: { prompt: `${title} prompt` },
    jiraRef: null,
    source: "manual",
  };
}

describe("forge store: tickets", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await makeScratchDir());
    await initForge(dir);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("creates a canonical ticket in backlog and reads it back", async () => {
    const ticket = await createTicket(dir, draft("Add button"), DEV);
    expect(ticket.id).toMatch(/^tkt-/);
    expect(ticket.status).toBe("backlog");
    expect(ticket.createdBy).toBe(DEV);
    expect(ticket.inputs.prompt).toBe("Add button prompt");
    expect(ticket.source).toBe("manual");
    expect(ticket.currentRunId).toBeNull();
    expect(ticket.branchName).toBeNull();
    expect(ticket.attachments).toEqual([]);
    expect(ticket.checklist).toEqual([]);
    expect(await readTicket(dir, ticket.id)).toEqual(ticket);
  });

  it("returns null for an unknown ticket", async () => {
    expect(await readTicket(dir, "tkt-nope")).toBeNull();
  });

  it("lists tickets newest first", async () => {
    const a = await createTicket(dir, draft("First"), DEV);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = await createTicket(dir, draft("Second"), DEV);
    const titles = (await listTickets(dir)).map((t) => t.title);
    expect(titles).toEqual(["Second", "First"]);
    expect(a.createdAt <= b.createdAt).toBe(true);
  });

  it("updates status and bumps updatedAt", async () => {
    const ticket = await createTicket(dir, draft("Move me"), DEV);
    const updated = await setTicketStatus(dir, ticket.id, "running");
    expect(updated.status).toBe("running");
    expect(updated.updatedAt >= ticket.updatedAt).toBe(true);
    expect((await readTicket(dir, ticket.id))?.status).toBe("running");
  });

  it("throws when updating an unknown ticket", async () => {
    await expect(setTicketStatus(dir, "tkt-nope", "done")).rejects.toThrow(/tkt-nope/);
  });
});
```

- [ ] Run `pnpm vitest run src/lib/forge/store.test.ts` and confirm the new block fails: `createTicket` and friends are not exported from `./store`.
- [ ] Append the implementation to `src/lib/forge/store.ts` (plus the two new imports at the top of the file):

```ts
import { readdir } from "node:fs/promises";
import { newId, nowIso } from "./ids";
import type { Ticket, TicketSource, TicketStatus, TicketType } from "./types";

/** Write-input for createTicket; an internal supporting shape, not part of the canonical model. */
export interface TicketDraft {
  type: TicketType;
  title: string;
  inputs: Record<string, string>;
  jiraRef: string | null;
  source: TicketSource;
}

function ticketPath(projectDir: string, ticketId: string): string {
  return join(forgeDir(projectDir), "tickets", ticketId, "ticket.json");
}

async function writeTicket(projectDir: string, ticket: Ticket): Promise<void> {
  await mkdir(join(forgeDir(projectDir), "tickets", ticket.id), { recursive: true });
  await writeFile(ticketPath(projectDir, ticket.id), `${JSON.stringify(ticket, null, 2)}\n`, "utf8");
}

export async function createTicket(
  projectDir: string,
  draft: TicketDraft,
  createdBy: string,
): Promise<Ticket> {
  const now = nowIso();
  const ticket: Ticket = {
    id: newId("tkt"),
    type: draft.type,
    title: draft.title,
    status: "backlog",
    jiraRef: draft.jiraRef,
    inputs: draft.inputs,
    // Template snapshots (checklist, gates, planThenApprove) stay empty
    // until templates land in a later phase; the fields exist now so
    // ticket.json is forward-compatible with the canonical model.
    attachments: [],
    checklist: [],
    gates: [],
    planThenApprove: false,
    // Maintained by the run manager from Phase 2 (resume support).
    currentRunId: null,
    branchName: null,
    createdBy,
    createdAt: now,
    updatedAt: now,
    source: draft.source,
  };
  await writeTicket(projectDir, ticket);
  return ticket;
}

export async function readTicket(projectDir: string, ticketId: string): Promise<Ticket | null> {
  const path = ticketPath(projectDir, ticketId);
  if (!(await exists(path))) return null;
  return JSON.parse(await readFile(path, "utf8")) as Ticket;
}

export async function listTickets(projectDir: string): Promise<Ticket[]> {
  const dir = join(forgeDir(projectDir), "tickets");
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const tickets: Ticket[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const ticket = await readTicket(projectDir, entry.name);
    if (ticket) tickets.push(ticket);
  }
  return tickets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function setTicketStatus(
  projectDir: string,
  ticketId: string,
  status: TicketStatus,
): Promise<Ticket> {
  const ticket = await readTicket(projectDir, ticketId);
  if (!ticket) throw new Error(`ticket not found: ${ticketId}`);
  const updated: Ticket = { ...ticket, status, updatedAt: nowIso() };
  await writeTicket(projectDir, updated);
  return updated;
}
```

- [ ] Consolidate the imports at the top of `store.ts` into single `node:fs/promises` and `./types` import statements so lint passes.
- [ ] Run `pnpm vitest run src/lib/forge/store.test.ts` again and confirm all 9 tests pass.
- [ ] Run `pnpm typecheck` and confirm it exits 0.
- [ ] Commit:

```bash
git add src/lib/forge/store.ts src/lib/forge/store.test.ts
git commit -m "feat: add ticket create, read, list, and status update to forge store"
```

---

## Task 6: Deterministic run simulator

**Files**

- Create: `src/lib/sim/simulator.ts`
- Test: `src/lib/sim/simulator.test.ts`

**Interfaces**

- Consumes: `CostRecord`, `Gate`, `RunEvent`, `RunEventBase`, `TodoItem` from `@/lib/forge/types`.
- Produces:

```ts
export interface SimulatorOptions {
  runId: string;
  delayMs?: number;
}
export const SIMULATED_TODOS: ReadonlyArray<Pick<TodoItem, "content" | "activeForm">>;
export function simulateRun(options: SimulatorOptions): AsyncGenerator<RunEvent>;
export function collectRunEvents(options: SimulatorOptions): Promise<RunEvent[]>;
```

**Steps**

- [ ] Write the failing test `src/lib/sim/simulator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SIMULATED_TODOS, collectRunEvents } from "./simulator";

const OPTS = { runId: "run-fixed" } as const;

describe("simulateRun", () => {
  it("starts with run-started and ends with a terminal phase-change", async () => {
    const events = await collectRunEvents(OPTS);
    expect(events[0]).toMatchObject({
      kind: "run-started",
      seq: 1,
      sessionId: "sim-session-run-fixed",
      worktreePath: null,
      branchName: null,
    });
    expect(events.at(-1)).toMatchObject({
      kind: "phase-change",
      seq: events.length,
      from: "gates-running",
      to: "completed",
    });
  });

  it("proposes the full todo list, all pending, before any todo goes in_progress", async () => {
    const events = await collectRunEvents(OPTS);
    const updates = events.flatMap((e) => (e.kind === "todo-update" ? [e.todos] : []));
    expect(updates[0].every((todo) => todo.status === "pending")).toBe(true);
    expect(updates[0].map((todo) => todo.content)).toEqual(SIMULATED_TODOS.map((t) => t.content));
  });

  it("moves every todo through in_progress exactly once and ends with all completed", async () => {
    const events = await collectRunEvents(OPTS);
    const updates = events.flatMap((e) => (e.kind === "todo-update" ? [e.todos] : []));
    for (let i = 0; i < SIMULATED_TODOS.length; i++) {
      const inProgressCount = updates.filter((todos) => todos[i].status === "in_progress").length;
      expect(inProgressCount).toBe(1);
    }
    expect(updates.at(-1)?.every((todo) => todo.status === "completed")).toBe(true);
  });

  it("emits strictly increasing seq numbers and is deterministic", async () => {
    const a = await collectRunEvents(OPTS);
    const b = await collectRunEvents(OPTS);
    a.forEach((event, i) => expect(event.seq).toBe(i + 1));
    expect(a).toEqual(b);
  });

  it("emits a passing command-basis result for each phase-1 gate", async () => {
    const events = await collectRunEvents(OPTS);
    const gates = events.flatMap((e) => (e.kind === "gate-result" ? [e.gate] : []));
    expect(gates.map((g) => g.name)).toEqual(["typecheck", "lint", "test"]);
    expect(gates.every((g) => g.basis === "command" && g.status === "passed")).toBe(true);
  });

  it("reports monotonically increasing cumulative cost", async () => {
    const events = await collectRunEvents(OPTS);
    const costs = events.flatMap((e) => (e.kind === "cost-update" ? [e.cumulative.costUsd] : []));
    expect(costs).toHaveLength(SIMULATED_TODOS.length);
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i]).toBeGreaterThan(costs[i - 1]);
    }
  });
});
```

- [ ] Run `pnpm vitest run src/lib/sim/simulator.test.ts` and confirm it fails: vitest cannot resolve the import `./simulator`.
- [ ] Write the implementation `src/lib/sim/simulator.ts`:

```ts
import type { CostRecord, Gate, RunEvent, RunEventBase, TodoItem } from "@/lib/forge/types";

/**
 * The deterministic simulator seam, ported from the Forge reference app.
 *
 * It emits the exact canonical RunEvent protocol (docs/blueprint/
 * 05-data-model.md) that the real Agent SDK adapter will emit in Phase 2,
 * so the reducer, SSE route, Plan & Progress panel, and Playwright e2e all
 * run offline, token-free, and repeatably. With delayMs = 0 the whole
 * script runs instantly (tests); with a positive delay it is paced for
 * watchability (dev server and e2e). Timestamps derive from a fixed epoch
 * plus seq, so two runs of the same script are byte-identical.
 */
export interface SimulatorOptions {
  runId: string;
  delayMs?: number;
}

export const SIMULATED_TODOS: ReadonlyArray<Pick<TodoItem, "content" | "activeForm">> = [
  {
    content: "Read ticket context and .forge knowledge",
    activeForm: "Reading ticket context and .forge knowledge",
  },
  {
    content: "Locate target files and existing patterns",
    activeForm: "Locating target files and existing patterns",
  },
  { content: "Implement the change", activeForm: "Implementing the change" },
  { content: "Add a Storybook story", activeForm: "Adding a Storybook story" },
  { content: "Run quality gates", activeForm: "Running quality gates" },
];

const STEP_TOOLS: ReadonlyArray<ReadonlyArray<{ toolName: string; input: Record<string, unknown> }>> = [
  [
    { toolName: "Read", input: { file_path: ".forge/knowledge/project.md" } },
    { toolName: "Read", input: { file_path: ".forge/knowledge/lessons.md" } },
  ],
  [
    { toolName: "Grep", input: { pattern: "Button", path: "src/components" } },
    { toolName: "Read", input: { file_path: "src/components/ui/input.tsx" } },
  ],
  [
    { toolName: "Write", input: { file_path: "src/components/ui/button.tsx" } },
    { toolName: "Edit", input: { file_path: "src/components/ui/index.ts" } },
  ],
  [{ toolName: "Write", input: { file_path: "src/components/ui/button.stories.tsx" } }],
  [
    { toolName: "Bash", input: { command: "pnpm run typecheck" } },
    { toolName: "Bash", input: { command: "pnpm run lint" } },
    { toolName: "Bash", input: { command: "pnpm run test" } },
  ],
];

const SIMULATED_GATES: Gate[] = [
  {
    name: "typecheck",
    basis: "command",
    status: "passed",
    score: 100,
    explanation: "tsc --noEmit exited 0",
    durationMs: 4200,
  },
  {
    name: "lint",
    basis: "command",
    status: "passed",
    score: 100,
    explanation: "eslint exited 0",
    durationMs: 2100,
  },
  {
    name: "test",
    basis: "command",
    status: "passed",
    score: 100,
    explanation: "12 tests passed",
    durationMs: 6300,
  },
];

/** Fixed epoch so `at` timestamps are deterministic across runs. */
const SIM_EPOCH_MS = Date.parse("2026-01-01T00:00:00.000Z");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function todoSnapshot(completedCount: number, inProgressIndex: number | null): TodoItem[] {
  return SIMULATED_TODOS.map((todo, index) => ({
    content: todo.content,
    activeForm: todo.activeForm,
    status:
      index < completedCount ? "completed" : index === inProgressIndex ? "in_progress" : "pending",
  }));
}

export async function* simulateRun(options: SimulatorOptions): AsyncGenerator<RunEvent> {
  const delayMs = options.delayMs ?? 0;
  let seq = 0;
  const cumulative: CostRecord = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
  const stamp = (): RunEventBase => {
    seq += 1;
    return { seq, at: new Date(SIM_EPOCH_MS + seq * 1000).toISOString() };
  };
  const pace = async (): Promise<void> => {
    if (delayMs > 0) await sleep(delayMs);
  };

  yield {
    ...stamp(),
    kind: "run-started",
    sessionId: `sim-session-${options.runId}`,
    worktreePath: null,
    branchName: null,
  };
  await pace();
  yield { ...stamp(), kind: "phase-change", from: "preparing", to: "planning" };
  await pace();
  yield { ...stamp(), kind: "message", text: "Planning the work for this ticket." };
  await pace();
  yield { ...stamp(), kind: "todo-update", todos: todoSnapshot(0, null) };
  await pace();
  yield { ...stamp(), kind: "phase-change", from: "planning", to: "executing" };

  for (let index = 0; index < SIMULATED_TODOS.length; index++) {
    const isGateStep = index === SIMULATED_TODOS.length - 1;
    await pace();
    yield { ...stamp(), kind: "todo-update", todos: todoSnapshot(index, index) };
    await pace();
    yield { ...stamp(), kind: "message", text: `${SIMULATED_TODOS[index].activeForm}.` };
    for (const [toolIndex, use] of STEP_TOOLS[index].entries()) {
      await pace();
      yield {
        ...stamp(),
        kind: "tool-use",
        toolUseId: `tu-${index + 1}-${toolIndex + 1}`,
        toolName: use.toolName,
        input: use.input,
      };
    }
    if (isGateStep) {
      await pace();
      yield { ...stamp(), kind: "phase-change", from: "executing", to: "gates-running" };
      for (const gate of SIMULATED_GATES) {
        await pace();
        yield { ...stamp(), kind: "gate-result", gate };
      }
    }
    cumulative.inputTokens += 900;
    cumulative.outputTokens += 350;
    cumulative.costUsd =
      Math.round((cumulative.inputTokens * 0.000003 + cumulative.outputTokens * 0.000015) * 1e6) /
      1e6;
    await pace();
    yield { ...stamp(), kind: "cost-update", cumulative: { ...cumulative } };
    await pace();
    yield { ...stamp(), kind: "todo-update", todos: todoSnapshot(index + 1, null) };
  }

  await pace();
  yield { ...stamp(), kind: "phase-change", from: "gates-running", to: "completed" };
}

export async function collectRunEvents(options: SimulatorOptions): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const event of simulateRun(options)) events.push(event);
  return events;
}
```

- [ ] Run `pnpm vitest run src/lib/sim/simulator.test.ts` again and confirm 6 tests pass.
- [ ] Commit:

```bash
git add src/lib/sim/simulator.ts src/lib/sim/simulator.test.ts
git commit -m "feat: add deterministic run simulator emitting the canonical event protocol"
```

---

## Task 7: RunView reducer

**Files**

- Create: `src/lib/run/reducer.ts`
- Test: `src/lib/run/reducer.test.ts`

**Interfaces**

- Consumes: `CostRecord`, `Gate`, `RunEvent`, `RunState`, `TodoItem` from `@/lib/forge/types`; `collectRunEvents`, `SIMULATED_TODOS` from `@/lib/sim/simulator` (tests only).
- Produces:

```ts
/** Derived UI projection, NOT part of the canonical model; derives from Run + its transcript. */
export interface RunView {
  runId: string;
  state: RunState;
  todos: TodoItem[];
  gates: Gate[];
  cost: CostRecord;
  lastMessage: string;
}
export const ZERO_COST: CostRecord;
export function initialRunView(runId: string): RunView;
export function reduceRun(view: RunView, event: RunEvent): RunView;
```

**Steps**

- [ ] Write the failing test `src/lib/run/reducer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RunEvent } from "@/lib/forge/types";
import { SIMULATED_TODOS, collectRunEvents } from "@/lib/sim/simulator";
import { initialRunView, reduceRun, type RunView } from "./reducer";

const OPTS = { runId: "run-fixed" } as const;

function fold(events: RunEvent[]): RunView {
  return events.reduce(reduceRun, initialRunView("run-fixed"));
}

describe("reduceRun", () => {
  it("folds a full simulated run into a completed view", async () => {
    const view = fold(await collectRunEvents(OPTS));
    expect(view.state).toBe("completed");
    expect(view.runId).toBe("run-fixed");
    expect(view.todos).toHaveLength(SIMULATED_TODOS.length);
    expect(view.todos.every((todo) => todo.status === "completed")).toBe(true);
    expect(view.gates).toHaveLength(3);
    expect(view.cost.costUsd).toBeGreaterThan(0);
    expect(view.lastMessage.length).toBeGreaterThan(0);
  });

  it("tracks the in_progress todo mid-run", async () => {
    const events = await collectRunEvents(OPTS);
    const secondActive = events.findIndex(
      (e) => e.kind === "todo-update" && e.todos[1]?.status === "in_progress",
    );
    const view = fold(events.slice(0, secondActive + 1));
    expect(view.state).toBe("executing");
    expect(view.todos[0]?.status).toBe("completed");
    expect(view.todos[1]?.status).toBe("in_progress");
    expect(view.todos[2]?.status).toBe("pending");
  });

  it("starts preparing and follows phase-change events", () => {
    const start = initialRunView("run-x");
    expect(start.state).toBe("preparing");
    const after = reduceRun(start, {
      kind: "phase-change",
      seq: 1,
      at: "2026-01-01T00:00:01.000Z",
      from: "preparing",
      to: "planning",
    });
    expect(after.state).toBe("planning");
  });

  it("does not mutate the previous view", () => {
    const start = initialRunView("run-x");
    const frozen = JSON.stringify(start);
    reduceRun(start, { kind: "message", seq: 1, at: "2026-01-01T00:00:01.000Z", text: "hello" });
    expect(JSON.stringify(start)).toBe(frozen);
  });
});
```

- [ ] Run `pnpm vitest run src/lib/run/reducer.test.ts` and confirm it fails: vitest cannot resolve the import `./reducer`.
- [ ] Write the implementation `src/lib/run/reducer.ts`:

```ts
import type { CostRecord, Gate, RunEvent, RunState, TodoItem } from "@/lib/forge/types";

/**
 * RunView is NOT part of the canonical model in docs/blueprint/
 * 05-data-model.md. It is a derived, never-persisted UI projection for the
 * Plan & Progress panel: it derives from the canonical `Run` (same id and
 * state) plus the live todo/gate/cost detail folded out of the run's
 * RunEvent transcript. Shared verbatim between the server (run manager)
 * and the client (SSE hook), so both always agree on what a run looks like.
 */
export interface RunView {
  runId: string;
  state: RunState;
  todos: TodoItem[];
  gates: Gate[];
  cost: CostRecord;
  lastMessage: string;
}

export const ZERO_COST: CostRecord = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
};

export function initialRunView(runId: string): RunView {
  return { runId, state: "preparing", todos: [], gates: [], cost: ZERO_COST, lastMessage: "" };
}

export function reduceRun(view: RunView, event: RunEvent): RunView {
  switch (event.kind) {
    case "phase-change":
      return { ...view, state: event.to };
    case "todo-update":
      return { ...view, todos: event.todos };
    case "message":
      return { ...view, lastMessage: event.text };
    case "gate-result":
      return { ...view, gates: [...view.gates, event.gate] };
    case "cost-update":
      return { ...view, cost: event.cumulative };
    case "error":
      return { ...view, lastMessage: event.message };
    case "run-started":
    case "plan-proposed":
    case "plan-decision":
    case "steer-message":
    case "tool-use":
    case "tool-result":
    case "permission-request":
    case "permission-decision":
    case "bash-command":
    case "gate-retry-projection":
      // These variants either belong to later phases or do not change the
      // panel projection; the raw stream list still renders them.
      return view;
  }
}
```

- [ ] Run `pnpm vitest run src/lib/run/reducer.test.ts` again and confirm 4 tests pass.
- [ ] Commit:

```bash
git add src/lib/run/reducer.ts src/lib/run/reducer.test.ts
git commit -m "feat: add runview reducer for plan and progress state"
```

---

## Task 8: In-memory run manager

**Files**

- Create: `src/lib/run/manager.ts`
- Test: `src/lib/run/manager.test.ts`

**Interfaces**

- Consumes: `simulateRun` from `@/lib/sim/simulator`; `initialRunView`, `reduceRun`, `RunView` from `@/lib/run/reducer`; `setTicketStatus` from `@/lib/forge/store`; `Run`, `RunEvent`, `Ticket`, `isTerminalState` from `@/lib/forge/types`; `newId`, `nowIso` from `@/lib/forge/ids`.
- Produces:

```ts
export interface RunHandle {
  run: Run;
  events: RunEvent[];
  view: RunView;
  done: Promise<void>;
}
export interface StartRunOptions {
  delayMs?: number;
}
export function startSimulatedRun(projectDir: string, ticket: Ticket, options?: StartRunOptions): RunHandle;
export function getRun(runId: string): RunHandle | null;
export function findLatestRunForTicket(ticketId: string): RunHandle | null;
export function subscribe(runId: string, listener: (event: RunEvent) => void): () => void;
export function resetRunRegistry(): void;
```

**Steps**

- [ ] Write the failing test `src/lib/run/manager.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTicket, initForge, readTicket } from "@/lib/forge/store";
import type { RunEvent, Ticket } from "@/lib/forge/types";
import { makeScratchDir } from "@/test/helpers";
import {
  findLatestRunForTicket,
  getRun,
  resetRunRegistry,
  startSimulatedRun,
  subscribe,
} from "./manager";

const DEV = "Test Dev <dev@example.com>";

describe("run manager", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let ticket: Ticket;

  beforeEach(async () => {
    resetRunRegistry();
    ({ dir, cleanup } = await makeScratchDir());
    await initForge(dir);
    ticket = await createTicket(
      dir,
      { type: "generic", title: "Demo", inputs: { prompt: "Do a demo" }, jiraRef: null, source: "manual" },
      DEV,
    );
  });

  afterEach(async () => {
    await cleanup();
  });

  it("runs to completion and moves the ticket from running to review", async () => {
    const handle = startSimulatedRun(dir, ticket);
    await handle.done;
    expect(handle.view.state).toBe("completed");
    expect(handle.run.state).toBe("completed");
    expect(handle.run.sessionId).toBe(`sim-session-${handle.run.id}`);
    expect(handle.run.endedAt).not.toBeNull();
    expect(handle.events.at(-1)?.kind).toBe("phase-change");
    expect((await readTicket(dir, ticket.id))?.status).toBe("review");
  });

  it("replays buffered events to late subscribers", async () => {
    const handle = startSimulatedRun(dir, ticket);
    await handle.done;
    const received: RunEvent[] = [];
    const unsubscribe = subscribe(handle.run.id, (event) => received.push(event));
    unsubscribe();
    expect(received).toHaveLength(handle.events.length);
    expect(received.at(-1)?.kind).toBe("phase-change");
  });

  it("delivers live events to early subscribers exactly once", async () => {
    const handle = startSimulatedRun(dir, ticket, { delayMs: 1 });
    const received: RunEvent[] = [];
    subscribe(handle.run.id, (event) => received.push(event));
    await handle.done;
    expect(received.map((e) => e.seq)).toEqual(handle.events.map((e) => e.seq));
  });

  it("finds the latest run for a ticket", async () => {
    const first = startSimulatedRun(dir, ticket);
    await first.done;
    const second = startSimulatedRun(dir, ticket);
    await second.done;
    expect(getRun(first.run.id)?.run.id).toBe(first.run.id);
    expect(getRun("run-nope")).toBeNull();
    expect(findLatestRunForTicket(ticket.id)?.run.id).toBe(second.run.id);
  });
});
```

- [ ] Run `pnpm vitest run src/lib/run/manager.test.ts` and confirm it fails: vitest cannot resolve the import `./manager`.
- [ ] Write the implementation `src/lib/run/manager.ts`:

```ts
import { newId, nowIso } from "@/lib/forge/ids";
import { setTicketStatus } from "@/lib/forge/store";
import { isTerminalState } from "@/lib/forge/types";
import type { Run, RunEvent, Ticket } from "@/lib/forge/types";
import { simulateRun } from "@/lib/sim/simulator";
import { initialRunView, reduceRun } from "./reducer";
import type { RunView } from "./reducer";

/**
 * In-memory registry of runs for the current app process.
 * Phase 1 keeps runs in memory only; Phase 2 adds persistence of the
 * transcript to .forge/local/runs/ so unfinished runs survive an app
 * restart (spec: interrupt, steer, resume).
 *
 * The registry hangs off globalThis so Next.js dev-mode module reloads do
 * not orphan running streams.
 */
export interface RunHandle {
  /** The canonical Run record (docs/blueprint/05-data-model.md). */
  run: Run;
  events: RunEvent[];
  /** Derived projection for the Plan & Progress panel. */
  view: RunView;
  /** Resolves when the run has finished and the ticket status is updated. */
  done: Promise<void>;
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
    await setTicketStatus(projectDir, ticket.id, "running");
    for await (const event of simulateRun({ runId, delayMs: options.delayMs ?? 0 })) {
      record.events.push(event);
      record.view = reduceRun(record.view, event);
      record.run = {
        ...record.run,
        state: record.view.state,
        sessionId: event.kind === "run-started" ? event.sessionId : record.run.sessionId,
      };
      for (const listener of record.listeners) listener(event);
    }
    record.run = { ...record.run, endedAt: nowIso() };
    await setTicketStatus(projectDir, ticket.id, "review");
  })();

  return record;
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

/**
 * Replays all buffered events synchronously, then registers for live events
 * if the run is still going. Runs in a terminal state return a no-op
 * unsubscribe.
 */
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

- [ ] Run `pnpm vitest run src/lib/run/manager.test.ts` again and confirm 4 tests pass.
- [ ] Run the whole suite with `pnpm test` and confirm everything passes.
- [ ] Commit:

```bash
git add src/lib/run/manager.ts src/lib/run/manager.test.ts
git commit -m "feat: add in-memory run manager with subscribe and ticket status updates"
```

---

## Task 9: Project env resolution, git identity, and the create-ticket API

**Files**

- Create: `src/lib/project.ts`
- Create: `src/lib/identity.ts`
- Create: `src/lib/forge/ticket-draft.ts`
- Create: `src/app/api/tickets/route.ts`
- Test: `src/lib/project.test.ts`
- Test: `src/lib/identity.test.ts`
- Test: `src/lib/forge/ticket-draft.test.ts`
- Test: `src/app/api/tickets/route.test.ts`

**Interfaces**

- Consumes: `createTicket`, `initForge`, `TicketDraft` from `@/lib/forge/store`; `isTicketType`, `TicketType` from `@/lib/forge/types`; `startSimulatedRun` from `@/lib/run/manager`.
- Produces:

```ts
export function getProjectDir(): string;
export function getSimDelayMs(): number;
export function resolveIdentity(): Promise<string>; // git-identity string, e.g. "Jane Dev <jane@example.com>"
export function buildTicketDraft(prompt: string, type?: TicketType): TicketDraft | null;
export function POST(req: Request): Promise<Response>; // /api/tickets -> 201 { ticketId, runId }
```

**Steps**

- [ ] Write the failing test `src/lib/project.test.ts`:

```ts
import { isAbsolute } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProjectDir, getSimDelayMs } from "./project";

describe("project env resolution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws a helpful error when FORGE_PROJECT_DIR is missing", () => {
    vi.stubEnv("FORGE_PROJECT_DIR", "");
    expect(() => getProjectDir()).toThrow(/FORGE_PROJECT_DIR/);
  });

  it("resolves the project dir to an absolute path", () => {
    vi.stubEnv("FORGE_PROJECT_DIR", ".");
    expect(isAbsolute(getProjectDir())).toBe(true);
  });

  it("defaults the sim delay to 250ms and accepts overrides including 0", () => {
    vi.stubEnv("FORGE_SIM_DELAY_MS", "");
    expect(getSimDelayMs()).toBe(250);
    vi.stubEnv("FORGE_SIM_DELAY_MS", "0");
    expect(getSimDelayMs()).toBe(0);
    vi.stubEnv("FORGE_SIM_DELAY_MS", "not-a-number");
    expect(getSimDelayMs()).toBe(250);
  });
});
```

- [ ] Run `pnpm vitest run src/lib/project.test.ts` and confirm it fails: vitest cannot resolve the import `./project`.
- [ ] Write the implementation `src/lib/project.ts`:

```ts
import { resolve } from "node:path";

/**
 * Phase 1 project resolution: one env var points the app at the target
 * project repo. The project picker with ~/.agent-workbench/config.json
 * recents arrives in a later phase; this function is its future seam.
 */
export function getProjectDir(): string {
  const dir = process.env.FORGE_PROJECT_DIR;
  if (!dir || dir.trim().length === 0) {
    throw new Error(
      "FORGE_PROJECT_DIR is not set. Point it at the target project repo, e.g. FORGE_PROJECT_DIR=../my-app pnpm dev",
    );
  }
  return resolve(dir);
}

/** Event pacing for simulated runs; 0 in unit tests, small in e2e, 250 in dev. */
export function getSimDelayMs(): number {
  const raw = process.env.FORGE_SIM_DELAY_MS;
  if (raw === undefined || raw.trim().length === 0) return 250;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 250;
}
```

- [ ] Run `pnpm vitest run src/lib/project.test.ts` again and confirm 3 tests pass.
- [ ] Write the failing test `src/lib/identity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveIdentity } from "./identity";

describe("resolveIdentity", () => {
  it("returns a git-identity string, from git config or the fallback", async () => {
    const identity = await resolveIdentity();
    expect(identity).toMatch(/^.+ <.+@.+>$/);
  });
});
```

- [ ] Run `pnpm vitest run src/lib/identity.test.ts` and confirm it fails: vitest cannot resolve the import `./identity`.
- [ ] Write the implementation `src/lib/identity.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function gitConfig(key: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["config", key]);
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Identity is the git-identity STRING, never a structured user object
 * (canonical model, locked decision 2: no auth, no user table). The
 * fallback keeps the app usable on a machine without git config, while
 * making the missing setup visible in the audit trail.
 */
export async function resolveIdentity(): Promise<string> {
  const [name, email] = await Promise.all([gitConfig("user.name"), gitConfig("user.email")]);
  return `${name ?? "unknown"} <${email ?? "unknown@local"}>`;
}
```

- [ ] Run `pnpm vitest run src/lib/identity.test.ts` again and confirm 1 test passes.
- [ ] Write the failing test `src/lib/forge/ticket-draft.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildTicketDraft } from "./ticket-draft";

describe("buildTicketDraft", () => {
  it("rejects empty prompts", () => {
    expect(buildTicketDraft("   ")).toBeNull();
  });

  it("uses the first line as the title and stores the full prompt under inputs.prompt", () => {
    const draft = buildTicketDraft("Fix the header\nIt overlaps the nav on mobile.");
    expect(draft?.title).toBe("Fix the header");
    expect(draft?.inputs.prompt).toContain("It overlaps the nav on mobile.");
    expect(draft?.type).toBe("generic");
    expect(draft?.jiraRef).toBeNull();
    expect(draft?.source).toBe("manual");
  });

  it("truncates long titles to 60 characters with an ellipsis", () => {
    const draft = buildTicketDraft("x".repeat(100));
    expect(draft?.title).toHaveLength(60);
    expect(draft?.title.endsWith("...")).toBe(true);
  });

  it("honors an explicit ticket type", () => {
    expect(buildTicketDraft("Broken build", "bug-fix")?.type).toBe("bug-fix");
  });
});
```

- [ ] Run `pnpm vitest run src/lib/forge/ticket-draft.test.ts` and confirm it fails: vitest cannot resolve the import `./ticket-draft`.
- [ ] Write the implementation `src/lib/forge/ticket-draft.ts`:

```ts
import type { TicketDraft } from "./store";
import type { TicketType } from "./types";

const MAX_TITLE_LENGTH = 60;

/**
 * Prompt-first creation (spec: UI interaction model): the prompt is the only
 * required input, the title derives from its first line, and the full
 * prompt is stored under the canonical Ticket.inputs["prompt"] key.
 */
export function buildTicketDraft(prompt: string, type: TicketType = "generic"): TicketDraft | null {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return null;
  const firstLine = trimmed.split("\n", 1)[0].trim();
  const title =
    firstLine.length <= MAX_TITLE_LENGTH
      ? firstLine
      : `${firstLine.slice(0, MAX_TITLE_LENGTH - 3)}...`;
  return { type, title, inputs: { prompt: trimmed }, jiraRef: null, source: "manual" };
}
```

- [ ] Run `pnpm vitest run src/lib/forge/ticket-draft.test.ts` again and confirm 4 tests pass.
- [ ] Write the failing test `src/app/api/tickets/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listTickets, readTicket } from "@/lib/forge/store";
import { findLatestRunForTicket, resetRunRegistry } from "@/lib/run/manager";
import { makeScratchDir } from "@/test/helpers";
import { POST } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/tickets", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    resetRunRegistry();
    ({ dir, cleanup } = await makeScratchDir());
    vi.stubEnv("FORGE_PROJECT_DIR", dir);
    vi.stubEnv("FORGE_SIM_DELAY_MS", "0");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanup();
  });

  it("rejects an empty prompt with 400", async () => {
    const res = await POST(jsonRequest({ prompt: "  " }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/prompt/);
  });

  it("rejects a non-json body with 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/tickets", { method: "POST", body: "nope" }),
    );
    expect(res.status).toBe(400);
  });

  it("creates a ticket, starts a simulated run, and returns both ids", async () => {
    const res = await POST(jsonRequest({ prompt: "Add a Button component" }));
    expect(res.status).toBe(201);
    const { ticketId, runId } = (await res.json()) as { ticketId: string; runId: string };

    const handle = findLatestRunForTicket(ticketId);
    expect(handle?.run.id).toBe(runId);
    await handle?.done;

    const ticket = await readTicket(dir, ticketId);
    expect(ticket?.title).toBe("Add a Button component");
    expect(ticket?.type).toBe("generic");
    expect(ticket?.inputs.prompt).toBe("Add a Button component");
    expect(ticket?.createdBy).toMatch(/<.+>/);
    expect(ticket?.status).toBe("review");
    expect(await listTickets(dir)).toHaveLength(1);
  });
});
```

- [ ] Run `pnpm vitest run src/app/api/tickets/route.test.ts` and confirm it fails: vitest cannot resolve the import `./route`.
- [ ] Write the implementation `src/app/api/tickets/route.ts`:

```ts
import { createTicket, initForge } from "@/lib/forge/store";
import { buildTicketDraft } from "@/lib/forge/ticket-draft";
import { isTicketType } from "@/lib/forge/types";
import { resolveIdentity } from "@/lib/identity";
import { getProjectDir, getSimDelayMs } from "@/lib/project";
import { startSimulatedRun } from "@/lib/run/manager";

export const dynamic = "force-dynamic";

interface CreateTicketBody {
  prompt?: unknown;
  type?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as CreateTicketBody;
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const type = typeof body.type === "string" && isTicketType(body.type) ? body.type : "generic";
  const draft = buildTicketDraft(prompt, type);
  if (!draft) {
    return Response.json({ error: "prompt must not be empty" }, { status: 400 });
  }

  const projectDir = getProjectDir();
  await initForge(projectDir);
  const ticket = await createTicket(projectDir, draft, await resolveIdentity());
  const handle = startSimulatedRun(projectDir, ticket, { delayMs: getSimDelayMs() });
  return Response.json({ ticketId: ticket.id, runId: handle.run.id }, { status: 201 });
}
```

- [ ] Run `pnpm vitest run src/app/api/tickets/route.test.ts` again and confirm 3 tests pass.
- [ ] Run `pnpm typecheck` and `pnpm lint` and confirm both exit 0.
- [ ] Commit:

```bash
git add src/lib/project.ts src/lib/project.test.ts src/lib/identity.ts src/lib/identity.test.ts src/lib/forge/ticket-draft.ts src/lib/forge/ticket-draft.test.ts src/app/api/tickets/route.ts src/app/api/tickets/route.test.ts
git commit -m "feat: add ticket creation api backed by the simulator"
```

---

## Task 10: SSE run stream route

**Files**

- Create: `src/app/api/runs/[runId]/stream/route.ts`
- Test: `src/app/api/runs/[runId]/stream/route.test.ts`

**Interfaces**

- Consumes: `getRun`, `subscribe` from `@/lib/run/manager`; `RunEvent`, `isTerminalEvent` from `@/lib/forge/types`.
- Produces:

```ts
export function GET(
  req: Request,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response>;
// SSE frames: `event: <RunEvent["kind"]>\ndata: <JSON RunEvent>\n\n`
// The stream closes itself after the terminal phase-change frame.
```

**Steps**

- [ ] Write the failing test `src/app/api/runs/[runId]/stream/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTicket, initForge } from "@/lib/forge/store";
import type { Ticket } from "@/lib/forge/types";
import { resetRunRegistry, startSimulatedRun } from "@/lib/run/manager";
import { makeScratchDir } from "@/test/helpers";
import { GET } from "./route";

function streamRequest(runId: string): [Request, { params: Promise<{ runId: string }> }] {
  return [
    new Request(`http://localhost/api/runs/${runId}/stream`),
    { params: Promise.resolve({ runId }) },
  ];
}

describe("GET /api/runs/[runId]/stream", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let ticket: Ticket;

  beforeEach(async () => {
    resetRunRegistry();
    ({ dir, cleanup } = await makeScratchDir());
    vi.stubEnv("FORGE_PROJECT_DIR", dir);
    await initForge(dir);
    ticket = await createTicket(
      dir,
      { type: "generic", title: "Streamed", inputs: { prompt: "Stream me" }, jiraRef: null, source: "manual" },
      "Test Dev <dev@example.com>",
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanup();
  });

  it("returns 404 for an unknown run", async () => {
    const res = await GET(...streamRequest("run-nope"));
    expect(res.status).toBe(404);
  });

  it("replays a completed run as SSE frames and terminates after the terminal phase-change", async () => {
    const handle = startSimulatedRun(dir, ticket);
    await handle.done;

    const res = await GET(...streamRequest(handle.run.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const text = await res.text();
    expect(text).toContain("event: run-started");
    expect(text).toContain("event: todo-update");
    expect(text).toContain("event: phase-change");
    expect(text).toContain('"to":"completed"');
    expect(text.trim().split("\n\n")).toHaveLength(handle.events.length);
  });

  it("streams a live run through to completion", async () => {
    const handle = startSimulatedRun(dir, ticket, { delayMs: 1 });
    const res = await GET(...streamRequest(handle.run.id));
    const text = await res.text();
    expect(text).toContain('"to":"completed"');
    await handle.done;
  });
});
```

- [ ] Run `pnpm vitest run "src/app/api/runs/[runId]/stream/route.test.ts"` and confirm it fails: vitest cannot resolve the import `./route`.
- [ ] Write the implementation `src/app/api/runs/[runId]/stream/route.ts`:

```ts
import { isTerminalEvent } from "@/lib/forge/types";
import type { RunEvent } from "@/lib/forge/types";
import { getRun, subscribe } from "@/lib/run/manager";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events endpoint for a run: replays buffered events, then
 * streams live ones (the Forge live-trace pattern). One frame per RunEvent,
 * named by the event kind so the client can addEventListener per variant.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await params;
  if (!getRun(runId)) return new Response("run not found", { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let unsubscribe: () => void = () => {};
      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        // Deferred so the synchronous replay inside subscribe() can finish
        // before we tear the listener down.
        queueMicrotask(() => unsubscribe());
        try {
          controller.close();
        } catch {
          // The runtime already closed the stream (client disconnect); done.
        }
      };
      const send = (event: RunEvent): void => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`),
        );
        if (isTerminalEvent(event)) close();
      };
      unsubscribe = subscribe(runId, send);
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] Run `pnpm vitest run "src/app/api/runs/[runId]/stream/route.test.ts"` again and confirm 3 tests pass.
- [ ] Run `pnpm test` and confirm the whole suite passes.
- [ ] Commit:

```bash
git add "src/app/api/runs/[runId]/stream/route.ts" "src/app/api/runs/[runId]/stream/route.test.ts"
git commit -m "feat: add sse run stream endpoint"
```

---

## Task 11: App shell, grouped task sidebar, and create box

**Files**

- Create: `src/lib/ui/group-tickets.ts`
- Create: `src/components/sidebar.tsx`
- Create: `src/components/create-box.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`
- Test: `src/lib/ui/group-tickets.test.ts`

The two client/server components have no meaningful unit surface without jsdom; their behavior is verified end to end by the Playwright smoke test in Task 13, while the grouping logic they render is unit tested here.

**Interfaces**

- Consumes: `Ticket` from `@/lib/forge/types`; `listTickets` from `@/lib/forge/store`; `getProjectDir` from `@/lib/project`; `POST /api/tickets` (from the create box via fetch).
- Produces:

```ts
export type SidebarGroup = "needs_attention" | "running" | "review" | "idle";
export const SIDEBAR_GROUPS: readonly SidebarGroup[];
export const SIDEBAR_GROUP_LABELS: Record<SidebarGroup, string>;
export function groupTickets(tickets: Ticket[]): Record<SidebarGroup, Ticket[]>;
export function Sidebar(): Promise<ReactElement>; // async server component
export function CreateBox(): ReactElement; // client component
```

**Steps**

- [ ] Write the failing test `src/lib/ui/group-tickets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Ticket } from "@/lib/forge/types";
import { SIDEBAR_GROUPS, groupTickets } from "./group-tickets";

function ticket(id: string, status: Ticket["status"]): Ticket {
  return {
    id,
    type: "generic",
    title: id,
    status,
    jiraRef: null,
    inputs: { prompt: id },
    attachments: [],
    checklist: [],
    gates: [],
    planThenApprove: false,
    currentRunId: null,
    branchName: null,
    createdBy: "Test Dev <dev@example.com>",
    createdAt: "2026-07-15T10:00:00.000Z",
    updatedAt: "2026-07-15T10:00:00.000Z",
    source: "manual",
  };
}

describe("groupTickets", () => {
  it("maps all six ticket statuses onto sidebar groups", () => {
    const groups = groupTickets([
      ticket("a", "backlog"),
      ticket("b", "running"),
      ticket("c", "review"),
      ticket("d", "done"),
      ticket("e", "rejected"),
      ticket("f", "failed"),
    ]);
    expect(groups.running.map((t) => t.id)).toEqual(["b"]);
    expect(groups.review.map((t) => t.id)).toEqual(["c"]);
    expect(groups.idle.map((t) => t.id)).toEqual(["a", "d", "e", "f"]);
    expect(groups.needs_attention).toEqual([]);
  });

  it("returns every group even when empty", () => {
    const groups = groupTickets([]);
    for (const group of SIDEBAR_GROUPS) {
      expect(groups[group]).toEqual([]);
    }
  });
});
```

- [ ] Run `pnpm vitest run src/lib/ui/group-tickets.test.ts` and confirm it fails: vitest cannot resolve the import `./group-tickets`.
- [ ] Write the implementation `src/lib/ui/group-tickets.ts`:

```ts
import type { Ticket } from "@/lib/forge/types";

/**
 * Attention-first grouping is the primary navigation (spec: UI interaction
 * model). Per the canonical model, grouping is COMPUTED from TicketStatus
 * (plus the current run's RunState from Phase 2 on) and never persisted.
 * needs_attention exists from day one so the UI shape is final, but Phase 1
 * has nothing that feeds it; Phase 2 moves tasks here on permission
 * prompts, plan approvals, gate failures, and agent questions.
 */
export const SIDEBAR_GROUPS = ["needs_attention", "running", "review", "idle"] as const;
export type SidebarGroup = (typeof SIDEBAR_GROUPS)[number];

export const SIDEBAR_GROUP_LABELS: Record<SidebarGroup, string> = {
  needs_attention: "Needs Attention",
  running: "Running",
  review: "Review",
  idle: "Idle",
};

export function groupTickets(tickets: Ticket[]): Record<SidebarGroup, Ticket[]> {
  const groups: Record<SidebarGroup, Ticket[]> = {
    needs_attention: [],
    running: [],
    review: [],
    idle: [],
  };
  for (const ticket of tickets) {
    if (ticket.status === "running") groups.running.push(ticket);
    else if (ticket.status === "review") groups.review.push(ticket);
    else groups.idle.push(ticket);
  }
  return groups;
}
```

- [ ] Run `pnpm vitest run src/lib/ui/group-tickets.test.ts` again and confirm 2 tests pass.
- [ ] Write the sidebar server component `src/components/sidebar.tsx` (it tolerates a missing `FORGE_PROJECT_DIR` so `pnpm build` and first launch degrade to a setup hint instead of crashing):

```tsx
import Link from "next/link";
import type { ReactElement } from "react";
import { listTickets } from "@/lib/forge/store";
import type { Ticket } from "@/lib/forge/types";
import { getProjectDir } from "@/lib/project";
import { SIDEBAR_GROUP_LABELS, SIDEBAR_GROUPS, groupTickets } from "@/lib/ui/group-tickets";

export async function Sidebar(): Promise<ReactElement> {
  let tickets: Ticket[] = [];
  let configError: string | null = null;
  try {
    tickets = await listTickets(getProjectDir());
  } catch (error) {
    configError = error instanceof Error ? error.message : String(error);
  }
  const groups = groupTickets(tickets);

  return (
    <nav
      aria-label="Tasks"
      className="w-72 shrink-0 space-y-6 overflow-y-auto border-r border-zinc-800 p-4"
    >
      <Link href="/" className="block text-sm font-semibold tracking-wide text-zinc-100">
        Agent Workbench
      </Link>
      {configError ? (
        <p className="text-xs text-amber-400">{configError}</p>
      ) : (
        SIDEBAR_GROUPS.map((group) => (
          <section key={group}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
              {SIDEBAR_GROUP_LABELS[group]} ({groups[group].length})
            </h2>
            <ul className="space-y-1">
              {groups[group].map((ticket) => (
                <li key={ticket.id}>
                  <Link
                    href={`/tasks/${ticket.id}`}
                    className="block rounded px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                  >
                    {ticket.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </nav>
  );
}
```

- [ ] Replace `src/app/layout.tsx` with the two-pane shell:

```tsx
import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Workbench",
  description: "Localhost-per-project developer workbench on the Claude Agent SDK",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <body className="flex h-screen bg-zinc-950 font-sans text-zinc-100 antialiased">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] Write the client create box `src/components/create-box.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
import { useState } from "react";

export function CreateBox(): ReactElement {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(): Promise<void> {
    if (prompt.trim().length === 0 || pending) return;
    setPending(true);
    setError(null);
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `request failed (${res.status})`);
      setPending(false);
      return;
    }
    const { ticketId } = (await res.json()) as { ticketId: string };
    router.push(`/tasks/${ticketId}`);
    router.refresh();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
      className="flex flex-col gap-3"
    >
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="What would you like to work on?"
        rows={3}
        aria-label="Task prompt"
        className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-sm outline-none focus:border-zinc-500"
      />
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending || prompt.trim().length === 0}
        className="self-start rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50"
      >
        {pending ? "Starting..." : "Start"}
      </button>
    </form>
  );
}
```

- [ ] Replace `src/app/page.tsx` with the prompt-first home page:

```tsx
import type { ReactElement } from "react";
import { CreateBox } from "@/components/create-box";

export const dynamic = "force-dynamic";

export default function HomePage(): ReactElement {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">What would you like to work on?</h1>
      <CreateBox />
      <p className="text-sm text-zinc-500">
        Type a prompt and press Start. A generic task is created and a simulated run streams its
        progress live. Pick a task type for template-driven fields in a later phase.
      </p>
    </div>
  );
}
```

- [ ] Run `pnpm typecheck` and `pnpm lint` and confirm both exit 0.
- [ ] Manually smoke it: `FORGE_PROJECT_DIR=$(mktemp -d) pnpm dev`, open http://localhost:3000, confirm the sidebar and create box render (full flow verification lands in Task 13).
- [ ] Commit:

```bash
git add src/lib/ui/group-tickets.ts src/lib/ui/group-tickets.test.ts src/components/sidebar.tsx src/components/create-box.tsx src/app/layout.tsx src/app/page.tsx
git commit -m "feat: add app shell with grouped task sidebar and create box"
```

---

## Task 12: Task detail page with the Plan & Progress panel

**Files**

- Create: `src/lib/ui/format.ts`
- Create: `src/lib/ui/describe-event.ts`
- Create: `src/components/run/use-run-stream.ts`
- Create: `src/components/run/plan-progress-panel.tsx`
- Create: `src/components/run/run-event-list.tsx`
- Create: `src/components/run/task-run-view.tsx`
- Create: `src/app/tasks/[id]/page.tsx`
- Test: `src/lib/ui/format.test.ts`
- Test: `src/lib/ui/describe-event.test.ts`

The reducer that powers the panel is already fully unit tested (Task 7); this task tests the two remaining pure helpers and wires the components, whose rendered behavior Task 13 verifies end to end.

**Interfaces**

- Consumes: `RunEvent`, `RUN_EVENT_KINDS`, `TodoStatus`, `isTerminalEvent`, `isTerminalState` from `@/lib/forge/types`; `initialRunView`, `reduceRun`, `RunView` from `@/lib/run/reducer`; `readTicket` from `@/lib/forge/store`; `findLatestRunForTicket` from `@/lib/run/manager`; `GET /api/runs/[runId]/stream` (via EventSource).
- Produces:

```ts
export function formatCost(costUsd: number): string;
export function summarizeProgress(view: RunView): string;
export function describeEvent(event: RunEvent): string;
export interface RunStreamState {
  view: RunView;
  events: RunEvent[];
}
export function useRunStream(runId: string): RunStreamState;
export function PlanProgressPanel(props: { view: RunView }): ReactElement;
export function RunEventList(props: { events: RunEvent[] }): ReactElement;
export function TaskRunView(props: { runId: string }): ReactElement;
```

**Steps**

- [ ] Write the failing test `src/lib/ui/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TodoItem } from "@/lib/forge/types";
import { initialRunView } from "@/lib/run/reducer";
import { formatCost, summarizeProgress } from "./format";

describe("format helpers", () => {
  it("formats cost in USD with four decimals", () => {
    expect(formatCost(0)).toBe("$0.0000");
    expect(formatCost(0.01234)).toBe("$0.0123");
  });

  it("summarizes todo progress", () => {
    const empty = initialRunView("run-x");
    expect(summarizeProgress(empty)).toBe("Waiting for plan");
    const todos: TodoItem[] = [
      { content: "a", activeForm: "a", status: "completed" },
      { content: "b", activeForm: "b", status: "completed" },
      { content: "c", activeForm: "c", status: "completed" },
      { content: "d", activeForm: "d", status: "in_progress" },
      { content: "e", activeForm: "e", status: "pending" },
    ];
    expect(summarizeProgress({ ...empty, todos })).toBe("3/5 steps done");
  });
});
```

- [ ] Run `pnpm vitest run src/lib/ui/format.test.ts` and confirm it fails: vitest cannot resolve the import `./format`.
- [ ] Write the implementation `src/lib/ui/format.ts`:

```ts
import type { RunView } from "@/lib/run/reducer";

export function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(4)}`;
}

export function summarizeProgress(view: RunView): string {
  if (view.todos.length === 0) return "Waiting for plan";
  const done = view.todos.filter((todo) => todo.status === "completed").length;
  return `${done}/${view.todos.length} steps done`;
}
```

- [ ] Run `pnpm vitest run src/lib/ui/format.test.ts` again and confirm 2 tests pass.
- [ ] Write the failing test `src/lib/ui/describe-event.test.ts` (one sample per canonical variant keeps the switch honest):

```ts
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
```

- [ ] Run `pnpm vitest run src/lib/ui/describe-event.test.ts` and confirm it fails: vitest cannot resolve the import `./describe-event`.
- [ ] Write the implementation `src/lib/ui/describe-event.ts`:

```ts
import type { RunEvent } from "@/lib/forge/types";

/** One log line per event for the raw run stream view. */
export function describeEvent(event: RunEvent): string {
  switch (event.kind) {
    case "run-started":
      return `Run session ${event.sessionId} started`;
    case "plan-proposed":
      return "Plan proposed for approval";
    case "plan-decision":
      return `Plan ${event.decision}`;
    case "todo-update": {
      const done = event.todos.filter((todo) => todo.status === "completed").length;
      return `Todos updated (${done}/${event.todos.length} done)`;
    }
    case "message":
      return event.text;
    case "steer-message":
      return `Steer from ${event.from}: ${event.text}`;
    case "tool-use":
      return `${event.toolName} ${JSON.stringify(event.input)}`;
    case "tool-result":
      return `Tool ${event.toolUseId} ${event.isError ? "failed" : "finished"}`;
    case "permission-request":
      return `Permission requested: ${event.command}`;
    case "permission-decision":
      return `Permission ${event.decision}`;
    case "bash-command":
      return `$ ${event.command} (exit ${event.exitCode})`;
    case "gate-result":
      return `Gate ${event.gate.name}: ${event.gate.status} (${event.gate.explanation})`;
    case "gate-retry-projection":
      return `Gate retry ${event.iteration} projected at $${event.projectedCostUsd.toFixed(4)}`;
    case "cost-update":
      return `Cost so far: $${event.cumulative.costUsd.toFixed(4)}`;
    case "phase-change":
      return `Phase: ${event.from} -> ${event.to}`;
    case "error":
      return `Error: ${event.message}`;
  }
}
```

- [ ] Run `pnpm vitest run src/lib/ui/describe-event.test.ts` again and confirm 2 tests pass.
- [ ] Write the client hook `src/components/run/use-run-stream.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import { RUN_EVENT_KINDS, isTerminalEvent } from "@/lib/forge/types";
import type { RunEvent } from "@/lib/forge/types";
import { initialRunView, reduceRun } from "@/lib/run/reducer";
import type { RunView } from "@/lib/run/reducer";

export interface RunStreamState {
  view: RunView;
  events: RunEvent[];
}

/**
 * Subscribes to the run's SSE endpoint and folds events through the shared
 * reducer. The server closes the stream after the terminal phase-change;
 * if the connection drops mid-run we close instead of retry-looping
 * (Phase 2 adds resume, which is the correct recovery for a dropped run).
 */
export function useRunStream(runId: string): RunStreamState {
  const [state, setState] = useState<RunStreamState>({
    view: initialRunView(runId),
    events: [],
  });

  useEffect(() => {
    setState({ view: initialRunView(runId), events: [] });
    const source = new EventSource(`/api/runs/${runId}/stream`);
    const onEvent = (message: MessageEvent<string>): void => {
      const event = JSON.parse(message.data) as RunEvent;
      setState((current) => ({
        view: reduceRun(current.view, event),
        events: [...current.events, event],
      }));
      if (isTerminalEvent(event)) source.close();
    };
    for (const kind of RUN_EVENT_KINDS) source.addEventListener(kind, onEvent);
    source.onerror = (): void => source.close();
    return (): void => source.close();
  }, [runId]);

  return state;
}
```

- [ ] Write the Plan & Progress panel `src/components/run/plan-progress-panel.tsx`:

```tsx
import type { ReactElement } from "react";
import type { RunState, TodoStatus } from "@/lib/forge/types";
import type { RunView } from "@/lib/run/reducer";
import { formatCost, summarizeProgress } from "@/lib/ui/format";

const TODO_ICONS: Record<TodoStatus, string> = {
  pending: "○",
  in_progress: "●",
  completed: "✓",
};

function headline(state: RunState): string {
  switch (state) {
    case "preparing":
      return "Preparing run";
    case "planning":
      return "Agent planning";
    case "awaiting-plan-approval":
      return "Waiting for plan approval";
    case "executing":
      return "Agent working";
    case "awaiting-permission":
      return "Waiting for permission";
    case "queued":
      return "Waiting for a free run slot";
    case "gates-running":
      return "Running quality gates";
    case "awaiting-iteration-approval":
      return "Waiting for retry-cost approval";
    case "awaiting-approval":
      return "Waiting for review";
    case "completed":
      return "Run complete";
    case "rejected":
      return "Run rejected";
    case "interrupted":
      return "Run interrupted";
    case "failed":
      return "Run failed";
  }
}

export function PlanProgressPanel({ view }: { view: RunView }): ReactElement {
  return (
    <section
      aria-label="Plan and progress"
      className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
    >
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="font-medium">{headline(view.state)}</span>
        <span className="text-zinc-400">
          {summarizeProgress(view)} - {formatCost(view.cost.costUsd)}
        </span>
      </div>
      <ol className="space-y-1.5">
        {view.todos.map((todo) => {
          const tone =
            todo.status === "completed"
              ? "text-zinc-500 line-through"
              : todo.status === "in_progress"
                ? "text-zinc-100"
                : "text-zinc-400";
          return (
            <li key={todo.content} className={`flex items-center gap-2 text-sm ${tone}`}>
              <span aria-hidden>{TODO_ICONS[todo.status]}</span>
              {todo.content}
            </li>
          );
        })}
      </ol>
      {view.lastMessage ? <p className="mt-3 text-sm text-zinc-400">{view.lastMessage}</p> : null}
      {view.gates.length > 0 ? (
        <ul className="mt-3 flex gap-2">
          {view.gates.map((gate) => {
            const tone =
              gate.status === "passed"
                ? "bg-emerald-950 text-emerald-300"
                : gate.status === "warning"
                  ? "bg-amber-950 text-amber-300"
                  : "bg-red-950 text-red-300";
            return (
              <li key={gate.name} className={`rounded-full px-2 py-0.5 text-xs ${tone}`}>
                {gate.name}: {gate.status}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
```

- [ ] Write the raw stream list `src/components/run/run-event-list.tsx`:

```tsx
import type { ReactElement } from "react";
import type { RunEvent } from "@/lib/forge/types";
import { describeEvent } from "@/lib/ui/describe-event";

export function RunEventList({ events }: { events: RunEvent[] }): ReactElement {
  return (
    <section aria-label="Run stream" className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
        Run stream
      </h2>
      <ol className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs text-zinc-400">
        {events.map((event) => (
          <li key={event.seq}>{describeEvent(event)}</li>
        ))}
      </ol>
    </section>
  );
}
```

- [ ] Write the composing client component `src/components/run/task-run-view.tsx` (it refreshes server components once when the run reaches a terminal state, so the sidebar regroups the task):

```tsx
"use client";

import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { isTerminalState } from "@/lib/forge/types";
import { PlanProgressPanel } from "./plan-progress-panel";
import { RunEventList } from "./run-event-list";
import { useRunStream } from "./use-run-stream";

export function TaskRunView({ runId }: { runId: string }): ReactElement {
  const router = useRouter();
  const { view, events } = useRunStream(runId);
  const refreshed = useRef(false);

  useEffect(() => {
    if (!refreshed.current && isTerminalState(view.state)) {
      refreshed.current = true;
      router.refresh();
    }
  }, [view.state, router]);

  return (
    <div className="flex flex-col gap-6">
      <PlanProgressPanel view={view} />
      <RunEventList events={events} />
    </div>
  );
}
```

- [ ] Write the task detail page `src/app/tasks/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import type { ReactElement } from "react";
import { TaskRunView } from "@/components/run/task-run-view";
import { readTicket } from "@/lib/forge/store";
import { getProjectDir } from "@/lib/project";
import { findLatestRunForTicket } from "@/lib/run/manager";

export const dynamic = "force-dynamic";

export default async function TaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  const ticket = await readTicket(getProjectDir(), id);
  if (!ticket) notFound();
  const handle = findLatestRunForTicket(ticket.id);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <p className="text-xs uppercase tracking-wider text-zinc-500">{ticket.type}</p>
        <h1 className="text-xl font-semibold">{ticket.title}</h1>
      </header>
      {handle ? (
        <TaskRunView runId={handle.run.id} />
      ) : (
        <p className="text-sm text-zinc-500">No run recorded for this task yet.</p>
      )}
    </div>
  );
}
```

- [ ] Run `pnpm typecheck` and `pnpm lint` and confirm both exit 0, then run `pnpm test` and confirm the whole suite passes.
- [ ] Manually smoke it: `FORGE_PROJECT_DIR=$(mktemp -d) pnpm dev`, create a task from the home page, and watch the panel tick through 5 todos with gates and cost.
- [ ] Commit:

```bash
git add src/lib/ui/format.ts src/lib/ui/format.test.ts src/lib/ui/describe-event.ts src/lib/ui/describe-event.test.ts src/components/run "src/app/tasks/[id]/page.tsx"
git commit -m "feat: add task detail page with plan and progress panel"
```

---

## Task 13: Playwright smoke test against a fixture project

**Files**

- Create: `playwright.config.ts`
- Create: `e2e/global-setup.ts`
- Create: `e2e/smoke.spec.ts`
- Modify: `package.json` (add the `e2e` script)
- Modify: `.gitignore` (ignore the fixture project and Playwright output)

This task is the end-to-end verification layer for the UI built in Tasks 11 and 12; every unit already had its failing-test-first cycle, so the expectation here is a first-run pass, and any failure is debugged as an integration bug.

**Interfaces**

- Consumes: the running dev server with `FORGE_PROJECT_DIR` pointed at a fixture project and `FORGE_SIM_DELAY_MS=25`.
- Produces: `pnpm e2e` running the smoke scenario headlessly via the Playwright CLI (never the MCP plugin).

**Steps**

- [ ] Install Playwright: `pnpm add -D @playwright/test` then `pnpm exec playwright install chromium`.
- [ ] Add the script to `package.json`:

```json
{
  "scripts": {
    "e2e": "playwright test"
  }
}
```

- [ ] Append to `.gitignore`:

```
# e2e
/e2e/.fixture-project/
/test-results/
/playwright-report/
```

- [ ] Write `playwright.config.ts`:

```ts
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const FIXTURE_PROJECT = join(__dirname, "e2e", ".fixture-project");

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3100",
  },
  webServer: {
    command: "pnpm dev --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    env: {
      FORGE_PROJECT_DIR: FIXTURE_PROJECT,
      FORGE_SIM_DELAY_MS: "25",
    },
  },
});
```

- [ ] Write `e2e/global-setup.ts` (a fresh fixture project per run, so tests never depend on leftover state):

```ts
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FIXTURE_PROJECT = join(__dirname, ".fixture-project");

export default async function globalSetup(): Promise<void> {
  await rm(FIXTURE_PROJECT, { recursive: true, force: true });
  await mkdir(FIXTURE_PROJECT, { recursive: true });
  await writeFile(
    join(FIXTURE_PROJECT, "package.json"),
    `${JSON.stringify({ name: "fixture-project", private: true, version: "0.0.0" }, null, 2)}\n`,
    "utf8",
  );
}
```

- [ ] Write `e2e/smoke.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("create a task and watch the simulated run complete", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "What would you like to work on?" }),
  ).toBeVisible();
  await page.getByPlaceholder("What would you like to work on?").fill("Add a Button component");
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page.getByRole("heading", { name: "Add a Button component" })).toBeVisible();

  // The Plan & Progress panel renders the simulated todo list.
  await expect(page.getByText("Read ticket context and .forge knowledge")).toBeVisible();
  await expect(page.getByText("Run quality gates")).toBeVisible();

  // The run completes: all todos done, gates passed, terminal state shown.
  await expect(page.getByText("Run complete")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("5/5 steps done")).toBeVisible();
  await expect(page.getByText("test: passed")).toBeVisible();

  // The sidebar regroups the finished task under Review.
  const sidebar = page.getByRole("navigation", { name: "Tasks" });
  await expect(sidebar.getByText("Review (1)")).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Add a Button component" })).toBeVisible();
});

test("the run replays for a revisit after completion", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("What would you like to work on?").fill("Fix the tooltip");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText("Run complete")).toBeVisible({ timeout: 20_000 });

  // Navigate away and back; the SSE replay rebuilds the finished panel.
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Tasks" })
    .getByRole("link", { name: "Fix the tooltip" })
    .click();
  await expect(page.getByText("Run complete")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("5/5 steps done")).toBeVisible();
});
```

- [ ] Run `pnpm e2e` and confirm both tests pass (the config boots the dev server against the fixture project itself).
- [ ] Run the full local gate one last time: `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`.
- [ ] Commit:

```bash
git add playwright.config.ts e2e/global-setup.ts e2e/smoke.spec.ts package.json pnpm-lock.yaml .gitignore
git commit -m "test: add playwright smoke test for the simulated run flow"
```

---

## Phase 1 exit checklist

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm e2e` all pass from a clean checkout (with `pnpm exec playwright install chromium` run once).
- [ ] `FORGE_PROJECT_DIR=<any scratch dir> pnpm dev` demos the full loop: create a task from the prompt box, watch the Plan & Progress panel tick through the simulated todos with gates and cost, and see the task land in the sidebar's Review group.
- [ ] The target scratch dir contains a well-formed `.forge/` folder: `config.json` matching the canonical `ForgeConfig` (including `formatVersion`), `tickets/<id>/ticket.json` matching the canonical `Ticket`, and a `.gitignore` shielding `local/`.
- [ ] Every type name and field in `src/lib/forge/types.ts` matches docs/blueprint/05-data-model.md exactly; the only derived non-canonical shape is `RunView` in `src/lib/run/reducer.ts`, documented as deriving from `Run`.
- [ ] No real Agent SDK call exists anywhere in the codebase yet; the simulator is the only event source.
