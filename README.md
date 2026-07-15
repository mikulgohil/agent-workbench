# Agent Workbench

A localhost-per-project developer workbench built on the Claude Agent SDK.
Create tasks, watch agents execute them in isolated git worktrees with real-time plan and progress visibility, review diffs and gates, and approve before anything is committed.
Team standardization is the core: knowledge, checklists, templates, audit, and QA handover packs live as plain files in a committed `.forge/` folder inside each target project repo - git is the database.

## Status: blueprint stage (no code yet)

All design and planning documents are complete; implementation has not started.

| Where | What |
|---|---|
| `docs/specs/` | The approved v1 product spec (source of truth) |
| `docs/blueprint/` | The full pre-coding documentation pack - start at `00-overview.md` |
| `docs/research/` | Prior-art report (Vibe Kanban, Crystal, Nimbalyst) |
| `docs/superpowers/plans/` | Step-level TDD implementation plan for phase 1 |

## Planned stack

Next.js (App Router), TypeScript strict, Tailwind v4, pnpm, `@anthropic-ai/claude-agent-sdk`, vitest, Playwright CLI.
No database and no server: state is plain files, synced through git.

## How implementation will start

1. Read `docs/blueprint/00-overview.md` for orientation and reading order.
2. Execute `docs/superpowers/plans/2026-07-15-phase-1-shell-and-state.md` task-by-task (TDD, commit per task).
3. Phase 2 is gated on the worktree install-cost spike defined in `docs/blueprint/08-roadmap.md`.
