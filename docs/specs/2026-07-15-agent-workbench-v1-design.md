# Agent Workbench - v1 design

Working name: **Agent Workbench** (folder `agent-workbench`).
Rename is a one-line change at this stage; do it before the first push if wanted.

## Goal

A localhost-per-project developer workbench, built on the Claude Agent SDK, for the team's component delivery flow.
Developers create tickets (Figma-to-component, bug fix, improvement) with context attached; agents execute them with real-time visible progress, in parallel when needed.
Every task runs against repo-versioned knowledge, checklists, and design-system mappings so every developer gets the same output.
Completed work produces a QA handover pack.

The real product is **standardization**: the agent is the engine, the `.forge/` folder in each project repo is the team's shared brain, and **git is the database**.

## Personas

Developers only.
The happy path (generate, test, review, fix via chat) is editor-free; opening VS Code for the hard 10% is expected and fine.
QA does not use the app; the app generates a handover document for them.
No designers/PMs in v1.

## Non-goals

- No Jira/monday integration, ever at the PM level. Tickets here are execution units; a ticket may carry a free-text reference to an official ticket.
- No shared server, no database, no auth. Identity comes from `git config user.name` / `user.email`. Acceptable for an internal team tool; not tamper-proof audit.
- No Sitecore automation in v1. The Figma-to-component checklist keeps the manual Sitecore wiring step visible. V2 candidate.
- No Confluence fetching in v1. Tickets store the link; developers paste relevant content. MCP-based fetching is a v2 candidate.
- No embedded code editor, ever. Review surfaces are a read-only diff viewer, Storybook, and visual compare.
- No PR automation in v1. Approval produces a local commit on the ticket branch; pushing and PRs stay manual.
- No QA-as-user features in v1.

## Success criteria

- A developer can create a Figma-to-component ticket, watch the agent build the component + Storybook story in real time, see real typecheck/lint/test results, review the diff and visual compare, and approve to get a local commit - without opening an editor.
- Two tickets can run concurrently without corrupting each other's changes.
- A running task can be interrupted and steered mid-run.
- A new developer clones the project repo, launches the app, and has every checklist, lesson, and mapping the team has accumulated.
- Every file-modifying action (ticket run or chat) appears in the audit log with user, time, and what happened.
- The QA handover pack for a completed ticket is generated without manual writing.
- **The adoption bar**: a routine quick fix through global chat takes no more friction than terminal Claude Code (open app, hotkey to chat, type, go) - if the terminal is faster for daily work, the app has failed regardless of its features.
- During any run, the developer can see the agent's current plan, the step it is on, done/pending counts, and live checklist state - not just a scrolling event log. This is the headline differentiator over Claude Code.

## Locked product decisions

1. Users: developers; editor optional, not forbidden.
2. Tickets: execution units; optional free-text Jira reference; no integration.
3. State: everything shared lives in `.forge/` committed to the project repo; per-user data in gitignored `.forge/local/`.
4. Learning: fully automatic, with guardrails (provenance, visible lessons feed, one-click revert, periodic prune).
5. Sitecore wiring: v2.
6. QA: handover pack only.
7. Figma: projects have a proper design system; a per-project mapping file drives token/component mapping.
8. Chat: global and unrestricted; any chat that modifies files auto-creates a ticket record behind it.
9. Fresh app; Forge (se-agent-platform) architecture patterns ported deliberately (typed step outputs, gates, SSE live trace, seam architecture, deterministic simulator for tests/demos).
10. **Permission-gated Bash**: the agent gets Bash in ticket runs and chat, gated by real-time UI permission prompts with a configurable allowlist - Claude Code's permission model, surfaced in the app. Full capability parity with terminal Claude Code.
11. **Split transcript storage**: full run transcripts are gitignored local files; only sanitized summaries (files touched, commands run, gates, cost, audit events) are committed. No file contents ever land in git.
12. **Session parity**: sessions load the project's existing CLAUDE.md, `.claude/skills/`, and configured MCP servers, so the app's agent is a superset of each developer's terminal Claude Code, never a subset.

## Architecture

### App shape and distribution

- Next.js (App Router) + TypeScript strict + Tailwind v4, same stack as Forge so patterns and team knowledge port directly.
- The app is one repo; each developer clones it once, `pnpm install && pnpm dev`, and opens `localhost:3000`.
- On launch the app shows a project picker; recent projects are remembered in `~/.agent-workbench/config.json` (per-user, outside any repo).
- All project-specific state lives in the target project's `.forge/` folder; the app itself is stateless about projects.
- `ANTHROPIC_API_KEY` comes from the developer's environment or `~/.agent-workbench/config.json`; keys are never written inside any project repo.
- Mac and Windows are both supported; git worktree operations get explicit Windows testing.

### `.forge/` layout (inside each target project repo)

```
.forge/
  config.json          # project config: script names (typecheck/lint/test/storybook),
                       # package manager, concurrency cap, base branch,
                       # bash allowlist, deny-read globs
  design-system.json   # Figma variable/component -> code token/component mapping
  templates/           # task templates: one folder per ticket type
    figma-to-component/
      template.json    # required inputs, default checklist, gates to run
      checklist.md
    bug-fix/ ...
    improvement/ ...
    generic/ ...
  knowledge/
    project.md         # curated project knowledge (editable in app)
    lessons.md         # auto-learned lessons, each with a provenance block
  tickets/
    <ticket-id>/
      ticket.json      # type, title, status, inputs (figma link, confluence link,
                       # jira ref, file refs), createdBy, timestamps
      attachments/     # uploaded docs, figma context snapshot (see below)
      chat.jsonl       # the ticket's chat transcript, append-only
      runs/<run-id>.summary.json  # SANITIZED run summary: files touched, commands
                       # run, gates, durations, cost, app version - no file contents
      handover.md      # QA handover pack, generated on completion
  audit/
    <YYYY-MM>.jsonl    # append-only audit events
  local/               # GITIGNORED (the app writes the .gitignore entry)
    notes/             # per-user markdown notes
    runs/<ticket-id>/<run-id>.jsonl  # FULL transcripts, local only - reviewable
                       # in-app by the person who ran them, never committed
    settings.json      # per-user UI prefs + monthly budget cap
```

Append-only JSONL formats are chosen deliberately: they minimize git merge conflicts when two developers touch the same ticket.
`ticket.json` status changes can still conflict; that is accepted and documented (resolve like any merge conflict).

### Execution model

- Each ticket run executes in an **isolated git worktree**: `git worktree add <cache>/worktrees/<project-hash>/<ticket-id> -b forge/<ticket-slug>` where `<cache>` is `~/.agent-workbench/`.
- Worktrees live outside every repo, so parallel tickets never touch each other or the developer's own working tree.
- **Prepare phase**: a fresh worktree has no `node_modules`; the app runs the dependency install (pnpm shared store keeps this fast) *concurrently with the agent's planning phase*, with its own visible status, so wall-clock overlap hides most of the cost. Install cost on a real target repo is spiked and measured before phase 2 is built (see build order).
- The Agent SDK session runs with `cwd` = the worktree, tools = Read/Write/Edit/Grep/Glob **plus permission-gated Bash**: every command the agent wants to run is checked against the allowlist in `.forge/config.json` (e.g. `pnpm install`, `pnpm run *`); non-allowlisted commands surface as a real-time approval prompt in the UI, and every command - approved, allowlisted, or denied - is audited.
- Gate execution (typecheck, lint, test, storybook build) remains a fixed non-agentic path: `execFile` against the script names declared in `.forge/config.json`, with timeouts and truncated output capture, so gate *scores* are always computed the same way regardless of what the agent ran itself.
- **Gate-feedback loop**: after the agent session, the app runs the gates; on failure, the failure output is fed back into the session (Agent SDK session resume) for a fix attempt, up to 3 iterations. Before iteration 2, the UI shows the projected retry cost so runaway spend is a visible choice, not a surprise.
- **Plan-then-approve**: ticket templates can require a planning phase - the agent proposes its plan first, the developer approves in the UI, then execution starts. Default ON for figma-to-component, OFF for small bug fixes.
- Default concurrency cap: 3 simultaneous runs (configurable in `.forge/config.json`).
- On **approval**: changes are committed on the ticket branch in the worktree; the worktree is removed; the branch remains for the developer to merge/push manually.
- On **rejection**: the worktree is removed but the branch and its commit(s) are kept for inspection; the UI shows the branch name.
- On **mid-run failure or interrupt**: partial changes are committed to the ticket branch as a WIP commit (never silently discarded), then the same cleanup as rejection.

### Session context and parity

- Every session (ticket run or chat) loads, in order: the project's own CLAUDE.md and `.claude/skills/` (via Agent SDK setting sources), the project's configured MCP servers, then `.forge/knowledge/project.md` + `lessons.md` and the ticket template context on top.
- The app's agent is therefore a **superset** of what the developer gets from terminal Claude Code in the same repo - project rules the team already wrote keep working, and identical context is what makes "every developer gets the same output" true rather than aspirational.
- **Deny-read list**: a default glob list (`.env*`, `*.pem`, `*secret*`, extendable in `.forge/config.json`) that the agent cannot read through any tool. Combined with split transcript storage, no secret can reach either the API transcript or git history via the app.

### Real-time streaming, interrupt, steer, resume

- Each run streams its Agent SDK events (tool calls, file edits, text) over SSE to the ticket page - the Forge live-trace pattern, but real.
- **Plan & Progress panel** (first-class, not an event log): the app parses the agent's plan/todo tool calls out of the stream into a structured panel showing the plan it made, the current step, done/pending counts, live ticket-checklist state, and ticking cost. This directly fixes the Claude Code pain point of not seeing what the agent planned, what it is on, and how much is left.
- **Permission prompts**: when the agent requests a non-allowlisted Bash command, the prompt renders inline in the run view for one-click approve/deny; the run pauses until answered.
- Multiple tickets stream concurrently; the dashboard shows compact live status per running ticket.
- **Janitor on launch**: the app detects orphaned worktrees and dead sessions from crashes or interrupts and offers resume-or-clean, so zombie state never accumulates silently.
- **Interrupt**: an AbortController per run; the stop button aborts the SDK session and triggers the WIP-commit cleanup.
- **Steer**: the ticket chat can send messages into the running session (Agent SDK streaming input), redirecting the agent without restarting.
- **Resume**: run state (session id, worktree path, phase) is persisted in the ticket's run JSONL; if the app restarts, an unfinished run can be resumed or cleanly failed from the ticket page.

### Figma integration

- At ticket creation, the app snapshots the design context using the Figma REST API with the developer's personal access token (stored in `~/.agent-workbench/config.json`, never in the project).
- The snapshot (node screenshot(s), extracted variables/tokens, component structure) is written into the ticket's `attachments/` folder.
- The agent works from the snapshot files plus `.forge/design-system.json` - not from live API access. This makes runs reproducible and auditable.
- `design-system.json` maps Figma variables to code tokens and Figma components to code components; the figma-to-component template refuses to run if the mapping file is missing (with a helpful setup path).

### Review surfaces

- **Diff viewer**: read-only per-ticket diff (branch vs base), rendered in-app.
- **Storybook**: the app starts the project's Storybook (script from `.forge/config.json`) **inside the ticket's worktree**, so the reviewer sees the ticket-branch code, not their own checkout.
  It embeds/links the story for the generated component; the worktree therefore stays alive until the approve/reject decision.
- **Visual compare**: the app screenshots the rendered story via Playwright CLI and shows it side-by-side (and as overlay) with the Figma snapshot image.
- **Checklists**: the template checklist renders in the ticket as todos; command-backed items (typecheck/lint/test) auto-check from gate results; manual items (including the Sitecore wiring reminder) are checked by the developer.
- **Test suggestion button**: an LLM call over the generated component + mapping proposes component-specific test cases, appended to the ticket checklist for the developer to accept.
- **Copy-path and open-in-editor everywhere**: every file reference in the app (diff rows, checklist items, explorer entries, run logs) has a copy-absolute-path button and a `vscode://` deep link - the two reasons developers switch to an editor today become one click when needed and unnecessary otherwise.

### Quality gates

- Real command-backed gates: typecheck, lint, test - exit codes and parsed summaries, `basis: "command"` (ported from the Forge real-code-generation spec, including the missing-script-means-warning rule).
- LLM-narrated gates over the real diff: accessibility, security, maintainability - `basis: "heuristic"`, badged honestly in the UI as narrated.

### Learning system (automatic, guarded)

- After each run (and after corrective chat exchanges), a cheap reflection call extracts candidate lessons from the transcript: corrections the user made, gate failures the agent had to fix, repeated clarifications.
- Lessons append to `.forge/knowledge/lessons.md`, each with a provenance block: ticket id, user, date, source (correction / gate failure / clarification).
- **Write-time hygiene**: before appending, the reflection step dedupes against existing lessons and skips near-duplicates; a hard cap on lesson count forces an oldest-first review when reached, so the file cannot grow into context-bloating rot.
- The Knowledge page shows a "recent lessons" feed; each lesson has one-click revert (a git-tracked edit like any other).
- Every agent session's system context includes `project.md` + `lessons.md`, so lessons apply to all developers after a pull.
- A periodic maintenance task ("consolidate knowledge") lets a developer trigger an agent pass that merges duplicates, resolves contradictions, and prunes stale lessons - output reviewed as a diff before saving.
- Accepted risk: a bad lesson can propagate until noticed; mitigations are provenance, feed visibility, revert, and normal git review at push time.

### Chat model

- **Ticket chat**: every ticket has a chat thread; it is the steering channel during runs and the iteration channel after.
- **Global chat**: unrestricted Claude-style chat with the same tool access (including permission-gated Bash, same allowlist and prompts as ticket runs), running against the developer's main working tree clone of the project (not a worktree), for freeform exploration and quick fixes.
- **Safety snapshot**: before a chat session's first file edit, the app creates an automatic git stash snapshot of the working tree as an undo point, with one-click restore from the chat header. It never blocks; it makes the worst case recoverable.
- The moment a global chat session modifies a file, the app auto-creates a lightweight ticket record (auto-generated title, transcript attached, type `generic`) so the work appears in audit and the learning loop.
- Chat auto-tickets are **records only**: no branch, no worktree, no approval flow - the developer's working tree was edited directly and they commit it themselves, exactly as if they had used Claude Code in a terminal.
- Chat auto-tickets appear in a separate **Chat activity** lane, not the main ticket board, so quick fixes never bury planned work in noise.
- Chat that only reads/answers questions creates nothing.

### File explorer

- Read-only tree of the project (respecting `.gitignore`), file preview, copy-path button.
- "Create ticket from this file": pre-fills a bug-fix or improvement ticket with the file reference.

### Audit log

- Append-only JSONL events: ticket created / run started / interrupted / steered / approved / rejected, chat-auto-ticket created, Bash command approved / allowlisted / denied, lesson added / reverted, knowledge consolidated, handover generated.
- Each event: user (git identity), ISO timestamp, ticket id, event type, short detail, and the app version that produced it (so output differences between app versions are diagnosable).
- The Audit page filters by user, ticket, and date. Per-user notes are private and never audited.
- **Run inspector**: for verification, the person who ran a session can open its full local transcript filtered by view - all file edits, all commands, all permission decisions - instead of scrolling raw events.

### QA handover pack

- Generated on ticket completion into the ticket folder and viewable/exportable from the UI.
- Contents: summary of the change, files changed, how to see it (Storybook story link, route), gate results, checklist state, remaining manual test todos, visual compare screenshots.

### Project overview and notes

- Project page: ticket board (backlog / running / review / done), a separate Chat activity lane, recent activity, cost totals.
- **Sync indicator**: a visible "unpushed `.forge/` changes / behind remote" nudge, so the shared brain does not silently go stale per developer. Optional pathspec-scoped auto-commit of `.forge/` mutations (never touches staged work), default off.
- MD viewer/editor for the project's own markdown files (README, docs/) - view and edit, changes are normal file edits the developer commits.
- Per-user notes: markdown editor over `.forge/local/notes/`, gitignored, never shared, never audited.

### Cost tracking

- Every run and chat records real token usage from the Agent SDK; cost is computed from model pricing.
- Shown per run, per ticket, and as a project total on the overview page.
- **Per-developer monthly budget** (in `.forge/local/settings.json`): the app warns as spend approaches the cap and requires an explicit override past it. Budgets are personal guardrails, not enforcement.

## UI interaction model (adopted from the Vibe Kanban evaluation, 2026-07-15)

The hands-on Vibe Kanban evaluation (see docs/research/2026-07-15-prior-art-vibe-kanban-crystal.md) settled the interaction model.
We adopt its proven shape and add our differentiators on top:

- **Prompt-first creation**: the primary create surface is a "What would you like to work on?" box - type a prompt, hit Enter, a generic task starts with zero ceremony. This is how the adoption-bar success criterion is met in practice.
- **Templates are opt-in structure**: picking a task type (figma-to-component, bug fix, improvement) expands the create box with that template's required fields and attaches its checklist, gates, and plan-then-approve setting. Structure per task type, not ceremony in front of every task.
- **Three-pane layout**: left sidebar lists tasks grouped by **Needs Attention / Running / Review / Idle** (attention-first grouping is the primary navigation; a kanban board view is a later alternate view). Center: the Plan & Progress panel above the conversation/run stream. Right: Git panel (branch, diff stat), checklist + gate state, notes.
- **Needs Attention is the hub state**: permission prompts, plan approvals, gate failures, and agent questions all move a task into this group - one glance shows where the human is needed.
- **Terminal scope**: v1 ships a read-only command-output view (every command is streamed and audited anyway); a full interactive embedded terminal is deferred to v2.

## UI surfaces (v1 complete list)

1. Project picker (launch screen).
2. Task sidebar grouped by Needs Attention / Running / Review / Idle, with live status; separate Chat activity lane.
3. Prompt-first create box with optional template picker (template-driven fields per type).
4. Task detail: chat, Plan & Progress panel, live run stream, plan approval, permission prompts, diff viewer, checklists, gates, visual compare, handover, run inspector, cost.
5. Global chat.
6. File explorer.
7. Knowledge (project.md editor, lessons feed with revert, consolidate action).
8. Notes (per-user).
9. Audit log.
10. Settings (project config editor, design-system mapping editor, per-user settings).

## Testing strategy

- Same philosophy as Forge: everything around the agent is tested offline; the live agent session itself is not in CI.
- Unit/integration (vitest, offline): worktree lifecycle (scratch git repos in tmpdir), `.forge/` read/write + gitignore handling, JSONL append/parse, gate scoring from fixture command output, audit event writing, lesson append/revert, handover generation from fixture data.
- A **deterministic simulator seam** (ported from Forge) fakes the Agent SDK event stream, enabling: UI development without burning tokens, Playwright e2e of the full ticket flow against a fixture project, and demos.
- Playwright CLI e2e (never the MCP plugin): create ticket, watch simulated stream, approve, verify branch/commit in the fixture repo.
- Manual verification recipe documented for the real path: real key, scratch project with `.forge/` set up, run a small figma-to-component ticket end to end.

## Risks (carried openly)

- **Adoption vs terminal Claude Code is the make-or-break risk** (external review scored the pre-mitigation spec 5/10 on exactly this). Mitigations: capability parity (permission-gated Bash, session parity with CLAUDE.md/skills/MCP), the Plan & Progress panel as a genuine improvement over the terminal, the adoption-bar success criterion, and honesty that audit covers only work done through the app. If developers still prefer the terminal after v1, consider a thin CLI companion that logs terminal sessions into `.forge/` (v2 candidate).
- **Worktree preparation cost** (install + Storybook boot) can destroy the real-time feel: mitigated by the spike-before-phase-2 gate, pnpm shared store, install/planning overlap, and a Storybook instance queue.
- Auto-learning quality: mitigated by provenance/feed/revert/prune and write-time dedupe + cap, not eliminated.
- Figma fidelity depends on `design-system.json` being maintained; the template's refuse-to-run-without-mapping rule forces the setup conversation early.
- Parallel runs multiply token cost: mitigated by the concurrency cap, plan-then-approve, and visible per-ticket cost.
- Windows + git worktree edge cases: explicit test pass on Windows before team rollout.
- Git-as-database conflicts on shared files: minimized by append-only formats; residual conflicts are normal git conflicts.

## Suggested build order

The spec is one product, but implementation should be phased; each phase is independently demoable.

1. **Shell + state**: project picker, `.forge/` read/write, ticket board + Chat activity lane, new-ticket form, deterministic simulator seam driving a fake run stream end to end - including the Plan & Progress panel, built against simulated plan events.
2. **Real execution core** (gated by a spike: measure worktree install + Storybook boot cost on a real target repo first): worktree lifecycle + prepare phase, Agent SDK sessions with session parity and permission-gated Bash, SSE streaming, permission prompts, interrupt/steer/resume, janitor, gates + gate-feedback loop, approval/rejection commits, split transcript storage, cost tracking + budget warnings.
3. **Review surfaces**: diff viewer, Storybook-in-worktree, checklists, audit log.
4. **Figma workflow**: context snapshot, `design-system.json` mapping, figma-to-component template, visual compare, test suggestion button.
5. **Knowledge + chat**: lessons reflection/feed/revert/consolidate, global chat with auto-ticket records, QA handover pack, notes, file explorer.

## V2 candidates (explicitly deferred)

- Sitecore wiring automation (JSS/Content SDK registration, rendering/field definitions).
- Confluence content fetching via MCP.
- PR automation (create draft PR from ticket branch).
- QA-as-user features.
- Smarter script-name discovery in target repos.
- Cross-project dashboard.
