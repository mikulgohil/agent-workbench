# Prior-art report: Vibe Kanban and Crystal (+ Nimbalyst)

Date: 2026-07-15.
Method: cloned both repos, inspected LICENSE / package.json / README / Cargo workspace directly, checked GitHub API for releases and activity, fetched the official shutdown notice.
Everything below is verified from primary sources unless marked otherwise.

## 1. Vibe Kanban (github.com/BloopAI/vibe-kanban)

**License: Apache 2.0** (verified from LICENSE file).
Free for any use including commercial; cloning, forking, and modifying are all permitted.

**Status.**
Bloop (the company) shut down on 2026-04-10.
Cloud features (kanban issue sync, comments, projects, organisations) were switched off 30 days later, so they are already gone.
Local workspaces officially continue to work.
The project was promised as "community maintained," but the last push and last npm publish are both 2026-04-24 - no community activity has materialized in almost 3 months.
Treat it as frozen.

**Using it for free (no build).**
- `npx vibe-kanban` - the npm CLI (v0.1.44, published 2026-04-24) downloads a prebuilt platform binary. Only dependency: **Node >= 20**.
- Windows MSI installers (arm64 + x64) on the GitHub release page.
- You also need a coding agent installed and authenticated on the machine (Claude Code, Codex, Gemini CLI, Copilot, Amp, Cursor CLI, etc.) - Vibe Kanban is a cockpit, not an agent.

**Building from source (for a fork).**
- Toolchain: **Rust (stable), Node >= 20, pnpm >= 8**.
- The codebase is large: 30+ Rust crates (server, executors, git, worktree-manager, mcp, review, plus a whole `relay-*` family for the now-dead cloud sync) and a TypeScript frontend, plus a Tauri desktop app.
- Forking means owning a big Rust codebase with dead cloud subsystems to amputate - a poor fit for a TypeScript-focused team.

**What it proves for us.**
Its core loop (kanban issue → agent workspace with branch/terminal/dev server → inline diff review → PR) matches our ticket concept and validated it with ~27k stars.
Worth one evaluation day purely to steal UX lessons.

## 2. Crystal (github.com/stravu/crystal)

**License: MIT** (verified).
Free, cloneable, forkable.

**Status: deprecated February 2026.**
The README now redirects to its successor, Nimbalyst.
Final release: v0.3.5 (2026-02-26).

**Using it for free (no build).**
- Prebuilt binaries on the release page: macOS universal DMG, Linux .deb / .AppImage.
- **No Windows build in the final release** - a problem for a mixed-OS team.
- Requires Claude Code (or Codex) CLI installed and authenticated.

**Building from source.**
- Toolchain: **Node >= 22.14, pnpm >= 8**; it is an Electron 37 app.

**Verdict: dead end.**
Do not adopt a deprecated app when its direct successor is alive and free.

## 3. Nimbalyst (github.com/Nimbalyst/nimbalyst) - the important finding

Correction to the earlier market scan: Nimbalyst is **not** commercial.
It is **MIT-licensed, free, open source, and very actively developed** - v0.68.1 released 2026-07-10, repo pushed the day of this report, 1.2k stars.

**Platforms.**
macOS (arm64 DMG), Windows (x64 + arm64 .exe - verified in release assets), Linux (AppImage), plus an iOS/Android companion app with push notifications.

**Dependencies to use it: none beyond the installer** plus an authenticated agent CLI (Claude Code, Codex, OpenCode alpha, Copilot alpha).

**What it already covers from our spec (verified from README):**
- Session kanban and parallel sessions.
- Git worktree isolation, git management, AI commit, embedded terminal.
- Task tracking where agents and humans both edit tasks.
- Red/green WYSIWYG diff approval, markdown/mockup/Mermaid/Excalidraw/CSV/Monaco editors.
- **Open plain-file storage on disk or in git** - philosophically the same "git as database" bet our spec makes.
- An extension system (`EditorHost` contract) where custom editors are first-class.
- Mobile: reply to agent questions, swipe-review diffs, queue tasks, push notifications.

**What it does NOT cover (our differentiators, unchanged):**
- Figma snapshot → design-token mapping → Next.js + Storybook pipeline and visual compare.
- Per-task-type templates and checklists that gate agent work.
- Auto-learning team knowledge with provenance/revert.
- Per-user audit log.
- QA handover pack generation.

## Decision impact

Both requested options are free and cloneable; dependencies are minor for use (Node 20+ for `npx vibe-kanban`; nothing but the installer for Crystal/Nimbalyst binaries) and heavier for forking (Rust toolchain for Vibe Kanban; Electron/Node 22 for Crystal).
But the real build-vs-adopt question is now about **Nimbalyst**, which is alive, free, MIT, cross-platform, and overlaps a large share of our cockpit scope.

Three options, in rough order of least-to-most build effort:
1. **Adopt Nimbalyst as the cockpit** and build only the standardization layer (Figma pipeline, checklists, knowledge, audit, QA handover) - either as Nimbalyst extensions or as a thin companion tool writing to the same repo.
2. **Build Agent Workbench as specced**, using an evaluation day with Nimbalyst + `npx vibe-kanban` to steal UX patterns first.
3. **Fork Vibe Kanban** - ruled out: frozen upstream, large Rust codebase, dead cloud subsystems.

Recommended next step: a 1-day hands-on evaluation of Nimbalyst against a real project before committing to the from-scratch build.
