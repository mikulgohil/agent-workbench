# Agent Workbench - v1 UI specification

Date: 2026-07-15.
Source of truth: `docs/specs/2026-07-15-agent-workbench-v1-design.md`, sections "UI interaction model" and "UI surfaces (v1 complete list)".
Companion document: `docs/blueprint/03-vibe-kanban-learnings.md` (code-grounded patterns adopted from or rejected against the Vibe Kanban clone).
This document specifies every v1 screen and panel: purpose, content, states, and interactions.
It is a UI contract for implementation, not a visual design file; visual polish is applied within these constraints.

## 1. Design principles

1. **Adoption bar first.** A routine quick fix must be no more friction than terminal Claude Code: open app, hotkey to chat, type, go. Every screen decision is tested against this.
2. **Attention-first navigation.** The sidebar's Needs Attention group is the hub; one glance shows where the human is needed. Kanban board is a later alternate view, not v1 navigation.
3. **Plan visibility is the headline differentiator.** The Plan & Progress panel is a first-class structured surface, never a scrolling event log.
4. **Honesty in every badge.** Command-backed results are visually distinct from LLM-narrated ones; simulated or heuristic output is never dressed up as real.
5. **Prompt first, structure opt-in.** Typing a prompt and hitting Enter starts a generic task with zero ceremony; templates add structure only when chosen.
6. **Copy-path and open-in-editor everywhere.** Every file reference in the app carries a copy-absolute-path button and a `vscode://` deep link.
7. **Never steal focus, never lose input.** Streaming updates and state changes must not grab keyboard focus or discard typed drafts.

## 2. Route map

The app is Next.js App Router; one project is active per browser tab.

| Route | Screen |
|---|---|
| `/` | Project picker (launch screen) |
| `/p/[projectKey]` | Workbench shell; center shows project overview when no task is selected |
| `/p/[projectKey]/tasks/[ticketId]` | Task detail (three-pane) |
| `/p/[projectKey]/chat` | Global chat |
| `/p/[projectKey]/files` | File explorer |
| `/p/[projectKey]/knowledge` | Knowledge (project.md + lessons) |
| `/p/[projectKey]/notes` | Per-user notes |
| `/p/[projectKey]/audit` | Audit log |
| `/p/[projectKey]/settings` | Settings (project config, design-system mapping, per-user) |

`projectKey` is a stable slug derived from the project path recorded in `~/.agent-workbench/config.json`.
All `/p/[projectKey]/*` routes render inside the workbench shell (top bar + task sidebar); the project picker is the only chrome-free screen.
Deep links must survive reload: a pasted task URL reopens the same task with the same panel state.

## 3. Workbench shell and three-pane layout

### 3.1 Geometry

- **Left sidebar** (task list): fixed width 300px, collapsible to zero with a reopen affordance on the left edge.
- **Center pane**: flexible, minimum 480px; contains the Plan & Progress panel above the conversation/run stream, with the follow-up composer and diff strip at the bottom.
- **Right rail** (task context): fixed width 320px, collapsible; stacked collapsible sections for Git, Checklist & Gates, and Notes.
- Pane visibility and each section's expanded/collapsed state persist per project in `.forge/local/settings.json` under a namespaced key per panel (adopting Vibe Kanban's persist-key-per-section pattern).
- Optional split view: the center pane can host a secondary panel (diff viewer, visual compare, or run inspector) side by side with the conversation, divided by a draggable resizer; the split ratio persists.

### 3.2 Top bar

- Project name + branch of the developer's working tree, acting as a menu to switch projects (returns to picker).
- **Sync indicator**: a chip showing "unpushed `.forge/` changes" or "behind remote" when the shared brain is stale; clicking it opens a popover with the exact file list and a copyable `git` command; shows nothing when clean.
- Project cost total for the current month with budget progress; turns warning-colored at 80% of the per-user budget cap.
- Global chat button (also bound to the global hotkey).
- Command palette button (Cmd/Ctrl+K).

### 3.3 States

| State | Behavior |
|---|---|
| Loading | Skeleton sidebar rows and a skeleton center pane; no layout shift when data arrives. |
| Empty (no tickets) | Sidebar shows only the create affordance; center shows the prompt-first create box with a one-line explanation of templates. |
| Error (`.forge/` unreadable) | Full-pane error card naming the exact file that failed to parse, with an "open in editor" deep link; the app never renders half-parsed project state. |
| Janitor (on launch) | If orphaned worktrees or dead sessions are detected, a blocking-but-dismissible dialog lists each with Resume or Clean per row; see 4.11. |

## 4. Screens and panels

### 4.1 Project picker (`/`)

**Purpose.** Choose or add a project; the app is stateless about projects, so this is the only per-user entry surface.

**Content.**
- Recent projects list from `~/.agent-workbench/config.json`: name, absolute path, last opened, `.forge/` status badge (Initialized / Not initialized), and per-project month-to-date cost if known.
- "Open project" action with a path input and native directory browse.
- `ANTHROPIC_API_KEY` status indicator (Detected in environment / Configured in app config / Missing), with a link to Settings guidance; the key value itself is never displayed.

**States.**
- Empty: no recent projects; centered "Open your first project" action with a short explanation of what `.forge/` is.
- Loading: instantaneous local read; no spinner beyond 100ms.
- Error: a recent project whose path no longer exists renders dimmed with a Remove action; opening a non-git directory shows an inline error.
- Not initialized: opening a project without `.forge/` launches the init wizard (choose script names, package manager, base branch; writes `.forge/config.json` and the `local/` gitignore entry).

**Interactions.** Click or Enter opens the project; Cmd/Ctrl+Backspace removes a recent entry (with confirm); the list is keyboard-navigable with arrow keys.

### 4.2 Task sidebar

**Purpose.** Primary navigation; surfaces where the human is needed without opening anything.

**Grouping.** Tasks are grouped into four collapsible sections plus one lane, with this precedence (a task appears in exactly one group, first match wins):

1. **Needs Attention**: a pending permission prompt, a plan awaiting approval, an agent question, a gate-failure retry awaiting the projected-cost confirmation, a budget-cap override prompt, or a crashed/interrupted run awaiting resume-or-clean.
2. **Running**: prepare phase, agent session, gate execution, or fix iteration in progress.
3. **Review**: run finished; diff, gates, and checklists ready; awaiting approve/reject.
4. **Idle**: backlog tickets not yet started, plus done and rejected tickets (with status chips).
5. **Chat activity** (separate lane below the groups): auto-created ticket records from global chat sessions; records only, no approval flow.

Group headers show a count; each section's expansion persists.
An in-progress create draft renders as a pinned "Draft" row at the top of Needs Attention (never lost by navigation).

**Row content.** Title (single line, faded overflow), status line with: live "running" indicator, raised-hand icon when input is needed, failure triangle for failed/killed runs, relative time since last activity, and a right-aligned diff stat (`file-count +added -removed`) when changes exist.

**States.**
- Empty group: a muted "No tasks" line inside the expanded section.
- Loading: skeleton rows.
- Error: if ticket JSON fails to parse, the row renders with a warning icon and an "open ticket.json" action rather than disappearing.

**Interactions.**
- Click selects the task; re-clicking the selected task scrolls its conversation to the latest message.
- Search field filters by title and branch name; filter and sort controls (by updated/created, ascending/descending) live behind icon buttons.
- Hover reveals a per-row overflow menu (rename, duplicate as new ticket, archive, copy branch name).
- `J`/`K` move selection; Enter opens; `A` jumps to the first Needs Attention task (see section 6).

### 4.3 Prompt-first create box

**Purpose.** The primary create surface; meets the adoption bar by making a generic task cost one prompt and one keypress.

**Placement.** Selecting "New task" (button, `C`, or `G N`) puts the center pane into create mode; the sidebar remains visible with the draft row pinned.

**Content.**
- Heading: "What would you like to work on?".
- Large multiline prompt editor; supports file paste/drag for attachments and `@` to reference project file paths.
- The first line of the prompt (word-boundary-truncated at 100 chars) becomes the ticket title; the remainder becomes the description; this derivation is shown live under the editor.
- **Template picker**: a row of chips - Generic (default, selected), Figma-to-component, Bug fix, Improvement - driven by the folders in `.forge/templates/`.
- Picking a template expands the box with that template's fields from `template.json`: required inputs (e.g. Figma link, Jira reference, Confluence link, file references), an attachments dropzone, a read-only preview of the checklist it will attach, the gates it will run, and the plan-then-approve toggle preset to the template default (ON for figma-to-component, OFF for bug fix).
- Footer: cost note ("runs bill real tokens"), Create & Start button, and Create (backlog only) secondary action.

**States.**
- Idle/empty: Create disabled until the prompt is non-empty.
- Validating: figma-to-component with no `.forge/design-system.json` blocks submit with an inline explanation and a "Set up mapping" link to Settings (the template refuses to run without it).
- Submitting: button spinner; editor disabled; no double submit.
- Error: creation failure renders inline above the footer with the raw cause; the draft is preserved.

**Interactions.**
- Cmd/Ctrl+Enter submits.
- The draft (prompt, template choice, field values, attachments) persists across navigation and reload until submitted or explicitly discarded.
- On submit: ticket folder is written, the run starts (or the planning phase, if plan-then-approve), and the app navigates to the task detail.

### 4.4 Task detail - center pane

The center pane stacks, top to bottom: Plan & Progress panel, conversation/run stream, and the composer with diff strip.

#### 4.4.1 Plan & Progress panel (the centerpiece)

**Purpose.** Answer at a glance: what did the agent plan, what step is it on, how much is left, and what is it costing - the exact Claude Code pain point this app exists to fix.

**Placement.** Pinned above the conversation; collapsible to a one-line summary bar (phase + current step + step counts + cost) that remains pinned.

**Content.**
- **Phase indicator**: Preparing worktree / Planning / Awaiting plan approval / Executing / Running gates / Fix iteration n of 3 / Paused - awaiting permission / Awaiting review / Done / Failed.
  The prepare phase shows its own live status (dependency install output summary) since it runs concurrently with planning.
- **Plan steps**: the structured list parsed from the agent's plan/todo tool calls, each with status (pending / in progress / completed / cancelled), the in-progress step highlighted with a live indicator; cancelled steps render struck through.
- **Counts and progress**: "k of n steps done" with a determinate progress bar.
- **Live checklist**: the ticket template's checklist items; command-backed items auto-check from gate results and render with a "verified by command" glyph; manual items (including the Sitecore wiring reminder) are human-toggleable checkboxes.
- **Ticking cost**: tokens and computed dollar cost, updated on every Agent SDK usage event; hover reveals the input/output/cache breakdown; elapsed wall-clock time and model name sit alongside.
- **Gate-retry cost gate**: before fix iteration 2, the projected retry cost renders here with Continue / Stop actions; the run does not proceed without an answer.

**States.**
- Empty: before the agent emits a plan, the panel shows the phase and "No plan produced yet"; it never pretends structure exists.
- Loading/reconnecting: on SSE drop, the panel keeps its last state, overlays a "reconnecting" note, and replays missed events from the run JSONL on reconnect.
- Live: as above.
- Error: run failure freezes the panel with the failing phase highlighted and a link to the WIP-commit branch name.
- Done: final state is frozen and remains visible for review; counts and final cost stay rendered.

**Interactions.**
- Clicking a plan step scrolls the conversation to that step's first event.
- Collapse state persists per user.
- "Copy plan" copies the step list as Markdown.

#### 4.4.2 Conversation / run stream

**Purpose.** The chronological record: user messages, agent text, tool calls, file edits, command output, and inline decision points.

**Content.**
- Message entries (user, agent) rendered as Markdown.
- Tool-call entries collapsed by default to a one-line summary (tool, target path, outcome dot), expandable to full detail; file edits expand to a mini diff.
- Command entries stream stdout/stderr into a read-only, monospace, virtualized view (v1 terminal scope is read-only output; no interactive terminal).
- Plan-approval card (4.4.3) and permission prompts (4.4.4) render inline at their position in the stream.
- Every file path in any entry carries copy-path and `vscode://` actions.

**States.**
- Empty: for a backlog ticket with no runs, show the ticket description and a "Start run" affordance.
- Loading: skeleton while history loads from the run JSONL.
- Live: streaming with auto-scroll; if the user scrolls up, auto-scroll disengages and a "Jump to latest" pill appears; new-content growth never yanks the viewport (scroll compensation on composer height change).
- Error: a stream-drop banner with automatic exponential-backoff reconnect and a manual retry.

**Interactions.** Collapse/expand entries; per-turn navigation (jump to previous user message); copy any entry's raw content.

#### 4.4.3 Plan approval (plan-then-approve templates)

- After the planning phase, the proposed plan renders as an inline card: step list, files it expects to touch, and estimated scope.
- Actions: **Approve plan** (starts execution) and **Request changes** (opens the composer with the plan quoted; sending it re-enters planning).
- The task sits in Needs Attention until answered; the Plan panel shows "Awaiting plan approval".
- Approval and rejection are audited events.

#### 4.4.4 Permission prompt (gated Bash)

**Purpose.** Surface Claude Code's permission model in the UI; the run pauses until answered.

**Placement.** Inline in the conversation at the request point; additionally, if the prompt is outside the viewport, a slim banner above the composer says "Permission requested" with a jump action.
The task moves to Needs Attention.

**Content.**
- The exact command in a monospace block, plus its working directory.
- Why it prompted: "not on the project allowlist" with the nearest allowlist entry shown if one is close.
- Actions: **Approve once**, **Deny**, and an "Always allow `<pattern>` in this project" checkbox that appends to the allowlist in `.forge/config.json` (flagged as a config edit that will appear in the project diff and audit).
- Deny opens an optional reason field (prefilled: "User denied this command."), which is fed back to the agent.

**States.** Pending (run paused, paused-for duration ticking); answered (renders the decision and decider inline, permanently); superseded (if the run is stopped first, the prompt renders as cancelled).
There is no auto-timeout in v1; the Agent SDK `canUseTool` callback waits indefinitely, and the paused state is visible in sidebar, Plan panel, and prompt.

**Interactions.** Enter approves and Cmd/Ctrl+Enter denies while the prompt has approval scope (focus within the prompt or summoned via the attention hotkey); every decision is audited with user and timestamp.

#### 4.4.5 Composer and diff strip

- The composer is a multiline editor pinned at the bottom of the center pane; Cmd/Ctrl+Enter sends.
- **While running**: the primary action is **Steer** (sends the message into the live session via streaming input); secondary **Stop** (aborts, triggers WIP-commit cleanup, with confirm).
- **While idle/review**: the primary action is **Send** (starts a follow-up iteration on the same ticket branch).
- **Header strip** (left side of the composer): while running it shows the current in-progress plan step with a live indicator; otherwise it shows the diff stat as a button - "N files changed +A -D" - that opens the diff viewer.
- A conflict warning chip replaces the diff stat when the ticket branch has conflicts with base.
- Attachments can be pasted or dropped into the composer.

### 4.5 Task detail - right rail

Stacked, independently collapsible sections; each persists its expanded state.

**Git section.**
- Ticket branch name (copyable), base branch, ahead/behind counts, and the diff stat.
- Approve/Reject actions live here during Review: **Approve** commits on the ticket branch, removes the worktree, and shows the branch name for manual merge/push; **Reject** removes the worktree, keeps the branch, and shows it for inspection.
- States: hidden pre-run; live counts during run; frozen after decision with the outcome and branch name.

**Checklist & Gates section.**
- The gates list: typecheck, lint, test, storybook build, and the narrated gates (accessibility, security, maintainability).
- Each gate row: name, status (pass / warn / fail / running / skipped), duration, and a **basis badge**: `command` (neutral, "real") or `heuristic` (visibly distinct, "narrated") - narrated results must never look command-backed.
- A missing script renders as a warning ("no `test` script configured"), never as a pass.
- Expanding a row reveals the parsed summary and truncated output with a copy action.
- Fix-iteration history renders as iteration chips (1, 2, 3) with per-iteration outcomes.
- A **Suggest tests** button runs the LLM test-suggestion call and appends accepted proposals to the ticket checklist.
- States: empty (no gates run yet), running (per-gate spinners), done, error (gate runner itself failed, with raw output).

**Notes section.** A lightweight per-user scratch note scoped to this ticket, stored under `.forge/local/notes/`; autosaves; marked "private, not committed".

### 4.6 Diff viewer

**Purpose.** Read-only review of the ticket branch against base; one of the three review surfaces.

**Placement.** Opens as the center-pane split panel (or full-center on narrow widths) from the diff strip, Git section, or checklist links.

**Content.**
- File tree (grouped by directory, change-kind glyphs, per-file +/- counts) beside virtualized per-file diffs.
- Per-file header: path with copy-path and `vscode://` actions, change kind, and collapse toggle.
- View controls: unified/split toggle, wrap toggle, ignore-whitespace toggle; all persist.
- Syntax highlighting computed off the main thread (worker) so large diffs do not jank the stream.

**States.** Empty ("No changes yet" during early run); loading; live (diff refreshes as the agent edits, without resetting scroll or collapse state); error (git diff failure with raw stderr).

**Interactions.** Tree click scrolls to the file; keyboard `n`/`p` next/previous file; no editing affordances anywhere (spec: no embedded editor, ever).

### 4.7 Visual compare

**Purpose.** Pixel-level verification of a generated component against the Figma snapshot.

**Content.**
- Left: the Figma snapshot image from the ticket's `attachments/`.
- Right: the Playwright screenshot of the rendered Storybook story from the ticket worktree.
- Modes: **Side-by-side** (synced zoom/pan) and **Overlay** (opacity slider 0-100 plus a swipe/onion-skin divider).
- Toolbar: refresh screenshot (re-runs the Playwright capture), open story in Storybook (in-worktree instance), viewport size selector matching the story's declared viewports.

**States.**
- Waiting: Storybook-in-worktree boot status with elapsed time (boot cost is a known risk; the wait is honest and visible).
- Live: both images loaded.
- Error: story render failure shows the Storybook/Playwright error output and a link to the run log; a missing Figma snapshot explains that the ticket was created without one.

### 4.8 Global chat (`/p/[projectKey]/chat`)

**Purpose.** Unrestricted Claude-style chat against the developer's main working tree; the quick-fix path that must beat the terminal.

**Content.**
- Full-height conversation with the same stream components, permission prompts, and allowlist as ticket runs.
- Header: **safety snapshot chip** - after the session's first file edit, shows "Snapshot taken HH:MM" with one-click Restore (confirm dialog); before any edit it shows nothing.
- **Auto-ticket notice**: the moment the session first modifies a file, an inline system entry appears: "This chat is now recorded as ticket `<id>` in Chat activity"; read-only Q&A sessions create nothing.
- A compact Plan & Progress summary bar appears when the session emits plan/todo events; cost ticks in the header.

**States.** Empty (input focused, one-line capability note); running; paused on permission prompt; error (same stream-drop handling as ticket runs).

**Interactions.** Summoned from any screen by the global hotkey with focus placed in the input; Stop aborts; edits land directly in the working tree and are committed by the developer as usual (no approval flow).

### 4.9 File explorer (`/p/[projectKey]/files`)

**Purpose.** Read-only orientation in the project without leaving the app.

**Content.** Tree respecting `.gitignore`; read-only file preview with syntax highlighting; per-node copy-path and `vscode://` actions; a "Create ticket from this file" action that opens create mode with the template picker on Bug fix / Improvement and the file reference pre-filled.

**States.** Loading (tree skeleton); empty directory ("empty"); binary/large file preview replaced by size + type card; error (unreadable path inline).

**Interactions.** Arrow-key tree navigation; type-ahead by filename; preview pane scroll independent of tree.

### 4.10 Knowledge (`/p/[projectKey]/knowledge`)

**Purpose.** The team's shared brain: curated project knowledge and the auto-learned lessons feed with guardrails.

**Content.**
- **project.md editor**: Markdown editor with preview toggle; saving writes the file (a normal git-tracked edit).
- **Lessons feed**: reverse-chronological entries from `lessons.md`; each renders the lesson text plus its provenance block - ticket id (link), user, date, and source badge (correction / gate failure / clarification).
- Per-lesson **Revert** (one click, confirm; a git-tracked edit like any other, audited).
- **Consolidate knowledge** action: triggers the agent maintenance pass; the result is presented as a diff for review and applied only on accept.
- Cap meter: lessons count against the hard cap, with the oldest-first review prompt when the cap is reached.

**States.** Empty ("No lessons learned yet" with a one-line explanation of how lessons appear); loading; error (parse failure names the offending block, feed still renders the rest).

### 4.11 Janitor dialog (launch)

- Appears after project open when orphaned worktrees or unfinished runs are detected.
- Each row: ticket title, worktree path, phase at interruption, last event time; actions **Resume** (re-attach via persisted session id) and **Clean** (WIP-commit then remove worktree).
- "Clean all" bulk action with confirm; dismissing defers, and a persistent sidebar badge keeps the count visible so zombie state never silently accumulates.

### 4.12 Handover viewer

- A tab within the task detail once a ticket completes; renders `handover.md`: change summary, files changed, how to see it (story link, route), gate results, checklist state, remaining manual test todos, and the visual-compare screenshots.
- Actions: copy as Markdown, save/export file, regenerate (audited).
- States: not yet generated (offer generate), generating, rendered, error with raw generator output.

### 4.13 Run inspector

- Opened from a run's entry in the task detail (run list in the Git/Plan area) or from an audit row.
- Available only for runs the current user executed (full transcripts are local-only); other users see "transcript not available on this machine - summaries only".
- Filter chips over the full local transcript: All / File edits / Commands / Permission decisions; raw JSONL toggle for debugging.
- Each row keeps the copy-path / `vscode://` affordances.

### 4.14 Notes (`/p/[projectKey]/notes`)

- Per-user Markdown notes over `.forge/local/notes/`: note list (title = first line) plus editor with autosave.
- Permanently labeled "private to you: gitignored, never audited".
- States: empty (create-first-note affordance), editing (dirty dot until autosave lands), error (write failure with retry).

### 4.15 Audit log (`/p/[projectKey]/audit`)

**Purpose.** Answer "who did what, when" across every file-modifying action performed through the app.

**Content.**
- A virtualized table over the monthly JSONL files: timestamp, user (git identity), event type, ticket (link), short detail, app version.
- Event types: ticket created, run started / interrupted / steered / approved / rejected, chat-auto-ticket created, Bash approved / allowlisted / denied, lesson added / reverted, knowledge consolidated, handover generated.
- Filters: user, ticket, event type, date range; filters combine and reflect in the URL for shareable views.
- Row expansion shows the full event payload; runs the current user owns link into the run inspector.

**States.** Empty ("No events this month" with the month selector); loading; error (corrupt line renders as a raw-text row, never breaks the table).

### 4.16 Settings (`/p/[projectKey]/settings`)

Three tabs; every save states exactly which file it writes.

1. **Project config** (`.forge/config.json`, git-tracked): script names (typecheck/lint/test/storybook), package manager, concurrency cap, base branch; **Bash allowlist** editor (add/edit/remove patterns, each with a "last used" hint from audit data); **deny-read globs** editor seeded with the defaults (`.env*`, `*.pem`, `*secret*`).
2. **Design-system mapping** (`.forge/design-system.json`, git-tracked): two mapping tables - Figma variables to code tokens, and Figma components to code components - with add/edit/remove rows, unmapped-reference warnings, and a JSON source toggle.
3. **Per-user** (`~/.agent-workbench/config.json` and `.forge/local/settings.json`): theme, editor deep-link scheme (default `vscode://`), Figma personal access token (write-only field with a set/replace flow; value never rendered), monthly budget cap, and UI preferences reset.

States: pristine / dirty (unsaved banner with discard) / saved (with the written file path) / invalid (schema errors inline per field; save blocked).

### 4.17 Project overview (center pane, no task selected)

- Board-style summary lists mirroring the sidebar groups (backlog / running / review / done) plus the Chat activity lane.
- Recent activity feed (latest audit events, humanized).
- Cost panel: project total, per-ticket top spenders, current user's month against their budget cap.
- The prompt-first create box is embedded at the top, so the landing state invites work rather than administration.

## 5. Cross-cutting component vocabulary

| Component | Contract |
|---|---|
| StatusChip | One glyph + label per ticket/run state; never color-only. |
| GateBadge | `command` vs `heuristic` basis variants; visually unmistakable at a glance. |
| CostTicker | Live token/dollar readout; throttled to at most 2 updates/sec; hover breakdown. |
| PathActions | Copy absolute path + `vscode://` open; attached to every rendered file path. |
| CollapsibleSection | Header + persisted expansion keyed per section (sidebar groups, right-rail sections, stream entries). |
| StreamViewport | Virtualized log/conversation scroller with pin-to-bottom, "Jump to latest" pill, and scroll compensation. |
| ProvenanceBlock | Ticket link + user + date + source badge; used by lessons and audit detail. |
| ConfirmDialog | Used for every destructive action (stop run, reject, revert lesson, clean worktree, restore snapshot). |

## 6. Keyboard shortcuts

Single-letter shortcuts are suppressed while focus is in any text input.
Sequences (two keys) follow a 1.5s timeout with an on-screen sequence indicator.

| Keys | Scope | Action |
|---|---|---|
| Cmd/Ctrl+J | Global | Open global chat and focus its input (the adoption-bar hotkey) |
| C | Global (no input focused) | New task: open the prompt-first create box |
| A | Global | Jump to the first Needs Attention task; repeat cycles through them |
| Cmd/Ctrl+K | Global | Command palette (tasks, screens, actions) |
| Cmd/Ctrl+Enter | Composer / create box | Send message / create task |
| Enter | Approval scope | Approve the pending permission or plan |
| Cmd/Ctrl+Enter | Approval scope | Deny with reason |
| J / K | Sidebar | Move task selection down / up |
| Enter | Sidebar | Open selected task |
| G then T / K / F / A / N / S | Global | Go to Tasks / Knowledge / Files / Audit / Notes / Settings |
| V then D / C / G | Task detail | Toggle Diff viewer / visual Compare / right rail |
| Y then P | Task detail | Copy the focused file's absolute path |
| Esc | Any overlay | Close dialog/panel; return focus to its invoker |
| Shift+/ (?) | Global | Keyboard shortcut help overlay |

The help overlay is generated from the shortcut registry so it can never drift from the bindings.

## 7. Accessibility requirements

**Landmarks and structure.**
- One `<nav>` (task sidebar, `aria-label="Tasks"`), one `<main>` (center pane), one `<aside>` (right rail, `aria-label="Task context"`), one `<header>` (top bar); a skip-to-main link is the first focusable element.
- Sidebar groups are headed lists; plan steps are an ordered list with `aria-current="step"` on the in-progress step.
- Collapsible sections use real `<button>` headers with `aria-expanded` and `aria-controls`.

**Focus management for streaming panels.**
- Streaming output regions use `role="log"` with `aria-live="polite"`; announcements are batched (at most one per 2 seconds) so screen readers are not flooded.
- New stream content never moves keyboard focus.
- A new permission prompt or plan-approval card fires a single assertive announcement ("Permission requested for task X") and is reachable via the `A` hotkey; focus moves only on explicit user action.
- Dialogs trap focus and restore it to the invoking element on close; the janitor dialog is a proper `role="dialog"` with labelled title.
- The cost ticker is `aria-hidden` except for a per-minute polite summary, so it cannot spam assistive tech.

**Reduced motion.**
- Under `prefers-reduced-motion: reduce`: running-dots and spinners become static badges, smooth scrolling becomes instant, progress bars update without shimmer, and the overlay-compare swipe animates without easing.
- Auto-scroll pin-to-bottom still functions; only the animation is removed.

**Perception and input.**
- WCAG 2.2 AA: text contrast >= 4.5:1, UI component contrast >= 3:1, target size >= 24px.
- No state is conveyed by color alone: diff adds/removes carry +/- signs, gate results carry glyphs and text, `command` vs `heuristic` badges differ in shape and label, not just hue.
- Full keyboard operability for every interaction in section 6 and every mouse affordance; visible focus indicators throughout.
- All icon-only buttons have `aria-label` and tooltips; images in visual compare have alt text naming their source (Figma snapshot vs rendered story).

## 8. Streaming and state-freshness rules

- Run events stream over SSE per run; the client applies them to a single in-memory run model that all panels (Plan panel, stream, diff strip, sidebar row) derive from, so no two surfaces can disagree.
- On disconnect: exponential backoff (1s, 2s, 4s, 8s cap), a visible reconnecting note, and replay from the persisted run JSONL on reconnect; no event is rendered twice.
- Sidebar status, Plan panel phase, and composer mode must transition within one event of each other; there is no polling in the task detail path.
- Multiple concurrent runs each hold their own SSE connection; the sidebar consumes a lightweight multiplexed status stream instead of every run's full firehose.

## 9. Out of scope for v1 (explicit)

- Kanban board as navigation (alternate view later; attention-first sidebar is v1 navigation).
- Interactive embedded terminal (v1 terminal scope is read-only command output).
- Follow-up message queueing while running (v1 has steer and stop only).
- Editing files anywhere in the app (no embedded editor, ever, per spec).
- PR creation UI, Sitecore wiring automation, Confluence fetching (v2 candidates per spec).
