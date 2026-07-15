# Vibe Kanban learnings - what to steal, what to avoid

Date: 2026-07-15.
Source: hands-on code reading of the full Vibe Kanban clone at `/Users/mikulgohil/Developer/learning/experiments/vibe-kanban` (Apache-2.0, frozen since 2026-04-24; see `docs/research/2026-07-15-prior-art-vibe-kanban-crystal.md`).
Every claim below cites an exact file path in the clone.
Nothing in the clone was modified.

## 1. Codebase orientation

- Frontend: `packages/web-core` (all screens, features, stores), `packages/ui` (presentational components), `packages/local-web` (the local app shell with TanStack Router file-based routes), `packages/remote-web` (the dead cloud frontend).
- Backend: 30+ Rust crates under `crates/`; the ones relevant to us are `crates/executors`, `crates/worktree-manager`, `crates/workspace-manager`, `crates/services`, `crates/db`, and `crates/local-deployment`.
- A large `relay-*` family plus `crates/remote` is the dead cloud/remote subsystem (section 9).

## 2. Screen inventory and routing

The local app's full screen inventory is the route file list in `packages/local-web/src/routes/`:

- `index.tsx`, `onboarding.tsx`, `onboarding_.sign-in.tsx` - entry and onboarding.
- `_app.workspaces.tsx`, `_app.workspaces_.$workspaceId.tsx`, `_app.workspaces_.create.tsx` - the workspaces surface (the real daily driver).
- `_app.projects.$projectId.tsx`, `_app.projects.$projectId_.issues.$issueId.tsx` and variants - cloud project/issue screens.
- `_app.hosts.$hostId.workspaces*.tsx` - remote-host variants of every workspace route (dead relay feature).
- `_app.export.tsx`, `_app.notifications.tsx`, `workspaces.$workspaceId.vscode.tsx`.

The router is TanStack Router with a generated route tree (`packages/local-web/src/app/router/index.ts` imports `routeTree.gen`).
Notable: almost half the route surface exists twice (plain and `hosts.$hostId.` prefixed) purely to support the dead remote-relay feature - a concrete cost of the cloud subsystem leaking into routing.

**Learning for us.** Keep one route per surface; our route map (see `07-ui-spec.md` section 2) has no host/remote dimension.
**Learning for us.** VK's kanban board is not the daily navigation: the cloud issue/kanban screens were retired outright (`packages/web-core/src/pages/kanban/ProjectSunsetPage.tsx` renders "Project functionality has been retired... kanban, issue, and workspace flows are no longer available here"), while the workspaces sidebar flow survives.
This validates our spec's call that attention-first sidebar grouping is the primary navigation and kanban is a later alternate view.

## 3. Workspace view composition (the three-pane layout)

`packages/web-core/src/pages/workspaces/WorkspacesLayout.tsx` composes the whole workspace screen:

- Left sidebar: fixed `w-[300px]`, rendering `WorkspacesSidebarContainer` (line 421-425).
- Center: a `react-resizable-panels` `Group` with `left-main` (conversation) and `right-main` panels, separated by a draggable `Separator`; the right-main panel hosts one of three modes.
- Right sidebar: fixed `w-[300px]`, rendering `RightSidebar` (line 405-413).
- The right-main modes are defined in `packages/web-core/src/shared/stores/useUiPreferencesStore.ts` lines 6-9: `RIGHT_MAIN_PANEL_MODES = { CHANGES: 'changes', LOGS: 'logs', PREVIEW: 'preview' }`.
- Pane sizes persist via `usePaneSize(PERSIST_KEYS.rightMainPanel, 50)` with a 150ms debounce on layout change (`WorkspacesLayout.tsx` lines 174-205).

`packages/web-core/src/pages/workspaces/RightSidebar.tsx` stacks collapsible sections: Git (`GitPanelContainer`), Terminal (`TerminalPanelContainer`, only when visible), Notes (`WorkspaceNotesContainer`), plus a mode-dependent top section (file tree for Changes, process list for Logs, dev-server controls for Preview).
Every section uses `CollapsibleSectionHeader` with a named persist key (`PERSIST_KEYS.gitPanelRepositories`, `terminalSection`, `notesSection`), so each section's expansion survives reloads independently.
The Git panel shows per-repo `targetBranch`, `commitsAhead`, `commitsBehind` and push/rebase actions (`packages/ui/src/components/GitPanel.tsx` lines 11-13, 83-85).

The bottom composer is `packages/ui/src/components/SessionChatBox.tsx` and it carries the diff strip:

- Idle header-left shows the diff stat as a button: `{t('diff.filesChanged', { count: filesChanged })}` plus `+{linesAdded}` / `-{linesRemoved}` spans (lines 736-780), where `filesChanged_other` is `"{{count}} files changed"` (`packages/web-core/src/i18n/locales/en/tasks.json` lines 85-86); clicking it opens the changes view (`onViewCode`).
- While running, the same slot swaps to a spinner plus the current in-progress todo: `{isRunning && inProgressTodo ? <SpinnerIcon .../> {inProgressTodo.content} : ...}` (lines 706-710) - a micro Plan-panel embedded in the composer.
- Action buttons are status-driven (lines 504-576): idle shows Send; running shows Queue + Stop; queued shows Cancel queue + Stop; plus dedicated approval, ask-question, feedback, and edit modes.
- Diff stats flow from an isolated `ChatBoxWithDiffStats` leaf component so streaming diffs do not rerender the conversation list (`packages/web-core/src/pages/workspaces/WorkspacesMainContainer.tsx` lines 26-31, comment: "the parent ... no longer rerenders when diffs/comments/repos stream in").

**Steal.**
- The exact pane recipe (fixed 300px rails, resizable center, persisted sizes) matches our spec's three-pane layout; adopt it including per-section persist keys.
- The composer-owned diff strip and the running-todo swap; both are specified for our composer in `07-ui-spec.md` 4.4.5.
- The rerender isolation trick for streaming diff stats; our SSE-fed panels should isolate high-frequency subscriptions the same way.
- Scroll compensation: `WorkspacesMainContainer.tsx` lines 164-197 use a `ResizeObserver` on the composer to `adjustScrollBy(heightDelta)` only when pinned to bottom, so a growing input never yanks the stream viewport.
- Mobile tabs keep panels mounted with a `hidden` class instead of conditional rendering, with the comment "to preserve WebSocket connections and scroll positions across tab switches" (`WorkspacesLayout.tsx` lines 207-209).

## 4. Sidebar attention grouping

`packages/ui/src/components/WorkspacesSidebar.tsx` lines 217-233 contain the exact grouping logic:

```ts
const needsAttention = (ws: WorkspacesSidebarWorkspace) =>
  ws.hasPendingApproval || (ws.hasUnseenActivity && !ws.isRunning);
raisedHandWorkspaces: workspaces.filter((ws) => needsAttention(ws)),
idleWorkspaces: workspaces.filter((ws) => !ws.isRunning && !needsAttention(ws)),
runningWorkspaces: workspaces.filter((ws) => ws.isRunning && !needsAttention(ws)),
```

- The section labels are "Needs Attention" / "Running" / "Idle" (`packages/web-core/src/i18n/locales/en/common.json` lines 138-140), internally called "raised hand" (`WorkspacesSidebarPersistKeys.raisedHand`, lines 38-42).
- A running workspace with a pending approval renders a filled hand icon in place of the running dots (`packages/ui/src/components/WorkspaceSummary.tsx` lines 142-150).
- Rows carry name, running/failed/unseen indicators, PR badge, pin, relative time, and a right-aligned `filesChanged +linesAdded -linesRemoved` stat (`WorkspaceSummary.tsx` lines 200-211).
- The create draft renders as a pinned pseudo-row inside Needs Attention with a "Draft" label (`WorkspacesSidebar.tsx` lines 370-377, `WorkspaceSummary.tsx` lines 183-191), backed by a persisted scratch draft with a fixed UUID (`packages/web-core/src/pages/workspaces/WorkspacesSidebarContainer.tsx` lines 59-60, 551-569).
- Pinned workspaces always sort first (`WorkspacesSidebarContainer.tsx` lines 479-510); archived workspaces live behind a footer toggle with a count badge (`WorkspacesSidebar.tsx` lines 479-500).

**Steal.** The predicate shape (attention = pending human input OR unseen results, with running excluded), the draft-in-sidebar pattern, pin-first sorting, and the archive footer.
**Adapt.** We add two groups VK lacks: Review (run finished, awaiting approve/reject - VK folds this into "unseen activity") and the Chat activity lane; our precedence rules are in `07-ui-spec.md` 4.2.

## 5. How VK models workspace/session/task state

- Task status enum: `Todo, InProgress, InReview, Done, Cancelled` (`crates/db/src/models/task.rs` lines 14-21).
- Execution process status: `Running, Completed, Failed, Killed` (`crates/db/src/models/execution_process.rs` lines 42-47), with run reasons `SetupScript, CleanupScript, ArchiveScript, CodingAgent, DevServer` (same file, line 53).
- Tool status carries the approval state machine: `Created, Success, Failed, Denied { reason }, PendingApproval { approval_id }, TimedOut` (`crates/executors/src/logs/mod.rs` lines 124-137).
- Normalized conversation entries are a tagged enum: `UserMessage, UserFeedback { denied_tool }, AssistantMessage, ToolUse { tool_name, action_type, status }, SystemMessage, ErrorMessage, Thinking, Loading, NextAction, TokenUsageInfo, UserAnsweredQuestions` (`crates/executors/src/logs/mod.rs` lines 73-99).
- The hierarchy is workspace (worktree-backed attempt, evolved from "task attempt" - see `packages/web-core/src/shared/types/attempt.ts` referenced from `WorkspacesMainContainer.tsx` line 11) containing sessions (conversations), each session containing execution processes.
- The frontend sidebar model derives display flags per workspace: `isRunning, hasPendingApproval, hasUnseenActivity, latestProcessStatus, prStatus` (`packages/ui/src/components/WorkspacesSidebar.tsx` lines 22-36).

**Steal.** Separating ticket status from run status from tool status is exactly right; our ticket states, run phases, and permission states stay three separate enums.
**Steal.** `TokenUsageInfo { total_tokens, model_context_window }` drives a context gauge in the UI (`packages/ui/src/components/ContextUsageGauge.tsx` lines 6-9); a context-window gauge is a cheap, high-value addition to our Plan & Progress panel.

## 6. The executor abstraction - and why we do not need it

VK supports ~10 agent CLIs; `crates/executors/src/executors/` contains `amp.rs, claude.rs, codex.rs, copilot.rs, cursor.rs, droid.rs, gemini.rs, opencode.rs, qwen.rs, qa_mock.rs`.
They share one trait (`crates/executors/src/executors/mod.rs` lines 220-269):

```rust
pub trait StandardCodingAgentExecutor {
    async fn spawn(&self, current_dir: &Path, prompt: &str, env: &ExecutionEnv) -> Result<SpawnedChild, ExecutorError>;
    async fn spawn_follow_up(&self, ..., session_id: &str, reset_to_message_id: Option<&str>, ...) -> ...;
    fn normalize_logs(&self, raw_logs_event_store: Arc<MsgStore>, worktree_path: &Path) -> Vec<JoinHandle<()>>;
    fn default_mcp_config_path(&self) -> Option<PathBuf>;
    ...
}
```

The Claude executor (`crates/executors/src/executors/claude.rs`, 3,284 lines) shows the true cost of wrapping a CLI:

- It assembles the CLI invocation by hand: `"-p"`, `--permission-prompt-tool=stdio`, `--permission-mode=...`, then `"--verbose", "--output-format=stream-json", "--input-format=stream-json", "--include-partial-messages", "--replay-user-messages"` (lines 157-194).
- It spawns `claude` as a child process with piped stdin/stdout, then runs a hand-rolled control protocol over those pipes: `ProtocolPeer::spawn(child_stdin, child_stdout, client.clone(), cancel_for_task)` followed by `protocol_peer.initialize(hooks)` and `protocol_peer.set_permission_mode(...)` (lines 620-700, protocol in `crates/executors/src/executors/claude/protocol.rs` and `client.rs`).
- Permission gating is done by injecting PreToolUse hook JSON with regex matchers, e.g. `"matcher": "^(?!(Glob|Grep|NotebookRead|Read|Task|TodoWrite)$).*", "hookCallbackIds": ["tool_approval"]` (lines 236-245), bridged to a UI approvals service (`ExecutorApprovalService` in `crates/executors/src/approvals.rs`, implemented with timeout watchers in `crates/services/src/services/approvals.rs` lines 86-177).
- It parses stdout line by line into a giant tagged enum `ClaudeJson` (`System, Assistant, User, ToolUse, ToolResult, Result, ApprovalRequested, ControlRequest, RateLimitEvent, Unknown`, lines 2258+), via `serde_json::from_str::<ClaudeJson>(trimmed)` (line 811), extracting the session id from whichever variant carries it first (lines 813-817, 891-898).
- Session resume is stringly-typed CLI plumbing: `vec!["--resume".to_string(), session_id.to_string()]` plus `--resume-session-at` with tracked message UUIDs, where assistant UUIDs are held pending until a Result message confirms the turn completed (lines 360-380, 820-830).
- It even ships behavioral warnings as fake conversation entries, e.g. the `ANTHROPIC_API_KEY` billing warning injected as an `ErrorMessage` entry (lines 912-928).

**The learning: our Agent-SDK-native decision deletes this entire layer.**
Everything above - process spawning, stream-json parsing, session-id extraction, resume flags, permission hooks over stdio, normalization into typed entries - is what the Claude Agent SDK gives us as a typed API (`query()`, streaming input, `canUseTool`, session resume).
VK needed the abstraction because it is a multi-agent cockpit; we deliberately support one agent and take the SDK seam instead.
What we keep from their design is the *shape of the output*: a normalized, typed entry stream (their `NormalizedEntry`) is the right contract between engine and UI, and ours comes straight from SDK message types.
Their `qa_mock.rs` executor (`crates/executors/src/executors/qa_mock.rs`) is prior art for our deterministic simulator seam: a fake executor behind the same interface, used to drive the UI without a real agent.

## 7. Worktree lifecycle

All in `crates/worktree-manager/src/worktree_manager.rs` and `crates/workspace-manager/src/workspace_manager.rs`:

- Base directory: worktrees live outside every repo in an app-owned temp dir, `utils::path::get_vibe_kanban_temp_dir().join("worktrees")` (lines 521-523); a user-configured override still nests an app-owned subfolder, with the comment "Always use app-owned subdirectory within custom path for safety. This ensures orphan cleanup never touches user's existing folders" (lines 511-517).
- Layout: a workspace directory contains one worktree per repo at `workspace_dir.join(&repo.name)` (`workspace_manager.rs` lines 312, 397).
- Branch naming: `format!("{}/{}-{}", prefix, short_uuid(workspace_id), task_title_id)` where `git_branch_prefix()` is configurable (`crates/services/src/services/container.rs` lines 784-795) and defaults to `"vk"` (`crates/services/src/services/config/versions/v7.rs` lines 10-12), giving `vk/<short-uuid>-<title-slug>`; the uuid guarantees uniqueness, the slug keeps it readable.
- Creation is retry-hardened: `create_worktree_with_retry` prefers the git CLI "to inherit sparse-checkout semantics", verifies the path actually exists after a reported success, and on failure force-cleans stale worktree metadata plus any half-created directory before one retry (`worktree_manager.rs` lines 303-368).
- Orphan cleanup ("janitor"): on boot, `cleanup_orphan_workspaces()` scans the worktree base dir and removes any directory whose path is not referenced in the database (`workspace_manager.rs` lines 538-600), then a background loop re-runs expiry cleanup every 30 minutes (`crates/local-deployment/src/container.rs` lines 299-320).
- Escape hatches: a `DISABLE_WORKTREE_CLEANUP` env var skips the janitor (`workspace_manager.rs` lines 539-544), and `cleanup_suspected_worktree` refuses to touch any path whose `.git` is not a file (i.e. not a worktree) (`worktree_manager.rs` lines 525-536).

**Steal.**
- The app-owned-subdirectory rule so the janitor can never delete user folders; our `~/.agent-workbench/worktrees/<project-hash>/<ticket-id>` layout already conforms - keep it that way.
- The `<uuid-or-id>/<slug>` branch naming duality (unique id + readable slug); our `forge/<ticket-slug>` spec should append the ticket id short-hash to avoid collisions on duplicate titles.
- Creation retry with metadata force-clean; `git worktree add` really does leave stale metadata on crashes.
- Database-as-truth orphan detection (anything on disk not in state is an orphan).
**Adapt.** VK deletes orphans automatically; our spec's janitor deliberately asks resume-or-clean instead, because our runs can carry unfinished, resumable work (WIP-commit rule).

## 8. Streaming transport

- VK streams to the frontend over WebSocket messages of RFC-6902 JSON Patch operations: `type WsJsonPatchMsg = { JsonPatch: Operation[] }`, applied with immer, with exponential reconnect backoff "1s, 2s, 4s, 8s (max)" (`packages/web-core/src/shared/hooks/useJsonPatchWsStream.ts` lines 7, 54-63).
- The backend keeps a per-process in-memory `MsgStore` whose `history_plus_stream()` replays history before live events, falling back to DB-persisted raw logs when the store is gone (`crates/services/src/services/container.rs` lines 797-830).

**Steal.** The history-plus-stream replay contract (a late-joining client gets full state, then deltas) and the exact backoff schedule; we apply both to our SSE + run-JSONL design.
**Skip.** JSON Patch as the wire format; our runs stream typed SDK events, and patching arbitrary JSON documents is a generality we do not need.

## 9. Deliberately NOT copying

1. **The whole cloud/remote relay family - ignore it entirely.**
   Crates: `relay-client`, `relay-control`, `relay-hosts`, `relay-protocol`, `relay-tunnel`, `relay-tunnel-core`, `relay-types`, `relay-webrtc`, `relay-ws`, plus `remote`, `remote-info`, `desktop-bridge`, `embedded-ssh`, `trusted-key-auth`, `ws-bridge`.
   `crates/relay-client/src/lib.rs` shows the scope: SPAKE2 pairing, ed25519 request signing, signed websockets to remote hosts - infrastructure for a hosted service that shut down.
   `crates/remote/src/lib.rs` is the cloud backend itself (`azure_blob`, `analytics`, `auth` modules).
   Frontend equivalents to ignore: `packages/remote-web`, the `hosts.$hostId.*` route variants in `packages/local-web/src/routes/`, `packages/web-core/src/shared/integrations/electric` (ElectricSQL sync), and the org/project plumbing in `packages/web-core/src/pages/workspaces/WorkspacesSidebarContainer.tsx` lines 309-358 (organization and remote-project lookups executed just to power a sidebar filter).
2. **Cloud kanban/issue tracking.** Retired in-product (`packages/web-core/src/pages/kanban/ProjectSunsetPage.tsx`); our tickets are local execution units by design.
3. **The multi-executor CLI-wrapping layer** (section 6); Agent-SDK-native replaces it.
4. **Approval timeouts.** VK approvals carry a `timeout_at` with a countdown ring and a `TimedOut` terminal state (`crates/services/src/services/approvals.rs` lines 26, 125; `packages/web-core/src/shared/components/NormalizedConversation/PendingApprovalEntry.tsx` lines 41-77), because a wrapped CLI cannot block forever.
   Our SDK `canUseTool` callback can wait indefinitely, so v1 has no approval timeout - one less state, one less way to lose a run overnight.
5. **Follow-up queueing.** The composer's queue/cancel-queue/queue-loading states (`packages/ui/src/components/SessionChatBox.tsx` lines 523-572) add real complexity; our v1 has steer and stop only (spec decision), so we consciously drop those states.
6. **i18n at v1.** VK routes every string through react-i18next namespaces (`packages/web-core/src/i18n/locales/`); for an internal team tool this is pure overhead.
7. **Tauri/desktop packaging** (`crates/tauri-app`) and mobile layouts; we are localhost-per-project by design.
8. **Full interactive terminal panel** (`TerminalPanelContainer` in `packages/web-core/src/pages/workspaces/RightSidebar.tsx` line 111); our v1 ships read-only command output per spec, matching VK's own Logs mode more than its terminal.

## 10. Steal list worth quoting in reviews (summary)

| Pattern | Evidence | Where it lands in our app |
|---|---|---|
| Needs-attention predicate + raised-hand grouping | `packages/ui/src/components/WorkspacesSidebar.tsx` 217-233 | Sidebar groups (`07-ui-spec.md` 4.2) |
| Inline approval entry with Enter/Cmd+Enter scope | `PendingApprovalEntry.tsx` + `packages/web-core/src/shared/keyboard/registry.ts` 467-481 | Permission prompt (4.4.4) |
| Composer diff strip + in-progress todo swap | `packages/ui/src/components/SessionChatBox.tsx` 703-780 | Composer (4.4.5) |
| First-line-to-title split at 100 chars | `packages/web-core/src/shared/lib/string.ts` 45-75 | Prompt-first create (4.3) |
| Persist-key-per-collapsible-section | `RightSidebar.tsx`, `WorkspacesSidebar.tsx` | All panels |
| Draft-as-sidebar-row with fixed UUID scratch | `WorkspacesSidebarContainer.tsx` 59-60, 551-569 | Create draft persistence |
| Sequential shortcuts (`g s`, `w a`, `y p`) with sequence indicator | `packages/web-core/src/shared/keyboard/registry.ts` 60-332 | Shortcut table (section 6 of UI spec) |
| Context-window gauge from token usage events | `packages/ui/src/components/ContextUsageGauge.tsx` | Plan & Progress panel |
| History-plus-stream replay + 1/2/4/8s backoff | `container.rs` 797-830, `useJsonPatchWsStream.ts` 54-63 | SSE streaming rules |
| Worktree create-retry + app-owned dir + DB-as-truth janitor | `worktree_manager.rs` 303-368, 511-523; `workspace_manager.rs` 538-600 | Worktree lifecycle + janitor |
| Mock executor behind the real interface | `crates/executors/src/executors/qa_mock.rs` | Deterministic simulator seam |
| Rerender isolation for streaming stats | `WorkspacesMainContainer.tsx` 26-31 | All live panels |

## 11. Top three takeaways

1. The attention-first sidebar is a two-line predicate, not a subsystem - `hasPendingApproval || (hasUnseenActivity && !isRunning)` - and everything else (icons, grouping, persistence) hangs off it; copy the shape, add our Review group.
2. Wrapping an agent CLI costs a 3,000-line executor plus a hand-rolled stdio control protocol, regex hook matchers, and stringly-typed resume flags; the Agent SDK deletes that entire layer, which is the strongest code-level validation of our architecture bet.
3. Worktree safety is earned through paranoia: app-owned directories the janitor may touch, existence verification after "successful" creation, metadata force-clean retries, and treating the database as the single source of truth for what is an orphan.
