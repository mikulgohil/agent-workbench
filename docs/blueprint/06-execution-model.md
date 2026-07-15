# Execution Model

Status: pre-coding blueprint, part of the Agent Workbench documentation pack.
Companion to `01-architecture.md`; read that first for the seams and module layout referenced below (`workspace/`, `session/`, `permission/`, `gates/`, `git/`, `sse/`).

This document is the run lifecycle in exhaustive detail: every state a ticket run passes through, from pre-flight validation to the terminal outcomes, plus the state machine that ties it together.

## Terminology

"Run" means one execution attempt of a ticket - one pass through the state machine below.
A ticket can accumulate multiple runs over its life, for example a rejected run followed by a corrected retry.
"Ticket" is the data-model term for the work item (`.forge/tickets/<ticket-id>/`); see `01-architecture.md`'s terminology note for the ticket/task distinction.

`RunState` below is this document's model of one run's own lifecycle; it is a distinct field from the persisted `TicketStatus` on `ticket.json`.
`05-data-model.md` is canonical for both: its `RunState` union now matches the lifecycle designed in this document exactly, and its `TicketStatus` union is the 6-value `"backlog" | "running" | "review" | "done" | "rejected" | "failed"` persisted on every ticket, with the sidebar's Needs Attention/Running/Review/Idle grouping computed from it plus the current run's `RunState`, never itself persisted.
This document's write rule for `TicketStatus` (which `RunState` transition sets which status) is in "Ticket status write rule," at the end of this document.

## Lifecycle overview

```
queued -> preparing -> [planning -> awaiting-plan-approval ->] executing
        <-> awaiting-permission
        -> gates-running <-> executing (gate-feedback loop, up to 3 iterations)
        -> gates-running -> awaiting-iteration-approval -> executing | awaiting-approval
        -> awaiting-approval -> completed | rejected | executing (chat-driven continuation)
```

Terminal states: `completed`, `rejected`, `interrupted`, `failed`.
The full state list, and every legal transition between them, is in the state machine table at the end of this document.

## Pre-flight validation

Pre-flight runs synchronously, inside the Server Action that handles ticket creation or "start run," before any run record exists.
A failing check returns an inline error to the UI; no run, no worktree, no state transition is created.

Checks, in order:

1. The ticket's template has all its required inputs filled in.
2. Template-specific refusals: `figma-to-component` refuses to run if `.forge/design-system.json` is missing (the spec's explicit refuse-to-run rule).
3. `ANTHROPIC_API_KEY` is present if the engine is `claude`, or the simulator is explicitly selected (see `01-architecture.md`, Seam 1).
4. The target project's git working tree can support a new worktree: the configured base branch exists and the repo is not mid-conflict.
5. **Decision**: the per-developer monthly budget check (the spec's "requires an explicit override past it") is a synchronous confirmation at run-start time, not a persisted async run state.
   It is a personal guardrail, not enforcement, so it does not need its own `RunState`.
   If spend is already over the cap, the Server Action returns a warning the UI must show, and the developer must explicitly re-submit past it before a run is ever created.

If all checks pass, a run record is created in state `queued`.

## Worktree creation: naming and location

- Location: `~/.agent-workbench/worktrees/<project-hash>/<ticket-id>/`.
  `<project-hash>` is a stable hash of the target project's absolute git-root path, the same hash used for the project's URL segment in `01-architecture.md`, so the same project always resolves to the same cache subfolder across app restarts, and unrelated projects never collide even if they share a folder name.
- Command: `git worktree add ~/.agent-workbench/worktrees/<project-hash>/<ticket-id> -b forge/<ticket-slug>`, run from the developer's own checkout of the project (the worktree's origin), never from inside another worktree.
- **Decision**: ticket-id format is `<template-type>-<yyyymmdd>-<6-char-random>`, for example `figma-to-component-20260715-a1b2c3` - human-scannable in logs and folder listings, collision-resistant without a central counter.
- **Decision**: `<ticket-slug>` is the ticket title, slugified and capped at 40 characters, with a short id suffix appended only if truncation would otherwise risk a collision with an existing branch.
  This keeps branch names both readable and unique given git's practical branch-name length limits.
- Worktrees live entirely outside every repo, under `~/.agent-workbench/`, never inside the project, so two tickets running concurrently, or a ticket running alongside the developer's own working tree, never touch each other's files.

## Prepare phase

Two operations start concurrently the moment the worktree exists, each with its own visible UI status:

1. **Dependency install**: `pnpm install` (or the project's configured package manager) via `execFile` inside the worktree.
   The pnpm shared store means most packages hardlink rather than re-download or rebuild, keeping this fast on repeat runs against the same project.
2. **Planning** (only if the ticket's template has `plan_then_approve: true`): the agent session starts immediately in a read-only planning turn - Read/Grep/Glob only, no Bash - and proposes a plan for the developer to approve.
   Planning does not need `node_modules`, so it does not wait on the install.

If the template has `plan_then_approve: false`, there is no planning sub-phase; `preparing` moves straight to `executing` once the session can safely start.

**Decision**: the full agentic session (file reads, edits, and internal reasoning) starts as soon as the worktree exists, in parallel with install - it does not wait.
Only Bash tool calls are held: the session runner queues any Bash tool call the agent issues until the install promise resolves, so the agent's very first script execution (`pnpm test`, `pnpm run typecheck`, and so on) never races an incomplete `node_modules`.
This overlaps the expensive part of the wait (install) with useful agent work (reading the repo, planning, even drafting edits) without ever handing the agent a broken environment.

The real-world cost of this phase (install plus Storybook boot) is measured against a real target repo before the "real execution core" build phase starts, per the spec's build order; this document assumes that spike has confirmed the overlap is worth building.

## Session start: tools, permission-gated Bash, allowlist resolution

Every session (ticket run or chat) loads context in this fixed order (spec point 12, session parity):

1. The project's own `CLAUDE.md` and `.claude/skills/`, via the Agent SDK's `settingSources`.
2. The project's configured MCP servers.
3. `.forge/knowledge/project.md` and `lessons.md`.
4. The ticket's template context (checklist, gates, required inputs).

Tool set: `Read`, `Write`, `Edit`, `Grep`, `Glob`, plus permission-gated `Bash`.
`cwd` is the ticket's worktree, never the developer's own checkout.

**Deny-read enforcement.** `.forge/config.json`'s deny-read globs (`.env*`, `*.pem`, `*secret*`, extendable) must block `Read`/`Grep`/`Glob` from ever returning matching file contents.
**Decision**: this is implemented as a `PreToolUse` hook (an Agent SDK hook) that inspects each of these tools' file-path argument against the deny-read glob list and returns a denied result before the call reaches the filesystem.
The spec states the guarantee, not the mechanism, and a hook is the only point that sees every one of these tool calls before they execute.

**Bash allowlist resolution**, evaluated per Bash tool call the agent issues, in order:

1. Normalize the command (trim, split into `argv[0]` plus the rest).
2. Match against `.forge/config.json`'s allowlist: exact string match first, then glob/wildcard pattern match, for example `pnpm run *`.
3. Matched: auto-approve, log an "allowlisted" audit event, the run does not pause.
4. Not matched: pause the run (state `awaiting-permission`), emit a `permission_request` event over the run's SSE stream, and register a pending decision keyed by `(runId, requestId)` in the `permission` module.

There is no deny-list for Bash commands, only allow vs. prompt - the spec's model is Claude Code's own permission model, surfaced in the app, not a third "block" tier invented on top of it.

## Permission prompt flow (pause / resolve)

- **Decision**: no automatic timeout and no auto-deny.
  The run stays paused indefinitely until a human answers; silently timing out could either falsely deny safe work or falsely allow risky work, and both are wrong without a human decision.
  This matches Claude Code's own permission model (spec point 10), which never times out either.
- Three possible developer decisions, all resuming the same paused tool call:
  - **Approve once**: resumes this tool call only; the allowlist is unchanged.
  - **Approve and allowlist**: resumes this tool call, and additionally appends the matched pattern to `.forge/config.json`'s Bash allowlist - a normal, git-tracked config edit the developer can review like any other, so future runs skip the prompt for the same shape of command.
  - **Deny**: resumes the tool call with a permission-denied result (the Agent SDK's own mechanism for this), letting the agent adapt its plan rather than crashing the run.
  - **Decision**: "approve once" vs. "approve and allowlist" as two distinct responses is an interpretation of the spec's "configurable allowlist."
    The spec only specifies "one-click approve/deny," not this split; it is added because a configurable allowlist is only useful if approving can feed back into it.
- Every decision - approved, allowlisted, or denied - is an audit event, per the spec's explicit list ("Bash command approved / allowlisted / denied").
- On any decision, state returns to `executing`.

## Gate execution (fixed, non-agentic `execFile`)

Gates run after the agent session ends (state `gates-running`): typecheck, lint, test, Storybook build, each a single `execFile` call against the script name declared in `.forge/config.json`, resolved against the target project's `package.json`.

- No shell, no agent involvement - the same script names produce the same pass/warning/fail result regardless of what the agent itself ran via its own Bash tool calls.
- **Decision**: default per-gate timeout is 180 seconds, overridable per gate in `.forge/config.json` for teams with slower suites, for example a Storybook build.
  On timeout, the process is killed (`SIGTERM`, then `SIGKILL` after a grace period), and the gate scores `failed` with an explanation noting the timeout.
- **Decision**: combined stdout and stderr is captured up to 50,000 characters, keeping the first 20,000 and last 20,000 with a `"... truncated Nk chars ..."` marker in between, rather than a naive head-only cut.
  Compiler and test-runner errors frequently appear at the very end of a long log, so tail-preserving truncation matters specifically because this output is fed back into the agent in the gate-feedback loop below - truncation always states what was cut, never silently drops it.
- **Missing-script-means-warning** (ported rule): if the configured script name is not found in the project's `package.json`, the gate does not run at all and scores `warning`, never `passed` and never a hard `failed`, with an explanation that the script is not configured.
  A team may simply not have that gate set up yet, for example no Storybook, and that should read as "not set up," not "broken."
- Gates are `basis: "command"`; the LLM-narrated gates (accessibility, security, maintainability) are a separate, honestly-badged `basis: "heuristic"` pass over the real diff, not part of this `execFile` path.

## Gate-feedback loop

- **Decision (iteration definition)**: "iteration" means one full fix cycle, a resumed agent session plus a gate re-run, following the *initial* session's gate run.
  "Up to 3 iterations" is read as up to 3 such fix cycles, for a maximum of 4 total gate executions per run (the initial run plus 3 fixes).
  The alternative reading, 3 total gate executions including the initial one, is possible but less consistent with the spec's own phrasing: "fed back into the session... for a fix attempt, up to 3 iterations."
- Iteration 1 (the first fix attempt) runs automatically on gate failure, with no confirmation - it is the expected, cheap case.
- Before iteration 2, the UI shows the projected retry cost (spec point, verbatim) and requires an explicit continue/stop decision (state `awaiting-iteration-approval`).
  - **Decision**: projected cost equals the observed cost of the iterations run so far (initial session plus iteration 1), averaged and projected forward one more iteration - a simple "about the same again" estimate, not a more elaborate model.
- **Decision**: if the developer approves continuing past the iteration-2 checkpoint, iteration 3 (the final allowed attempt) proceeds automatically if iteration 2 also fails, without a second checkpoint.
  The spec only calls out a checkpoint "before iteration 2"; since 3 is already a hard ceiling, a second prompt to authorize the very last attempt adds friction without materially preventing runaway spend - the single checkpoint is where the real "visible choice" moment is.
- If the developer declines to continue at the checkpoint, the run moves straight to `awaiting-approval` with the currently-failing gate results shown as-is; the loop simply never reaches iteration 2.
- If iteration 3 still fails (cap reached), the run moves to `awaiting-approval` regardless of gate state - the cap always terminates the loop, it never blocks approval outright, since gates are informative, not a hard gate on the review decision itself.
- A chat-driven continuation from `awaiting-approval` (see the state machine table) resets the iteration count to 0 for any subsequent automatic gate-feedback loop; the cap only bounds the automatic fix loop, not human-directed follow-up work.

## Interrupt (abort -> WIP commit)

- Each live run holds one `AbortController`, owned by the `session` module.
- The stop control invokes a Server Action that calls `.abort()`; the Agent SDK session aborts, the session runner catches it, and then:
  1. If the worktree has any diff against its last commit, an automatic commit is made: `git commit -m "WIP: interrupted at <ISO timestamp>"`.
     **Decision**: if there is no diff, the commit is skipped entirely, so an interrupt with no work done never creates a noise commit.
  2. Any Storybook process bound to the worktree is stopped.
  3. The worktree is removed; the branch is kept (see the shared cleanup rule below).
  4. State becomes `interrupted`; audited as `run interrupted`.
- **Decision**: a `queued` run can also be canceled before it ever starts; since no worktree or branch exists yet, cancellation performs zero git operations and simply marks the run `interrupted` for audit-trail completeness, freeing its concurrency slot.
  Because nothing was ever created, ticket status reverts to `backlog` in this specific case - see "Ticket status write rule" for the full mapping, including the case where a worktree/branch already existed at the time of interrupt.
- **Decision (failure vs. interrupt)**: an unrecoverable failure *after* a worktree/branch exists (during `planning`, `executing`, `awaiting-permission`, `gates-running`, or `awaiting-iteration-approval`) uses this same interrupt path and state (`interrupted`), since there is a WIP commit to make and a branch worth keeping either way.
  A failure *before* a worktree can be created (during `preparing`, for example `git worktree add` itself throwing) has nothing to commit or keep, so it uses the separate `failed` state instead.
  This keeps `failed` narrowly scoped to infrastructure failures with no worktree, and `interrupted` covers everything else, whether user- or system-triggered.
- **Decision**: dependency-install failure during `preparing` does not force `failed`.
  The run proceeds to planning/execution regardless; a broken install surfaces as a prominent warning and, naturally, as Bash command failures the agent (or the gates) will hit anyway.
  It may still be recoverable, for example a flaky registry or a retry, so it should not unilaterally kill the run.

## Steer (streaming input)

- Sessions are started with a streaming input source (the Agent SDK's streaming-input mode), not a single static prompt, specifically so messages can be pushed mid-session.
- The ticket's chat is the steering channel during a run: a Server Action pushes the developer's message onto the running session's input stream; the session incorporates it on its next turn without restarting.
- Steering does not change `RunState` (the run stays `executing`); it is recorded in the ticket's `chat.jsonl` and audited as `steered`.

## Resume after app restart

- After every state transition, the session runner appends one state line to the run's local transcript file, `.forge/local/runs/<ticket-id>/<run-id>.jsonl`: `{"type":"state","state":...,"sessionId":...,"worktreePath":...,"branch":...,"iteration":...,"costSoFar":...}`.
  **Decision**: the inner `state` field name matches `05-data-model.md`'s own `Run.state: RunState` field, and it shares this one file with the full transcript, distinguished by the outer `type: "state" | "event"`, rather than a second state file kept in sync separately - a resume only ever needs to read one file and take its last `type: "state"` line.
- Worktrees are just directories; an app restart does not touch them.
  Only in-memory run-tracking (the `AbortController`, the SSE event-bus subscription, the permission broker's pending-prompt registry) is lost and must be reconstructed.
- On startup, the janitor (see below) scans for runs whose last persisted state is non-terminal but which have no live in-memory tracker in the current process - these are orphaned.
- Resuming an orphaned run calls the Agent SDK's session resume with the persisted `sessionId`, against the worktree already on disk; cleaning one runs the same path as `interrupted` (WIP commit if a diff exists, worktree removed, branch kept).

## Approval (commit on ticket branch, worktree removal)

- Only available from `awaiting-approval`.
- The app's own commit step is the sole authority for what lands: `git add -A && git commit -m "<template-type>: <ticket title>\n\nTicket: <ticket-id>"` inside the worktree, skipped only if the tree is already clean.
  **Decision**: this runs unconditionally on approval even if the agent itself ran `git commit` mid-session, so 100% of the diff is guaranteed to land under one, predictable commit message shape.
- **Decision**: any Storybook process bound to the worktree is stopped before `git worktree remove` - a live dev server holding a file lock on the worktree is a known Windows failure mode for worktree removal, called out because Windows git-worktree behavior is an explicit spec risk.
- The worktree is removed; the branch is **kept** (spec point 118), for the developer to merge/push manually.
- Ticket status is written to `done`, the canonical `TicketStatus` value from `05-data-model.md`.
  See "Ticket status write rule" at the end of this document for the full mapping from every `RunState` transition to the resulting `TicketStatus`.

## Rejection (branch kept)

- Only available from `awaiting-approval`.
- **Decision**: rejection performs the same auto-commit step as approval before removing the worktree.
  Without this, any uncommitted diff would be lost the moment the worktree is deleted, which would contradict the spec's own statement that the branch and its commits are "kept for inspection" - so rejection must commit first, it just does not treat the result as approved.
- **Decision**: if the branch has zero commits beyond the base branch tip - nothing was ever produced worth inspecting, for example a plan-stage rejection, see the state machine notes - the branch is deleted instead of kept; if it has real commits, it is kept exactly as the spec describes.
- Ticket status is written to `rejected`, the canonical `TicketStatus` value from `05-data-model.md` - it is a terminal status, not a reversion to `backlog`.
- **Decision**: a developer can retry a `rejected` or `failed` ticket from its ticket page; retrying resets `ticket.status` to `backlog` and clears `currentRunId`, ready for a fresh run, while the prior run's branch name (kept or not, per the rule above) stays visible in the ticket's run history for reference.
  `05-data-model.md` does not define a retry transition explicitly; this is the simplest option for letting a rejected or failed ticket be attempted again without inventing a new `TicketStatus` value.

## Janitor on launch

Runs once at app startup, and on demand from the UI:

1. **Orphaned runs** (non-terminal persisted state, no live in-memory tracker): offered resume-or-clean, per "Resume after app restart" above.
2. **Orphaned worktrees with no state record at all** (for example a hard crash before any state line was ever written): offered as a plain "remove this leftover worktree" action - there is no session to resume.
3. **Decision**: unmanaged branches - a `forge/*` branch with no corresponding `.forge/tickets/<id>` folder, for example the ticket folder was deleted by hand - are only listed as informational.
   The janitor never deletes a branch automatically here, since doing so without a clearly owning ticket record is a destructive action outside its safe scope.

## Run state machine

`RunState` (string-literal union, no `enum`):

```typescript
export type RunState =
  | "queued"
  | "preparing"
  | "planning"
  | "awaiting-plan-approval"
  | "executing"
  | "awaiting-permission"
  | "gates-running"
  | "awaiting-iteration-approval"
  | "awaiting-approval"
  | "completed"
  | "rejected"
  | "interrupted"
  | "failed";
```

This matches `05-data-model.md`'s canonical `RunState` union exactly, resolving the earlier divergence between this document's lifecycle model and the canonical type.

`completed`, `rejected`, `interrupted`, and `failed` are terminal `RunState` values - no transition leaves them.
Interrupt is offered in every non-terminal state except `awaiting-approval`, where the only actions are approve, reject, or a chat-driven continuation - `awaiting-approval` has no live agent turn to abort.

The table below adds a `Ticket status` column: the value written to `ticket.json`'s canonical `TicketStatus` field (`05-data-model.md`) as a result of that transition.
"(unchanged)" means the transition does not itself trigger a `TicketStatus` write - the ticket is already at the status shown by the most recent changed cell above it in the same run.

| From | To | Trigger | Guard / notes | Ticket status |
|---|---|---|---|---|
| `queued` | `preparing` | A concurrency slot frees up | FIFO by request time; default cap 3, configurable in `.forge/config.json` | (unchanged, `running`) |
| `queued` | `interrupted` | Developer cancels before start | No git operations - nothing exists yet | `backlog` |
| `preparing` | `planning` | Worktree ready, template has `plan_then_approve: true` | Install continues in parallel | (unchanged, `running`) |
| `preparing` | `executing` | Worktree ready, template has `plan_then_approve: false` | Bash calls queue until install resolves | (unchanged, `running`) |
| `preparing` | `failed` | `git worktree add` itself throws | No worktree exists; nothing to clean up | `failed` |
| `preparing` | `interrupted` | Developer aborts before the worktree exists | No-op cleanup | `backlog` |
| `preparing` | `interrupted` | Developer aborts after the worktree exists (install/planning underway) | Normal interrupt cleanup: WIP commit if diff, worktree removed, branch kept | `failed` |
| `planning` | `awaiting-plan-approval` | Agent finishes proposing a plan | - | (unchanged, `running`) |
| `planning` | `interrupted` | Developer aborts, or session errors | Worktree/branch exist; interrupt cleanup applies | `failed` |
| `awaiting-plan-approval` | `executing` | Developer approves the plan | - | (unchanged, `running`) |
| `awaiting-plan-approval` | `planning` | Developer sends a revise-plan chat message | Resumes the session with the new instruction | (unchanged, `running`) |
| `awaiting-plan-approval` | `rejected` | Developer rejects the plan | Branch has no commits yet; branch is deleted, not kept | `rejected` |
| `executing` | `awaiting-permission` | Agent issues a non-allowlisted Bash call | - | (unchanged, `running`) |
| `executing` | `gates-running` | Agent session signals completion | - | (unchanged, `running`) |
| `executing` | `interrupted` | Developer aborts, or session errors | Interrupt cleanup applies | `failed` |
| `awaiting-permission` | `executing` | Permission decision resolved (approve-once / approve-and-allowlist / deny) | - | (unchanged, `running`) |
| `awaiting-permission` | `interrupted` | Developer aborts while a prompt is pending | Interrupt cleanup applies | `failed` |
| `gates-running` | `awaiting-approval` | All gates pass, or the iteration cap (3) is reached | Cap always terminates the loop | `review` |
| `gates-running` | `executing` | Gate failure, iteration 1 | Automatic, no confirmation | (unchanged, `running`) |
| `gates-running` | `awaiting-iteration-approval` | Gate failure, before iteration 2 | Projected cost shown | (unchanged, `running`) |
| `gates-running` | `interrupted` | Developer aborts during gate execution | Kills the gate's child process | `failed` |
| `awaiting-iteration-approval` | `executing` | Developer approves continuing | Iteration 2 runs; iteration 3 auto-continues if needed | (unchanged, `running`) |
| `awaiting-iteration-approval` | `awaiting-approval` | Developer declines to continue | Current failing gate state shown as-is | `review` |
| `awaiting-iteration-approval` | `interrupted` | Developer aborts instead of deciding | Interrupt cleanup applies | `failed` |
| `awaiting-approval` | `completed` | Developer approves | Commit plus worktree removal, branch kept | `done` |
| `awaiting-approval` | `rejected` | Developer rejects | Commit plus worktree removal; branch kept only if it has real commits | `rejected` |
| `awaiting-approval` | `executing` | Developer sends a follow-up chat message | Same session/worktree resumed; iteration count resets to 0 | (unchanged, `running`) |

## Ticket status write rule

`ticket.json`'s persisted `status` field is the canonical 6-value `TicketStatus` from `05-data-model.md`: `"backlog" | "running" | "review" | "done" | "rejected" | "failed"`.
This is the only persisted lifecycle field on a ticket.
The sidebar's Needs Attention/Running/Review/Idle grouping is computed from it plus the current run's `RunState`, never itself persisted, matching `05-data-model.md`'s own design note on `TicketStatus`.

The write rule, summarized from the table above:

- Ticket status is written to `running` once, the moment a run is created (entering `queued`) - a ticket has no distinct "queued" ticket status; `running` covers every in-progress `RunState` up to `awaiting-approval`.
- Ticket status is written to `review` when the run enters `awaiting-approval`.
- Ticket status is written to `done` when the run reaches `completed`.
- Ticket status is written to `rejected` when the run reaches `rejected`, whether from `awaiting-approval` or from `awaiting-plan-approval`.
- Ticket status is written to `failed` when the run reaches `failed`, or reaches `interrupted` with a worktree/branch that already existed at the time of interrupt.
  **Decision**: `failed` is the closest canonical status for "did not complete, needs a look," since `TicketStatus` has no dedicated "interrupted" value.
  A deliberate stop and an unexpected crash are both surfaced the same way to the developer, who reads the kept branch and its WIP commit, if any, to see how far the run actually got.
- Ticket status is written back to `backlog` when the run reaches `interrupted` with no worktree ever created, only reachable from `queued` - nothing happened, so the ticket reverts as if the run had never started.
- **Decision**: a developer-initiated retry of a `rejected` or `failed` ticket also writes `backlog`, per the "Rejection" section above.

### Needs Attention / Running / Review / Idle grouping

**Decision**: with `rejected` and `failed` now distinct `TicketStatus` values, the sidebar grouping is:

- **Needs Attention**: status `running` and the run's current `RunState` is one of `awaiting-permission`, `awaiting-plan-approval`, `awaiting-iteration-approval`, or the ticket has an unread agent question in chat; or status `failed`.
  A failed run always needs a developer decision - retry, inspect the WIP branch, or abandon - so it never reads as merely "idle."
- **Running**: status `running` and none of the above.
- **Review**: status `review` (a ticket simply waiting on approve/reject is expected, not an attention interrupt).
- **Idle**: status `backlog`, `done`, or `rejected` - all three are closed states with nothing currently pending from the developer.
