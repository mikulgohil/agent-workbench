# Agent Workbench

A localhost-per-project developer workbench built on the Claude Agent SDK.

Create a task in plain language, watch an agent execute it in an isolated git worktree with real-time plan and progress visibility, review the diff and quality gates, and approve before anything is committed.
Team standardization is the whole point: knowledge, checklists, templates, audit trails, and run summaries all live as plain files in a committed `.forge/` folder inside each target project repo - **git is the database.** No server to run, no database to host, nothing to sign into.

> Built from scratch as an engineering exercise in agent orchestration, permission-gated tool use, and git-native state.
> Design and prior-art (vibe-kanban) are credited in `docs/`.

---

## Screenshots

Create a task from a prompt - a ticket is created and a run streams live:

![Create a task](docs/screenshots/01-home-create-task.jpg)

The Plan & Progress panel streams the agent's todos, tool calls, cost, and quality gates in real time:

![Live plan and progress](docs/screenshots/02-live-plan-progress.jpg)

Every action is on the record - the raw event stream, and an explicit approve/reject decision before anything lands:

![Event stream and review](docs/screenshots/03-event-stream-and-review.jpg)

> These are captured against the built-in deterministic **simulator** (no API key, no spend), which emits the exact same event protocol the real Agent SDK engine produces - so the UI is identical whether a run is real or simulated.

---

## Why this exists

Terminal coding agents are powerful but lonely: each developer runs them their own way, the work is invisible until a PR appears, quality checks are ad-hoc, and nothing a teammate learned yesterday reaches you today.

Agent Workbench turns an agent from a personal terminal habit into a **team-standardized, reviewable workflow**, without adding infrastructure:

- **Visible** - see the agent plan and work step by step, live, instead of staring at a spinner.
- **Safe** - the agent works in an isolated worktree; nothing touches your working tree, and nothing commits without your approval.
- **Gated** - every non-allowlisted Bash command pauses for a real-time permission decision; quality gates run automatically and feed failures back to the agent for a bounded fix loop.
- **Standardized** - knowledge, checklists, and templates are committed files, so the whole team inherits the same guardrails just by cloning the repo.
- **Auditable** - every file-modifying action is appended to a committed audit log, and every run produces a sanitized, committed summary.

---

## Key features

- **Prompt-to-task** creation with a live kanban of runs (Needs Attention / Running / Review / Idle).
- **Real Agent SDK execution** in isolated `git worktree`s, with full session parity to terminal Claude Code (project `CLAUDE.md`, `.claude/skills/`, configured MCP servers) plus `.forge/` knowledge on top.
- **Real-time streaming** of the run over SSE: plan/todos, tool calls, messages, cost, and phase transitions.
- **Permission-gated Bash** - an allowlist from `.forge/config.json`, with a real-time approve / always-allow / deny prompt in the UI for anything else, and every decision audited.
- **Quality gates with a feedback loop** - configured scripts (typecheck, lint, test, ...) run after the agent; on failure the agent is resumed with the failure output fed back, up to 3 fix iterations, with a projected-cost checkpoint before the second attempt.
- **Interrupt, steer, and resume-detection** for live runs.
- **Approve / reject** - the app's own commit is the sole authority for what lands on a `forge/<slug>` branch; nothing is committed to your tree without a decision.
- **Cost tracking** per run, accumulated across the whole fix loop.
- **Sanitized, committed run summaries** (`RunSummary`) plus a gitignored full local transcript - split so the committed half never contains file contents or diffs.
- **Deterministic simulator seam** - the entire UI, reducer, SSE pipeline, and E2E suite run fully offline and token-free, so tests and demos never spend money.

---

## How it works

```
Your terminal ──> pnpm dev (Next.js App Router, localhost)
                      │
                      ▼
        FORGE_PROJECT_DIR ──> a target git repo
                      │
                      ├── .forge/            (committed - the "database")
                      │     ├── config.json        gates, allowlist, scripts
                      │     ├── tickets/<id>/       ticket + committed run summaries
                      │     ├── knowledge/          lessons, project facts
                      │     ├── audit/<YYYY-MM>.jsonl   append-only audit log
                      │     └── local/runs/         full transcripts (gitignored)
                      │
                      └── worktrees/<ticket>/  (isolated checkout the agent works in)
```

- **No database, no backend service.** All shared state is plain files under `.forge/`, versioned and synced through git alongside the code it describes.
- **The engine seam** (`isRealEngineAvailable()`) picks the real `@anthropic-ai/claude-agent-sdk` engine when an `ANTHROPIC_API_KEY` is present, and the deterministic simulator otherwise - both emit the identical `RunEvent` protocol, so nothing downstream knows or cares which ran.
- **Isolation by worktree** - each ticket runs in its own `git worktree` on a `forge/<slug>` branch, so concurrent tickets never touch each other or your working tree.

---

## Use cases

- **Standardize a team's frontend component work** - the flagship flow (planned Phase 4): a Figma node in, a mapped design-system component + Storybook story + passing gates out, visually compared against the design, one click to approve.
- **Delegate well-scoped tickets** - "add validation to this form", "extract this hook", "write tests for this module" - and review the result as a diff instead of pair-driving the terminal.
- **Onboard the agent to your standards once** - put conventions in `.forge/knowledge/` and a checklist in the template; every developer's runs inherit them from the repo.
- **Keep an audit trail** - for teams that need to show who changed what, when, and why an agent touched a file, without bolting on separate tooling.
- **Run quality-gated fixes** - point it at a failing gate and let the bounded feedback loop attempt a fix, with a cost checkpoint so it never runs away.
- **Demo agent workflows safely** - the simulator gives a pixel-identical, deterministic, zero-cost run for demos, tests, and CI.

---

## Getting started

```bash
pnpm install

# Offline demo mode - deterministic simulator, no API key, no spend:
FORGE_PROJECT_DIR=<any scratch git repo> pnpm dev
# open http://localhost:3000 and type a task into the prompt box

# Real execution - spends real Anthropic credits, so run it yourself, present:
FORGE_PROJECT_DIR=<your project> ANTHROPIC_API_KEY=sk-ant-... pnpm dev
```

`FORGE_PROJECT_DIR` points the workbench at the target repo it should operate on.
With no `ANTHROPIC_API_KEY`, runs use the simulator; with a key, runs spawn real Agent SDK sessions.

Quality commands:

```bash
pnpm test        # vitest unit suite (offline)
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm e2e         # Playwright smoke (offline, simulator-driven)
```

---

## Roadmap

The product is planned in five independently-demoable phases (`docs/blueprint/08-roadmap.md`).
The real-execution core is complete and merged; the review, Figma, and knowledge surfaces are next.

| Phase | Scope | Status |
|---|---|---|
| **1 - Shell + state + simulator** | Kanban shell, `.forge/` state model, deterministic simulator, live SSE Plan & Progress panel, review loop | ✅ **Done** |
| **2 - Real execution core** | Agent SDK sessions in worktrees, permission-gated Bash, real SSE streaming, interrupt / steer / resume, cost tracking, audit log, gate-feedback loop, sanitized run summaries | ✅ **Done** |
| **3 - Review surfaces** | In-app diff viewer, Storybook-in-worktree, template checklists, audit page, run inspector, open-in-editor | ⏳ Planned |
| **4 - Figma workflow** | Figma snapshot at ticket creation, `design-system.json` mapping, the figma-to-component template, plan-then-approve, visual compare | ⏳ Planned |
| **5 - Knowledge + chat** | Auto-learning with provenance, unrestricted global chat with the same gating, chat auto-tickets, QA handover packs, file explorer | ⏳ Planned |

Known follow-ups carried forward (documented, not blocking): a template system that unlocks plan-then-approve and the command-vs-heuristic gate split; populating `RunSummary.commandsRun`; auditing worktree removal; a real resume-across-restart for a paused run.
See the per-phase plans in `docs/superpowers/plans/` and the "Known gaps" sections there.

---

## Tech stack

- **Next.js** (App Router) + **React 19** + **TypeScript** (strict).
- **Tailwind CSS v4**.
- **pnpm**.
- **`@anthropic-ai/claude-agent-sdk`** (pinned) for real execution.
- **vitest** for unit tests, **Playwright** (CLI) for E2E.
- No database, no ORM, no backend service - state is files, synced through git.

---

## Project layout & docs

| Where | What |
|---|---|
| `src/` | The Next.js app: run manager, engine seam, permission broker, gates, `.forge/` store, UI |
| `docs/specs/` | The approved v1 product spec (source of truth) |
| `docs/blueprint/` | The full pre-coding documentation pack - start at `00-overview.md`; roadmap is `08-roadmap.md` |
| `docs/research/` | Prior-art report and the worktree install-cost spike |
| `docs/superpowers/plans/` | Step-level TDD implementation plans, one per phase |
| `docs/progress-log.md` | Session-by-session log of what was built and why |
| `docs/screenshots/` | The images in this README |

---

## Status

Phases 1 and 2 (including the gate-feedback loop and run summaries) are implemented, reviewed, and merged to `main`; the full offline suite is green.
The one piece exercised only against mocks is a live, funded-key end-to-end run of the gate-feedback loop - the automated suite covers its logic against the deterministic simulator and a mocked SDK.
