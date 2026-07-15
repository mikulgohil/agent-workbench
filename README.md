# Agent Workbench

A localhost-per-project developer workbench built on the Claude Agent SDK.
Create tasks, watch agents execute them in isolated git worktrees with real-time plan and progress visibility, review diffs and gates, and approve before anything is committed.
Team standardization is the core: knowledge, checklists, templates, audit, and QA handover packs live as plain files in a committed `.forge/` folder inside each target project repo - git is the database.

## Status: Phase 1 complete, Phase 2 planned

Phase 1 (shell, `.forge/` state, deterministic simulator, full create -> live SSE panel -> review loop) is implemented, reviewed, and merged to `main`.
Phase 2 (real Agent SDK execution, worktrees, permissions, gates) has a complete implementation plan but has not been built yet - see "How to continue" below.

| Where | What |
|---|---|
| `docs/specs/` | The approved v1 product spec (source of truth) |
| `docs/blueprint/` | The full pre-coding documentation pack - start at `00-overview.md` |
| `docs/research/` | Prior-art report, plus the phase-2 worktree install-cost spike |
| `docs/superpowers/plans/` | Step-level TDD implementation plans, one file per phase |
| `docs/progress-log.md` | Session-by-session log of what happened and why |

## Stack

Next.js (App Router), TypeScript strict, Tailwind v4, pnpm, `@anthropic-ai/claude-agent-sdk` (added in phase 2), vitest, Playwright CLI.
No database and no server: state is plain files, synced through git.

## Try it

```bash
pnpm install
FORGE_PROJECT_DIR=<any scratch git repo> pnpm dev
```

Create a task from the prompt box; a generic ticket runs against the deterministic simulator (no API key needed) and streams live into the Plan & Progress panel.

## How to continue

1. Read `docs/progress-log.md` for the most recent session's summary and any open decisions.
2. Phase 2's plan is `docs/superpowers/plans/2026-07-16-phase-2-real-execution-core.md` - read its header first, including the "known gaps" section near the end.
3. **Before running any of Phase 2's tasks past Task 4, note that Tasks 5+ spawn real Agent SDK sessions against a real `ANTHROPIC_API_KEY` and spend real money** - the plan marks exactly which manual-verification steps require you to be present; do not let an agent run those unattended.
