# 08 - Roadmap: Phases 2-5

This roadmap expands the spec's "Suggested build order" (docs/specs/2026-07-15-agent-workbench-v1-design.md) into phase-level objectives, deliverables, entry and exit criteria, and risks.
Phase 1 (shell + state + simulator) is fully planned in docs/superpowers/plans/2026-07-15-phase-1-shell-and-state.md and is not repeated here.

**Planning rule: each phase gets its own detailed implementation plan (same format as the Phase 1 plan, in docs/superpowers/plans/) written when that phase starts, not before.**
Writing detailed plans early would freeze decisions the previous phase is still allowed to change, so this document deliberately stays at the objective/criteria level.

Each phase is independently demoable; a phase is not done until its exit criterion can be shown live.

---

## Phase 2 - Real execution core

### Objective

Replace the simulator with real Agent SDK sessions running in isolated git worktrees, with full capability parity to terminal Claude Code and permission-gated Bash, while keeping the simulator seam intact for tests and demos.

### Key deliverables

- Worktree lifecycle: `git worktree add <cache>/worktrees/<project-hash>/<ticket-id> -b forge/<ticket-slug>`, removal on approve/reject, WIP commit on interrupt or mid-run failure.
- Prepare phase: dependency install in the fresh worktree, run concurrently with the agent's planning phase, with its own visible status.
- Agent SDK sessions with session parity: project CLAUDE.md, `.claude/skills/`, configured MCP servers, plus `.forge/knowledge/` and template context on top.
- Permission-gated Bash: allowlist from `.forge/config.json`, real-time approval prompts in the run view, every command audited.
- Real SSE streaming of SDK events into the existing RunEvent protocol (the Phase 1 reducer, panel, and SSE route stay as they are; only the event source changes behind the seam).
- Interrupt (AbortController + WIP commit), steer (streaming input into the running session), resume (run state persisted in the ticket's run JSONL), and the janitor for orphaned worktrees and dead sessions on launch.
- Gates + gate-feedback loop: `execFile` against configured script names, failure output fed back via session resume, max 3 iterations, projected retry cost shown before iteration 2.
- Approval/rejection commits on the ticket branch; split transcript storage (full transcript gitignored under `.forge/local/runs/`, sanitized summary committed under the ticket).
- Cost tracking from real token usage, per-developer monthly budget warnings.
- Plan-then-approve flow for templates that require it.
- Deny-read glob enforcement on agent tools.

### Entry criteria

- Phase 1 exit checklist is fully green (shell, forge store, simulator loop, SSE, Plan & Progress panel, Playwright smoke).
- **Worktree-install spike gate (mandatory, before any Phase 2 build work):** measure `git worktree add` + dependency install + Storybook boot cost on a real target repo (a real team project, not a toy fixture), with and without the pnpm shared store.
  The spike produces a short doc in docs/research/ with the numbers and one of two verdicts: proceed as designed, or proceed with a named mitigation (deeper install/planning overlap, warm worktree pool, or persistent worktrees per ticket type).
  If a fresh worktree cannot be ready inside roughly the agent's planning window, the prepare-phase design must be revised before implementation starts.
- `ANTHROPIC_API_KEY` available for local manual verification (never wired into CI).

### Exit criteria (demoable)

- A real ticket run: create a bug-fix ticket against a scratch project, watch the real agent work in the live panel, approve a non-allowlisted Bash command from the UI, see real gate results, interrupt and resume a run, and end with a local commit on a `forge/<slug>` branch - all without opening an editor.
- Two tickets run concurrently in separate worktrees without touching each other or the developer's working tree.
- The vitest suite and Playwright e2e still run fully offline on the simulator.

### Main risks

- Worktree preparation cost destroys the real-time feel (this is why the spike gates the phase).
- Agent SDK session parity gaps (skills or MCP servers that load in terminal Claude Code but not through the SDK) erode the "superset, never subset" promise; verify parity explicitly during manual testing.
- Permission prompt UX latency: a run blocked on an unnoticed prompt looks like a hang; the Needs Attention group and visible pause state must land together with the prompts.
- Windows + git worktree edge cases; schedule the explicit Windows pass inside this phase, not after it.

---

## Phase 3 - Review surfaces

### Objective

Give reviewers everything they need to judge a ticket's output inside the app: diff, running Storybook from the ticket branch, checklists, and the audit trail.

### Key deliverables

- Read-only diff viewer (ticket branch vs base) rendered in-app.
- Storybook-in-worktree: the project's Storybook script started inside the ticket's worktree, embedded or linked, with the worktree kept alive until the approve/reject decision and a Storybook instance queue to bound resource use.
- Checklists: template checklist rendered as todos, command-backed items auto-checked from gate results, manual items checked by the developer.
- Audit log: append-only `.forge/audit/<YYYY-MM>.jsonl` events for every file-modifying action, with user, ISO timestamp, ticket id, event type, detail, and app version; Audit page with user/ticket/date filters.
- Run inspector: filtered views over the local full transcript (file edits, commands, permission decisions) for the person who ran the session.
- Copy-path and open-in-editor (`vscode://`) affordances on every file reference.

### Entry criteria

- Phase 2 exit criteria met: real runs produce branches, commits, gate results, and run summaries to review.
- `.forge/config.json` carries a working Storybook script name for the pilot project.

### Exit criteria (demoable)

- A completed ticket can be fully reviewed in-app: open the diff, open the story rendered from the ticket branch, tick the manual checklist items, and see the whole ticket history in the audit page.

### Main risks

- Storybook boot time in a worktree repeats the Phase 2 install-cost problem in a second place; reuse the spike data and the instance queue.
- Diff rendering for large changes (performance and readability); cap rendered file size with an explicit open-in-editor escape hatch.
- Audit completeness drift: new mutating actions added in later phases must be caught by a checklist rule ("every new mutation emits an audit event") rather than memory.

---

## Phase 4 - Figma workflow

### Objective

Make the flagship figma-to-component flow real: reproducible design snapshots, mapping-driven generation, and visual verification against the design.

### Key deliverables

- Figma context snapshot at ticket creation via the Figma REST API with the developer's personal token (stored in `~/.agent-workbench/config.json`, never in any project repo): node screenshots, extracted variables/tokens, component structure, written into the ticket's `attachments/`.
- `design-system.json` mapping (Figma variables to code tokens, Figma components to code components) plus the in-app mapping editor.
- The figma-to-component template: required inputs, default checklist (including the manual Sitecore wiring reminder), plan-then-approve ON by default, and refuse-to-run-without-mapping with a helpful setup path.
- Visual compare: Playwright CLI screenshot of the rendered story side-by-side and overlaid with the Figma snapshot image.
- Test suggestion button: an LLM pass over the generated component + mapping proposing component-specific test cases appended to the ticket checklist.

### Entry criteria

- Phase 3 exit criteria met (Storybook-in-worktree and checklists exist, because visual compare and the template checklist build on them).
- A pilot project with a real design system and a Figma file the team owns, plus a developer Figma token, are available for end-to-end validation.
- An initial `design-system.json` for the pilot project has been authored with the design team's input.

### Exit criteria (demoable)

- The spec's headline success criterion: create a figma-to-component ticket from a real Figma node, approve the agent's plan, watch it build the component and story, see real gates pass, compare the rendered story against the Figma snapshot visually, and approve to get a local commit.

### Main risks

- Figma fidelity depends entirely on `design-system.json` being complete and maintained; the refuse-to-run rule forces the setup conversation early but does not keep the file current.
- Figma REST extraction quality varies with how the design file is structured; validate against the team's actual files early, not sample files.
- Visual compare false confidence: a pixel-close screenshot does not prove responsive or interactive correctness; the checklist must carry the manual verification items.

---

## Phase 5 - Knowledge and chat

### Objective

Close the standardization loop: automatic guarded learning, unrestricted global chat with audit-backed auto-tickets, QA handover packs, and the remaining project surfaces.

### Key deliverables

- Learning system: post-run reflection call extracting candidate lessons; append to `.forge/knowledge/lessons.md` with provenance blocks; write-time dedupe and hard cap; lessons feed with one-click revert; "consolidate knowledge" maintenance pass reviewed as a diff.
- Global chat with the same tool access and permission gating as ticket runs, running against the developer's working tree; safety snapshot (git stash) before the first file edit with one-click restore.
- Chat auto-tickets: any file-modifying chat auto-creates a `generic` ticket record (record only: no branch, no worktree, no approval), shown in the separate Chat activity lane.
- QA handover pack generated on ticket completion: change summary, files changed, how to see it, gate results, checklist state, remaining manual todos, visual compare screenshots.
- File explorer (read-only, gitignore-respecting, "create ticket from this file"), per-user notes over `.forge/local/notes/`, project.md editor, sync indicator for unpushed `.forge/` changes.

### Entry criteria

- Phase 2 exit criteria met (chat reuses sessions, permissions, audit, and cost tracking); Phase 3 audit log exists (auto-tickets and lessons must be audited).
- Handover pack generation additionally needs Phase 4's visual compare artifacts to include screenshots; if Phase 4 slips, handover ships without the screenshot section rather than blocking.

### Exit criteria (demoable)

- The full team story: a quick fix through global chat (hotkey, type, go) lands as an audited auto-ticket; a correction the developer made during a run appears as a lesson with provenance and can be reverted; a completed ticket produces a QA handover pack without manual writing; a new developer clones the pilot project and sees every lesson and checklist.

### Main risks

- Auto-learning quality: a bad lesson propagates to every developer until noticed; provenance, feed visibility, revert, and the cap are mitigations, not guarantees - monitor the lessons file during the pilot.
- The adoption bar lives or dies here: if global chat has more friction than terminal Claude Code, the app fails its own success criterion regardless of features; measure the open-app-to-first-token time explicitly.
- Reflection-call cost creep across many small runs; keep the reflection model cheap and the trigger conditions narrow.
