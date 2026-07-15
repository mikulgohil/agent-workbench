# Agent Workbench - blueprint overview

This folder is the complete pre-coding documentation pack for Agent Workbench.
Read this file first; it orients you and gives the reading order.

## What we are building

Agent Workbench is a localhost-per-project developer workbench built on the Claude Agent SDK.
Developers create tasks (prompt-first, with opt-in templates such as figma-to-component); agents execute them in isolated git worktrees with real-time plan/progress/checklist visibility, permission-gated Bash, and real quality gates.
Everything shared lives as plain files in a committed `.forge/` folder inside each target project repo - git is the database; there is no server and no cloud.
The differentiating layer is team standardization: versioned knowledge that auto-learns lessons, per-task-type checklists, per-user audit, QA handover packs, and a Figma design-system mapping pipeline.
Market research confirmed no existing tool ships that layer (see `../research/2026-07-15-prior-art-vibe-kanban-crystal.md`).

## Who it is for

Developers only in v1.
The happy path is editor-free; opening VS Code for the hard 10% is expected (copy-path and `vscode://` links everywhere).
QA does not use the app; the app generates a handover pack for them.

## The twelve locked decisions

1. Users are developers; the editor is optional, not forbidden.
2. Tickets are execution units with an optional free-text Jira reference; never a PM tool.
3. Shared state lives in committed `.forge/`; per-user state in gitignored `.forge/local/`.
4. Learning is fully automatic, guarded by provenance, a visible lessons feed, one-click revert, and pruning.
5. Sitecore wiring automation is v2; a checklist item keeps the manual step visible.
6. QA gets a generated handover pack; QA are not users.
7. Projects have a proper Figma design system; a per-project mapping file drives token and component mapping.
8. Global chat is unrestricted; any chat that modifies files auto-creates a ticket record.
9. Fresh app; architecture patterns ported deliberately from the Forge reference app (se-agent-platform).
10. The agent gets permission-gated Bash everywhere: allowlist plus real-time UI approval prompts, fully audited.
11. Split transcript storage: full transcripts stay local and gitignored; only sanitized summaries are committed.
12. Session parity: sessions load the project's CLAUDE.md, skills, and MCP servers, so the app's agent is a superset of terminal Claude Code.

## Document map and reading order

| # | Document | What it covers |
|---|---|---|
| - | `../specs/2026-07-15-agent-workbench-v1-design.md` | The approved product spec - source of truth |
| 00 | `00-overview.md` | This file |
| 01 | `01-architecture.md` | System shape, layers, seams, module layout, SSE design |
| 02 | `02-agent-sdk-guide.md` | Verified Claude Agent SDK integration guide - the correctness-critical doc |
| 03 | `03-vibe-kanban-learnings.md` | Code-grounded steal/avoid list from the Vibe Kanban evaluation |
| 04 | `04-forge-format.md` | Normative `.forge/` file-format specification |
| 05 | `05-data-model.md` | Canonical TypeScript domain model - all other docs defer to it |
| 06 | `06-execution-model.md` | Run lifecycle, worktrees, gates, permissions, state machine |
| 07 | `07-ui-spec.md` | Every screen, panel, state, and interaction for v1 |
| 08 | `08-roadmap.md` | Phases 2-5 with entry/exit criteria |
| 09 | `09-testing-strategy.md` | Test pyramid, simulator seam, CI shape |
| - | `../superpowers/plans/2026-07-15-phase-1-shell-and-state.md` | The step-level TDD implementation plan for phase 1 |

Suggested reading order for a new contributor: spec, 00, 01, 05, 04, 06, 02, 07, 03, 09, 08, then the phase-1 plan.

## Precedence rules

The spec wins over every blueprint doc.
Within the blueprint, `05-data-model.md` is canonical for names and shapes; other docs and the phase-1 plan defer to it.
Judgment calls made where the spec was silent are marked inline with `Decision:` so reviewers can grep them.

## Status

Blueprint complete; no application code exists yet.
Implementation starts with the phase-1 plan, executed task-by-task with review between tasks.
Phase 2 is gated on the worktree install-cost spike defined in `08-roadmap.md`.
