# Architecture

Status: pre-coding blueprint, part of the Agent Workbench documentation pack.
Source of truth: `docs/specs/2026-07-15-agent-workbench-v1-design.md`.
Reference for the seam/typed-domain-model philosophy: the `se-agent-platform` repo's `docs/ARCHITECTURE.md` and `src/lib/engineering-agent/`.

This document explains how Agent Workbench is put together: the app shape, the layer diagram, the three seams that keep the system testable and swappable, the module layout of `src/`, the SSE streaming design, state handling, and the deterministic simulator seam.
The companion document `06-execution-model.md` covers the run lifecycle in exhaustive detail; this document covers the surrounding system.

## Terminology

The spec uses "ticket" as the data-model term (`.forge/tickets/<ticket-id>/`) and "task" as the user-facing UI label for the same entity (task sidebar, task detail).
Both documents in this pack use "ticket" throughout, since it is the term tied to the on-disk schema; read "task" in any UI copy as a synonym for the same thing.

## Goals

Ported from Forge's three architecture goals, adjusted for a real (not simulated-by-default) agent:

1. Look and behave like a real engineering tool a developer keeps open all day, not a chat demo bolted onto a repo.
2. Run with minimal configuration: clone once, `pnpm install && pnpm dev`, pick a project folder, go.
3. Make the seams obvious: swapping the real Agent SDK session for the deterministic simulator, or pointing `forge-store` at a fixture directory instead of a real project, is a contained, single-module change, not a rewrite.

## App shape and distribution

- Next.js App Router, TypeScript strict, Tailwind v4, pnpm - the same stack as Forge, so patterns and prior team knowledge port directly.
- One repo, one long-running local Node process per developer: `pnpm dev`, opened at `localhost:3000`.
- The app itself holds no project-specific state.
  All such state lives inside the target project's own `.forge/` folder, per the spec's "git is the database" decision.
- Two categories of state sit outside any project repo, in `~/.agent-workbench/`:
  - `config.json` - recent projects, the developer's Anthropic key (if not read from the environment), and the Figma personal access token.
  - `worktrees/<project-hash>/<ticket-id>/` - the isolated git worktrees used for ticket runs (see `06-execution-model.md`).
- **Decision**: the currently active project is threaded through the URL as `/p/[projectId]/...`, where `projectId` is the same stable hash of the project's absolute git-root path used for the worktree cache path (`<project-hash>`), rather than a server-side session cookie.
  There is no session store to hang a cookie off (no database, no auth), and a URL-carried project id lets multiple browser tabs hold different active projects at once, and survives a page refresh or bookmark deterministically.
- The Agent SDK session itself may spawn its own subprocess (this is how `@anthropic-ai/claude-agent-sdk`'s `query()` works, confirmed by Forge's `agent-sdk-model.ts`).
  The app's own `execFile` calls (gates, git plumbing, Storybook, Playwright) are separate, narrower child processes with no shell and no agent loop.
- Mac and Windows are both supported; every git-worktree code path gets explicit Windows verification before team rollout (carried as a risk in the spec).

## Layer diagram

```
Browser (React Server + Client Components)
  |  Server Actions (mutations)      |  EventSource (SSE, read-only streams)
  v                                   v
Next.js trust boundary: Server Actions (Zod-validated) + Route Handlers (SSE, binary)
  |
  v
Service layer (src/lib/*)
  workspace | session | permission | gates | forge-store | audit
  knowledge | figma | handover | sse
  |
  v
External effects
  Agent SDK (agent engine seam) | git (worktree, commit, diff) | fs (.forge/, ~/.agent-workbench/) | execFile (gates, Storybook, Playwright)
```

This mirrors Forge's `UI -> Server Actions -> Repository/Runtime -> Agents -> Model` shape, with two differences the real tool loop demands:

- Mutations still go through Server Actions (create ticket, approve, reject, start run, send permission decision, send steer message, interrupt) - the same trust boundary Forge uses, Zod-validated at the boundary.
- Long-lived and binary reads (the two SSE streams, Figma attachment bytes, file-explorer preview/download) go through Route Handlers instead, because Server Actions are not the right shape for an indefinitely-open stream or a binary payload.

**Decision**: the Storybook-in-worktree review surface is not proxied through the Next.js app at all.
The app spawns the project's Storybook dev server bound to a free local port per worktree, and the review UI points an `<iframe>` straight at `http://localhost:<port>`.
Proxying would add a second streaming surface for no benefit on a localhost-only tool.

## The three seams

### Seam 1: the agent engine

The single biggest seam in the system - it plays the role Forge's model seam (`mock-model.ts` / `agent-sdk-model.ts`) plays there, except the surface is bigger, because this agent has real tools (Bash, file edits), not just text generation.

```typescript
export type RunEventKind =
  | "plan_created"
  | "plan_step_started"
  | "plan_step_done"
  | "tool_call"
  | "file_edit"
  | "permission_request"
  | "text"
  | "gate_trigger"
  | "session_done";

export interface AgentEngine {
  readonly kind: "claude" | "simulated";
  startSession(input: SessionStartInput): AsyncIterable<RunEvent>;
  resumeSession(input: SessionResumeInput): AsyncIterable<RunEvent>;
  steer(sessionId: string, message: string): Promise<void>;
  abort(sessionId: string): void;
}
```

Two implementations conform to this interface:

- `ClaudeAgentEngine` (`lib/engine/claude-engine.ts`) - wraps `@anthropic-ai/claude-agent-sdk`'s `query()` with the full tool set (Read/Write/Edit/Grep/Glob plus permission-gated Bash), `cwd` set to the ticket's worktree, and `settingSources` enabled so the project's own `CLAUDE.md`, `.claude/skills/`, and configured MCP servers load first (session parity, spec point 12).
- `SimulatedAgentEngine` (`lib/engine/simulated-engine.ts`) - a deterministic replay engine, detailed under "The deterministic simulator seam" below.

**Decision**: engine selection is explicit, never a silent fallback on API-key presence.
Forge falls back to mock mode automatically when no key is present, which is right for a public demo; here, a real ticket run silently downgrading to fake output would be actively dangerous, since a developer could approve and commit work that was never really produced.
`AGENT_ENGINE=claude|simulated` (env var, default `claude`) picks the engine; selecting `claude` without a usable `ANTHROPIC_API_KEY` is a loud pre-flight failure, not a quiet swap.
A per-run "run in simulator" toggle exists for demos regardless of key presence.

### Seam 2: storage (`.forge/` as plain files)

Unlike Forge's `Repository` interface, which has two real swappable backends (memory and Supabase), there is exactly one real backend here by design: plain files under `.forge/` and `~/.agent-workbench/` (spec point 3, no database).
The `forge-store` module still exists as an abstraction layer - not to swap backends, but so the rest of the app never calls `node:fs` directly, and so tests can point the same functions at a tmpdir fixture project instead of a real repo.
The "seam" here is a testability seam, not a runtime-swappable-backend seam.

### Seam 3: command execution (fixed `execFile` path)

Gate execution, git plumbing, Storybook boot, and Playwright screenshot capture all go through one low-level wrapper (`lib/exec/exec-file.ts`): no shell, a timeout, and truncated output capture.
This guarantees gate *scores* are computed identically regardless of what the agent itself chose to run via its own (separately audited, permission-gated) Bash tool calls - the spec's explicit reason for keeping gates non-agentic.
The agent's Bash tool calls and the app's own `execFile` calls share only the low-level primitive (timeout/truncation); they are different trust paths.
The agent's calls are permission-gated and audited per call; the app's own calls are unconditionally trusted infrastructure.

## Module layout (`src/`)

Ten modules are named directly by the spec; each owns exactly one responsibility.

| Module (`src/lib/...`) | Responsibility |
|---|---|
| `workspace/` | Worktree lifecycle (create/list/remove, naming/hashing per project), the global project registry (`~/.agent-workbench/config.json`), and the startup janitor. |
| `session/` | Orchestrates one ticket run end to end: prepare -> session start -> gate loop -> review -> approve/reject; owns the run's persisted state and its `AbortController`. |
| `permission/` | Resolves Bash tool calls against `.forge/config.json`'s allowlist; holds the pending-prompt registry and resolves prompts on developer decision. |
| `gates/` | The fixed `execFile` gate path: script resolution, timeouts, output truncation, and pass/warning/fail scoring. |
| `forge-store/` | All `.forge/` reads and writes: `config.json`, `design-system.json`, templates, `tickets/`, and the `.forge/local/` gitignore bootstrap. |
| `audit/` | Append-only monthly JSONL audit events (`audit/<YYYY-MM>.jsonl`) and their read/filter path for the Audit page. |
| `knowledge/` | Lesson extraction (reflection), append/dedupe/cap, revert, and the periodic consolidate pass over `.forge/knowledge/`. |
| `figma/` | Figma REST API client, ticket-creation-time context snapshot writer, and `design-system.json` mapping access. |
| `handover/` | QA handover pack generation on ticket completion. |
| `sse/` | The in-process event bus (per-run channels + a dashboard channel) and the SSE wire-format encoder shared by both route handlers. |

Supporting modules, not individually named by the spec but required to implement the above without duplication:

| Module | Responsibility |
|---|---|
| `engine/` | The agent engine seam itself: the `AgentEngine` interface, `ClaudeAgentEngine`, `SimulatedAgentEngine`, and engine selection. |
| `git/` | Thin git plumbing shared by `workspace/` and `session/`: worktree add/remove, commit, diff, branch existence/delete. |
| `exec/` | The shared `execFile` primitive (no shell, timeout, truncation) used by `gates/`, `git/`, and Storybook/Playwright invocations. |
| `cost/` | Token usage to USD conversion, cumulative per-ticket/per-project totals, and the per-developer monthly budget check. |
| `types/` | The shared domain model: `RunEvent`, `RunState`, `Ticket`, `AuditEvent`, and friends - discriminated unions and string-literal unions throughout, no `enum`, no `any`. |

`app/` holds only routes: page components under `app/p/[projectId]/...`, Server Actions colocated with the pages that call them, and the SSE/binary Route Handlers under `app/api/`.

## SSE streaming design

Two streams, both plain Route Handlers returning a `ReadableStream` with `Content-Type: text/event-stream`; no client-side polling anywhere in the app.

### Per-run stream (`app/api/runs/[runId]/stream/route.ts`)

- Subscribes to that run's channel on the `sse` module's in-process event bus.
- On subscribe, immediately emits one synthetic `snapshot` event reconstructed from the session runner's current in-memory state (or, if the run is not live in this process, from the last persisted state line - see the janitor/resume design in `06-execution-model.md`), so a browser tab that connects or reconnects mid-run is never blank.
- Streams every subsequent `RunEvent` (plan events, tool calls, file edits, permission requests, gate results, text) until the run reaches a terminal phase or the client disconnects.
- Client disconnect unsubscribes from the bus; it never aborts the run itself - only the explicit interrupt action does that.

### Dashboard status stream (`app/api/dashboard/stream/route.ts`)

- A coarser, project-scoped stream: ticket-group counts (Needs Attention / Running / Review / Idle) and a one-line status digest per running ticket.
- **Decision**: this stream emits only on phase transitions, not on every tool call or file edit, so it stays cheap even with the full concurrency cap (default 3) of tickets running at once.
  Per-run detail belongs on the per-run stream, not here.

Both streams are read-only; every mutation (create ticket, start run, approve, reject, permission decision, steer message, interrupt) is a Server Action, keeping the write path Zod-validated and the read path a plain subscription.

## State handling

- **Server is the source of truth.** Run state (phase, plan/progress, cost-so-far, iteration count) lives in the session runner's memory while the run is live, and is checkpointed to that run's local JSONL file after every phase transition (detailed in `06-execution-model.md`), so it survives an app restart.
- **No database.** The only three storage locations in the entire system are `.forge/` (shared, git-tracked), `.forge/local/` (per-user, gitignored), and `~/.agent-workbench/` (global per-user, outside any repo) - all plain files.
- **Client subscribes, never owns state.** React Server Components render the initial snapshot from `forge-store`; Client Components hold only ephemeral UI state (form inputs, expanded panels) and otherwise render off SSE deltas layered on that initial snapshot, or refetch via a Server Action's return value after a mutation.
  There is no client-side cache/store library.
- **Decision**: concurrent writers to the same on-disk file (for example, two tickets' runs both appending to the same month's `audit/<YYYY-MM>.jsonl`) are serialized by an in-process async mutex keyed by absolute file path, inside `forge-store`/`audit`.
  This is safe because it is a single Node process; it only guarantees atomic-per-line appends within that process, not across two developers' processes.
  Inter-developer conflicts remain normal git merge conflicts, exactly as the spec already accepts for `ticket.json` status changes.

## The deterministic simulator seam

`SimulatedAgentEngine` implements the same `AgentEngine` interface as `ClaudeAgentEngine`, so nothing above the seam - session runner, permission broker, gate runner, SSE, UI - can tell which one is driving a run.

- Given a ticket and its template, it replays a scripted sequence of `RunEvent`s from a fixture library keyed by template type: plan created, plan steps started/done, file writes, a permission request for a non-allowlisted command (so the permission-prompt UI has something real to exercise), a gate trigger, completion.
- Timing is synthesized from event size, the same trick Forge's mock agents use, so replays are wall-clock-independent and reproducible across builds - no `setTimeout` tied to real latency.
- **Decision**: the simulator performs real, small, deterministic file writes into a real (throwaway, fixture-seeded) worktree, rather than only emitting fake "file changed" events.
  Only the "thinking" step (the LLM call) is faked; everything downstream - the diff viewer, gate runner, worktree/branch lifecycle, approval commit - runs its real code path.
  This is Forge's "fake the model, keep everything downstream real" philosophy, applied one layer deeper, because this system's agent has real side effects, not just structured text output.
- This one seam enables three things without spending a token: UI development against a live, correctly-shaped event stream; Playwright e2e of the full ticket flow (create -> stream -> approve -> verify branch/commit) against a fixture project, fully offline and in CI; and reproducible product demos.
- Selection is explicit (see Seam 1); a misconfigured real run fails loudly rather than silently completing on canned output.
