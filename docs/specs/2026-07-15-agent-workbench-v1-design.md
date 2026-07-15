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
                       # package manager, concurrency cap, base branch
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
      runs/<run-id>.jsonl  # execution event stream, append-only
      handover.md      # QA handover pack, generated on completion
  audit/
    <YYYY-MM>.jsonl    # append-only audit events
  local/               # GITIGNORED (the app writes the .gitignore entry)
    notes/             # per-user markdown notes
    settings.json      # per-user UI prefs
```

Append-only JSONL formats are chosen deliberately: they minimize git merge conflicts when two developers touch the same ticket.
`ticket.json` status changes can still conflict; that is accepted and documented (resolve like any merge conflict).

### Execution model

- Each ticket run executes in an **isolated git worktree**: `git worktree add <cache>/worktrees/<project-hash>/<ticket-id> -b forge/<ticket-slug>` where `<cache>` is `~/.agent-workbench/`.
- Worktrees live outside every repo, so parallel tickets never touch each other or the developer's own working tree.
- The Agent SDK session runs with `cwd` = the worktree, tools = Read/Write/Edit/Grep/Glob, **no Bash**.
- Command execution (typecheck, lint, test, storybook build) is a fixed non-agentic path: `execFile` against the script names declared in `.forge/config.json`, with timeouts and truncated output capture (same guardrails as the Forge real-code-generation spec).
- **Gate-feedback loop**: after the agent session, the app runs the gates; on failure, the failure output is fed back into the session (Agent SDK session resume) for a fix attempt, up to 3 iterations. This gives iterative fixing without giving the agent shell access.
- **Plan-then-approve**: ticket templates can require a planning phase - the agent proposes its plan first, the developer approves in the UI, then execution starts. Default ON for figma-to-component, OFF for small bug fixes.
- Default concurrency cap: 3 simultaneous runs (configurable in `.forge/config.json`).
- On **approval**: changes are committed on the ticket branch in the worktree; the worktree is removed; the branch remains for the developer to merge/push manually.
- On **rejection**: the worktree is removed but the branch and its commit(s) are kept for inspection; the UI shows the branch name.
- On **mid-run failure or interrupt**: partial changes are committed to the ticket branch as a WIP commit (never silently discarded), then the same cleanup as rejection.

### Real-time streaming, interrupt, steer, resume

- Each run streams its Agent SDK events (tool calls, file edits, text) over SSE to the ticket page - the Forge live-trace pattern, but real.
- Multiple tickets stream concurrently; the dashboard shows compact live status per running ticket.
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

### Quality gates

- Real command-backed gates: typecheck, lint, test - exit codes and parsed summaries, `basis: "command"` (ported from the Forge real-code-generation spec, including the missing-script-means-warning rule).
- LLM-narrated gates over the real diff: accessibility, security, maintainability - `basis: "heuristic"`, badged honestly in the UI as narrated.

### Learning system (automatic, guarded)

- After each run (and after corrective chat exchanges), a cheap reflection call extracts candidate lessons from the transcript: corrections the user made, gate failures the agent had to fix, repeated clarifications.
- Lessons append to `.forge/knowledge/lessons.md`, each with a provenance block: ticket id, user, date, source (correction / gate failure / clarification).
- The Knowledge page shows a "recent lessons" feed; each lesson has one-click revert (a git-tracked edit like any other).
- Every agent session's system context includes `project.md` + `lessons.md`, so lessons apply to all developers after a pull.
- A periodic maintenance task ("consolidate knowledge") lets a developer trigger an agent pass that merges duplicates, resolves contradictions, and prunes stale lessons - output reviewed as a diff before saving.
- Accepted risk: a bad lesson can propagate until noticed; mitigations are provenance, feed visibility, revert, and normal git review at push time.

### Chat model

- **Ticket chat**: every ticket has a chat thread; it is the steering channel during runs and the iteration channel after.
- **Global chat**: unrestricted Claude-style chat with the same tool access, running against the developer's main working tree clone of the project (not a worktree), for freeform exploration and quick fixes.
- The moment a global chat session modifies a file, the app auto-creates a lightweight ticket record (auto-generated title, transcript attached, type `generic`) so the work appears in audit and the learning loop.
- Chat auto-tickets are **records only**: no branch, no worktree, no approval flow - the developer's working tree was edited directly and they commit it themselves, exactly as if they had used Claude Code in a terminal.
- Chat that only reads/answers questions creates nothing.

### File explorer

- Read-only tree of the project (respecting `.gitignore`), file preview, copy-path button.
- "Create ticket from this file": pre-fills a bug-fix or improvement ticket with the file reference.

### Audit log

- Append-only JSONL events: ticket created / run started / interrupted / steered / approved / rejected, chat-auto-ticket created, lesson added / reverted, knowledge consolidated, handover generated.
- Each event: user (git identity), ISO timestamp, ticket id, event type, short detail.
- The Audit page filters by user, ticket, and date. Per-user notes are private and never audited.

### QA handover pack

- Generated on ticket completion into the ticket folder and viewable/exportable from the UI.
- Contents: summary of the change, files changed, how to see it (Storybook story link, route), gate results, checklist state, remaining manual test todos, visual compare screenshots.

### Project overview and notes

- Project page: ticket board (backlog / running / review / done), recent activity, cost totals.
- MD viewer/editor for the project's own markdown files (README, docs/) - view and edit, changes are normal file edits the developer commits.
- Per-user notes: markdown editor over `.forge/local/notes/`, gitignored, never shared, never audited.

### Cost tracking

- Every run and chat records real token usage from the Agent SDK; cost is computed from model pricing.
- Shown per run, per ticket, and as a project total on the overview page.

## UI surfaces (v1 complete list)

1. Project picker (launch screen).
2. Dashboard / ticket board with live status of running tickets.
3. New ticket form (template-driven fields per type).
4. Ticket detail: chat, live run stream, plan approval, diff viewer, checklists, gates, visual compare, handover, cost.
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

- Auto-learning quality: mitigated by provenance/feed/revert/prune, not eliminated.
- Figma fidelity depends on `design-system.json` being maintained; the template's refuse-to-run-without-mapping rule forces the setup conversation early.
- Parallel runs multiply token cost: mitigated by the concurrency cap, plan-then-approve, and visible per-ticket cost.
- Windows + git worktree edge cases: explicit test pass on Windows before team rollout.
- Git-as-database conflicts on shared files: minimized by append-only formats; residual conflicts are normal git conflicts.

## Suggested build order

The spec is one product, but implementation should be phased; each phase is independently demoable.

1. **Shell + state**: project picker, `.forge/` read/write, ticket board, new-ticket form, deterministic simulator seam driving a fake run stream end to end.
2. **Real execution core**: worktree lifecycle, Agent SDK sessions, SSE streaming, interrupt/steer/resume, gates + gate-feedback loop, approval/rejection commits, cost tracking.
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
