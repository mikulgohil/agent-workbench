# Domain model (v1)

This is the complete TypeScript domain model as it will appear in `src/lib/domain/types.ts`.
It mirrors `docs/blueprint/04-forge-format.md` field-for-field: every type below either maps directly onto a file defined there, or is a supporting shape used by one that does.
Read doc 04 first for the on-disk rationale; this document is the typed contract layer on top of it.

Design notes (same conventions as the reference `se-agent-platform` domain model):

- String-literal unions (`as const` arrays + `(typeof X)[number]`), never `enum`, so every value is JSON-serializable and diffable in git.
- Discriminated unions are keyed by `kind`, one variant per concrete shape.
- All timestamps are ISO strings, never `Date`. All identity fields are the git-identity string, never a structured user object (there is no auth, no user table - locked decision 2 of the spec).
- Every interface here is JSON-serializable end to end: no functions, no `Map`/`Set`, no class instances.

```ts
/**
 * Core domain model for Agent Workbench.
 *
 * Design notes:
 * - String-literal unions (not enums) keep every type JSON-serializable, so
 *   the same objects move unchanged between the API layer, the SSE stream,
 *   and the files under `.forge/`.
 * - Discriminated unions (`RunEvent`, `AuditEvent`) are keyed by `kind`.
 * - All timestamps are ISO strings, never `Date`.
 * - See docs/blueprint/04-forge-format.md for the on-disk file each type
 *   corresponds to.
 */

/* ------------------------------------------------------------------ */
/* App-level: project registry (NOT under .forge/)                     */
/* ------------------------------------------------------------------ */

/**
 * One entry in the app's recent-projects list.
 * Persisted in `~/.agent-workbench/config.json` (per-user, outside any
 * repo) - this is the one type in this file that has nothing to do with
 * `.forge/`. Included here because it is still part of the app's domain
 * model and other types (Run, worktree paths) are keyed off `Project.id`.
 */
export interface Project {
  /** Stable hash of `path`, used as the worktree cache directory segment. */
  id: string;
  name: string;
  /** Absolute path to the repo root on this machine. */
  path: string;
  lastOpenedAt: string;
}

/* ------------------------------------------------------------------ */
/* .forge/config.json                                                  */
/* ------------------------------------------------------------------ */

export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export interface ForgeConfigScripts {
  typecheck: string;
  lint: string;
  test: string;
  storybook: string;
}

/**
 * `.forge/config.json`. One instance per project, always present.
 * Invariant: `formatVersion` is the ONLY version marker for the entire
 * `.forge/` format - no other file carries its own version field.
 */
export interface ForgeConfig {
  formatVersion: number;
  packageManager: PackageManager;
  baseBranch: string;
  /** Max simultaneous runs. Default 3. */
  concurrencyCap: number;
  scripts: ForgeConfigScripts;
  /** Glob/prefix patterns matched against a full command string; a match runs without a permission prompt. */
  bashAllowlist: string[];
  /** Globs the agent's Read/Grep/Glob tools may never resolve, regardless of any other setting. */
  denyReadGlobs: string[];
}

/* ------------------------------------------------------------------ */
/* .forge/design-system.json                                          */
/* ------------------------------------------------------------------ */

export const TOKEN_CATEGORIES = [
  "color",
  "spacing",
  "typography",
  "radius",
  "shadow",
  "other",
] as const;
export type TokenCategory = (typeof TOKEN_CATEGORIES)[number];

export interface TokenMapping {
  figmaVariable: string;
  codeToken: string;
  category: TokenCategory;
}

export interface ComponentMapping {
  figmaComponent: string;
  codeComponent: string;
  importPath: string;
  /** Figma component property name -> code component prop name. */
  propsMapping: Record<string, string>;
}

/**
 * `.forge/design-system.json`. The figma-to-component template refuses to
 * run if this file is missing from the project.
 */
export interface DesignSystemMapping {
  tokens: TokenMapping[];
  components: ComponentMapping[];
}

/* ------------------------------------------------------------------ */
/* .forge/templates/<type>/template.json                               */
/* ------------------------------------------------------------------ */

export const TICKET_TYPES = [
  "figma-to-component",
  "bug-fix",
  "improvement",
  "generic",
] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TEMPLATE_INPUT_KINDS = ["text", "textarea", "url", "file-ref"] as const;
export type TemplateInputKind = (typeof TEMPLATE_INPUT_KINDS)[number];

export interface TemplateInputField {
  /** Key this input is stored under in `Ticket.inputs`. */
  key: string;
  label: string;
  inputKind: TemplateInputKind;
  required: boolean;
  placeholder?: string;
  helpText?: string;
}

export const GATE_NAMES = [
  "typecheck",
  "lint",
  "test",
  "accessibility",
  "security",
  "maintainability",
] as const;
/** Closed set: the six gates the app knows how to run, per the spec's Quality gates section. */
export type GateName = (typeof GATE_NAMES)[number];

/**
 * `.forge/templates/<type>/template.json`. One per template folder.
 * Invariant: a ticket copies `gates` and `planThenApprove` from its
 * template at creation time - later edits to the template never
 * retroactively change an in-flight ticket's requirements.
 */
export interface TaskTemplate {
  type: TicketType;
  displayName: string;
  description: string;
  requiredInputs: TemplateInputField[];
  /** Relative path to the checklist markdown, default "checklist.md". */
  checklistFile: string;
  gates: GateName[];
  /** Default on for figma-to-component, off for bug-fix, per the spec. */
  planThenApprove: boolean;
}

/* ------------------------------------------------------------------ */
/* Checklists (parsed from checklist.md, stored per-ticket)            */
/* ------------------------------------------------------------------ */

export const CHECKLIST_ITEM_ORIGINS = ["command", "manual"] as const;
export type ChecklistItemOrigin = (typeof CHECKLIST_ITEM_ORIGINS)[number];

/**
 * One checklist row. `command`-origin items auto-check from the linked
 * `gate`'s result; `manual`-origin items are checked by the developer.
 * Invariant: `gate` is non-null if and only if `origin` is `"command"`.
 */
export interface ChecklistItem {
  /** Kebab-case slug of the label, de-duplicated within the ticket. */
  id: string;
  label: string;
  origin: ChecklistItemOrigin;
  gate: GateName | null;
  checked: boolean;
  /** Git identity of the developer who checked a manual item; null for command-origin items or unchecked items. */
  checkedBy: string | null;
  checkedAt: string | null;
  note: string | null;
}

/* ------------------------------------------------------------------ */
/* Tickets                                                             */
/* ------------------------------------------------------------------ */

export const TICKET_STATUSES = [
  "backlog",
  "running",
  "review",
  "done",
  "rejected",
  "failed",
] as const;
/**
 * The only persisted lifecycle field on a ticket. The sidebar's
 * Needs Attention / Running / Review / Idle grouping and the kanban
 * alt-view's backlog / running / review / done columns are both computed
 * in the UI from this field plus the current run's `RunState` - neither
 * grouping is itself persisted.
 */
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_SOURCES = ["manual", "chat", "file-explorer"] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];

export const ATTACHMENT_KINDS = [
  "figma-screenshot",
  "figma-variables",
  "figma-component-structure",
  "upload",
] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export interface Attachment {
  /** Relative path under the ticket's `attachments/` folder. */
  fileName: string;
  kind: AttachmentKind;
  addedAt: string;
}

/**
 * `.forge/tickets/<ticket-id>/ticket.json`. Folder name equals `id`.
 * Invariant: `gates`, `planThenApprove`, and the initial `checklist` are
 * snapshots copied from the owning `TaskTemplate` at creation time.
 */
export interface Ticket {
  id: string;
  type: TicketType;
  title: string;
  status: TicketStatus;
  /** Free-text reference to an official Jira/monday ticket; no integration. */
  jiraRef: string | null;
  /** Keyed by the owning template's `requiredInputs[].key`. */
  inputs: Record<string, string>;
  attachments: Attachment[];
  checklist: ChecklistItem[];
  gates: GateName[];
  planThenApprove: boolean;
  currentRunId: string | null;
  /** `forge/<ticket-id>`; null until the first run starts. */
  branchName: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  source: TicketSource;
}

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

export const CHAT_ROLES = ["user", "assistant", "system"] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

/**
 * One line of `.forge/tickets/<ticket-id>/chat.jsonl`.
 * Invariant: global (non-ticket) chat has no file of its own - it exists
 * only in memory until its first file edit auto-creates a ticket, at
 * which point the conversation becomes that ticket's chat.jsonl.
 */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  at: string;
  /** Git identity for user messages; null for assistant/system messages. */
  author: string | null;
}

/* ------------------------------------------------------------------ */
/* Quality gates                                                       */
/* ------------------------------------------------------------------ */

export const GATE_BASES = ["command", "heuristic"] as const;
/** `"command"` = real exit-code-backed gate (typecheck/lint/test); `"heuristic"` = LLM-narrated gate, badged honestly in the UI as narrated. */
export type GateBasis = (typeof GATE_BASES)[number];

export const GATE_STATUSES = ["passed", "warning", "failed"] as const;
export type GateStatus = (typeof GATE_STATUSES)[number];

/**
 * One gate's result for one run.
 * Invariant: a missing configured script produces `status: "warning"`,
 * never `"failed"` (the Forge missing-script-means-warning rule).
 */
export interface Gate {
  name: GateName;
  basis: GateBasis;
  status: GateStatus;
  /** 0-100. */
  score: number;
  explanation: string;
  durationMs: number;
}

/* ------------------------------------------------------------------ */
/* Cost                                                                */
/* ------------------------------------------------------------------ */

export interface CostRecord {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

export const RUN_STATES = [
  "queued",
  "preparing",
  "planning",
  "awaiting-plan-approval",
  "executing",
  "awaiting-permission",
  "gates-running",
  "awaiting-iteration-approval",
  "awaiting-approval",
  "completed",
  "rejected",
  "interrupted",
  "failed",
] as const;
/**
 * Reconciled 2026-07-15 with 06-execution-model.md's lifecycle analysis:
 * "queued" exists because runs can wait on the concurrency cap;
 * "awaiting-iteration-approval" is the human cost checkpoint before gate
 * fix-iteration 2; there is no separate gate-retry state because fix
 * iterations re-enter "executing". The last four values are terminal.
 * Resume reconstructs the current value by reading the tail of the local
 * run transcript, not from a separately persisted state file.
 */
export type RunState = (typeof RUN_STATES)[number];

export interface ApprovalDecision {
  decidedBy: string;
  approved: boolean;
  note: string;
  decidedAt: string;
}

/**
 * The live, in-memory shape of a run, reconstructed on demand from the
 * local run transcript (see `RunEvent`) rather than persisted as its own
 * mutable file. Once a run reaches a terminal `state`, its durable,
 * sanitized record is a `RunSummary`, not this type.
 * Invariant: `worktreePath` is null for chat-originated runs (chat runs
 * against the main working tree, never a worktree) and once a worktree
 * has been cleaned up after approval/rejection.
 */
export interface Run {
  id: string;
  ticketId: string;
  state: RunState;
  /** Agent SDK session id; enables resume via session forking/continuation. */
  sessionId: string | null;
  worktreePath: string | null;
  /** Gate-feedback retry counter, 0-3. */
  iteration: number;
  approval: ApprovalDecision | null;
  startedAt: string;
  endedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* Run events - full local transcript, one per line of                 */
/* .forge/local/runs/<ticket-id>/<run-id>.jsonl                        */
/* ------------------------------------------------------------------ */

export const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface TodoItem {
  content: string;
  activeForm: string;
  status: TodoStatus;
}

export const PLAN_DECISIONS = ["approved", "changes-requested"] as const;
export type PlanDecision = (typeof PLAN_DECISIONS)[number];

export const PERMISSION_DECISIONS = ["approved", "denied"] as const;
export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number];

export const BASH_COMMAND_SOURCES = ["allowlisted", "approved"] as const;
export type BashCommandSource = (typeof BASH_COMMAND_SOURCES)[number];

export interface RunEventBase {
  /** Monotonic sequence number within this run's transcript, for ordering and SSE resume. */
  seq: number;
  at: string;
}

/**
 * Discriminated union of every event in a run's full local transcript.
 * Invariant: this file is append-only and gitignored - no file contents
 * ever appear here that would also need to appear in a committed file;
 * `RunSummary` is the sanitized subset that IS committed.
 */
export type RunEvent = RunEventBase &
  (
    | {
        kind: "run-started";
        sessionId: string;
        worktreePath: string | null;
        branchName: string | null;
      }
    | { kind: "plan-proposed"; planMarkdown: string }
    | { kind: "plan-decision"; decision: PlanDecision; note: string }
    | { kind: "todo-update"; todos: TodoItem[] }
    | { kind: "message"; text: string }
    | { kind: "steer-message"; text: string; from: string }
    | {
        kind: "tool-use";
        toolUseId: string;
        toolName: string;
        input: Record<string, unknown>;
      }
    | {
        kind: "tool-result";
        toolUseId: string;
        output: string;
        isError: boolean;
      }
    | { kind: "permission-request"; requestId: string; command: string }
    | {
        kind: "permission-decision";
        requestId: string;
        decision: PermissionDecision;
      }
    | {
        kind: "bash-command";
        command: string;
        source: BashCommandSource;
        exitCode: number;
        durationMs: number;
      }
    | { kind: "gate-result"; gate: Gate }
    | {
        kind: "gate-retry-projection";
        iteration: number;
        projectedCostUsd: number;
      }
    | { kind: "cost-update"; cumulative: CostRecord }
    | { kind: "phase-change"; from: RunState; to: RunState }
    | { kind: "error"; message: string; recoverable: boolean }
  );

/* ------------------------------------------------------------------ */
/* Run summary - sanitized, committed record of a completed run        */
/* .forge/tickets/<ticket-id>/runs/<run-id>.summary.json               */
/* ------------------------------------------------------------------ */

export const FILE_CHANGE_KINDS = ["added", "modified", "deleted"] as const;
export type FileChangeKind = (typeof FILE_CHANGE_KINDS)[number];

export interface FileTouch {
  path: string;
  kind: FileChangeKind;
}

export interface CommandRecord {
  command: string;
  source: BashCommandSource;
  exitCode: number;
  durationMs: number;
}

/**
 * The sanitized run summary committed to git.
 * Invariant: NEVER contains file contents, diffs, or snippets - only
 * paths, commands, gate results, durations, and cost. This is what makes
 * split transcript storage safe to commit (locked decision 11).
 * Invariant: written exactly once, when `state` reaches a terminal value.
 */
export interface RunSummary {
  id: string;
  ticketId: string;
  /** One of the four terminal RunState values. */
  state: RunState;
  filesTouched: FileTouch[];
  commandsRun: CommandRecord[];
  gates: Gate[];
  iteration: number;
  cost: CostRecord;
  approval: ApprovalDecision | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  appVersion: string;
}

/* ------------------------------------------------------------------ */
/* QA handover pack                                                    */
/* .forge/tickets/<ticket-id>/handover.md (rendered from this shape)    */
/* ------------------------------------------------------------------ */

export interface VisualCompareShot {
  label: string;
  figmaImagePath: string;
  storybookImagePath: string;
}

/**
 * The data object `handover.md` is rendered from.
 * Invariant: written exactly once per completed ticket; regenerated
 * wholesale (not diffed/edited) if the ticket is reopened and re-completed.
 */
export interface HandoverPack {
  ticketId: string;
  runId: string;
  summary: string;
  filesChanged: FileTouch[];
  storybookUrl: string | null;
  route: string | null;
  gates: Gate[];
  checklist: ChecklistItem[];
  remainingManualTodos: string[];
  visualCompare: VisualCompareShot[];
  generatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Figma snapshot                                                      */
/* .forge/tickets/<ticket-id>/attachments/figma-snapshot/manifest.json  */
/* ------------------------------------------------------------------ */

/**
 * Describes a Figma context snapshot captured at ticket creation.
 * Invariant: the agent only ever reads these captured files plus
 * `DesignSystemMapping` - never the live Figma API - so runs stay
 * reproducible and auditable.
 */
export interface FigmaSnapshot {
  nodeId: string;
  nodeName: string;
  capturedAt: string;
  /** Relative file names under the same `figma-snapshot/` folder. */
  screenshots: string[];
  variablesFile: string;
  componentStructureFile: string;
}

/* ------------------------------------------------------------------ */
/* Knowledge / lessons                                                 */
/* .forge/knowledge/lessons.md (one interface per parsed "### Lesson")  */
/* ------------------------------------------------------------------ */

export const LESSON_SOURCES = ["correction", "gate-failure", "clarification"] as const;
export type LessonSource = (typeof LESSON_SOURCES)[number];

export interface LessonProvenance {
  ticketId: string;
  user: string;
  source: LessonSource;
}

/**
 * One parsed `### Lesson <id>` section of `lessons.md`.
 * Invariant: `id` is stable for the section's lifetime so a revert can
 * remove exactly one section as a normal git-tracked deletion.
 */
export interface Lesson {
  id: string;
  text: string;
  provenance: LessonProvenance;
  addedAt: string;
}

/* ------------------------------------------------------------------ */
/* Local, per-user settings                                            */
/* .forge/local/settings.json                                          */
/* ------------------------------------------------------------------ */

export const UI_THEMES = ["light", "dark", "system"] as const;
export type UiTheme = (typeof UI_THEMES)[number];

export interface LocalSettings {
  monthlyBudgetUsd: number;
  theme: UiTheme;
}

/* ------------------------------------------------------------------ */
/* Audit log - one event per line of                                   */
/* .forge/audit/<YYYY-MM>.jsonl                                        */
/* ------------------------------------------------------------------ */

export interface AuditEventBase {
  /** Git identity of the developer who took the action. */
  user: string;
  at: string;
  /** Null only for ticket-independent events like `knowledge-consolidated`. */
  ticketId: string | null;
  /** Short human-readable summary line, shown directly in the Audit page. */
  detail: string;
  appVersion: string;
}

/**
 * Discriminated union of every audited action, per the spec's Audit log
 * section. Note: the `"run-started"` kind here and the `"run-started"`
 * kind on `RunEvent` are independent event systems (committed audit
 * trail vs. local full transcript) that happen to share a name.
 */
export type AuditEvent = AuditEventBase &
  (
    | { kind: "ticket-created"; ticketType: TicketType; title: string }
    | { kind: "run-started"; runId: string }
    | { kind: "run-interrupted"; runId: string }
    | { kind: "run-steered"; runId: string; message: string }
    | { kind: "run-approved"; runId: string; note: string }
    | { kind: "run-rejected"; runId: string; note: string }
    | { kind: "chat-auto-ticket-created"; runId: string }
    | { kind: "bash-command-approved"; runId: string; command: string }
    | { kind: "bash-command-allowlisted"; runId: string; command: string }
    | { kind: "bash-command-denied"; runId: string; command: string }
    | { kind: "lesson-added"; lessonId: string }
    | { kind: "lesson-reverted"; lessonId: string }
    | {
        kind: "knowledge-consolidated";
        lessonsMerged: number;
        lessonsPruned: number;
      }
    | { kind: "handover-generated"; runId: string }
  );
```

## Persistence cross-reference

Every type above maps to exactly one place in `.forge/` (or, for `Project`, outside it). Cross-references doc 04's "File-by-file specification" section by the same file paths.

| Type | Persisted at |
|---|---|
| `Project` | `~/.agent-workbench/config.json` (`recentProjects[]`) - **not** under `.forge/`. |
| `ForgeConfig`, `ForgeConfigScripts`, `PackageManager` | `.forge/config.json` |
| `DesignSystemMapping`, `TokenMapping`, `TokenCategory`, `ComponentMapping` | `.forge/design-system.json` |
| `TaskTemplate`, `TemplateInputField`, `TemplateInputKind`, `TicketType`, `GateName` | `.forge/templates/<type>/template.json` |
| `ChecklistItem`, `ChecklistItemOrigin` | authored as `.forge/templates/<type>/checklist.md`; per-ticket snapshot lives in `.forge/tickets/<id>/ticket.json` |
| `Ticket`, `TicketStatus`, `TicketSource`, `Attachment`, `AttachmentKind` | `.forge/tickets/<ticket-id>/ticket.json` |
| `FigmaSnapshot` | `.forge/tickets/<ticket-id>/attachments/figma-snapshot/manifest.json` |
| `ChatMessage`, `ChatRole` | `.forge/tickets/<ticket-id>/chat.jsonl` |
| `Gate`, `GateBasis`, `GateStatus` | embedded in `RunEvent` (`gate-result`), `RunSummary.gates`, and `HandoverPack.gates` |
| `CostRecord` | embedded in `RunEvent` (`cost-update`) and `RunSummary.cost` |
| `Run`, `RunState`, `ApprovalDecision` | live/in-memory; reconstructed from `.forge/local/runs/<ticket-id>/<run-id>.jsonl` |
| `RunEvent`, `RunEventBase`, `TodoItem`, `TodoStatus`, `PlanDecision`, `PermissionDecision`, `BashCommandSource` | `.forge/local/runs/<ticket-id>/<run-id>.jsonl` (gitignored, full transcript) |
| `RunSummary`, `FileTouch`, `FileChangeKind`, `CommandRecord` | `.forge/tickets/<ticket-id>/runs/<run-id>.summary.json` (committed, sanitized) |
| `HandoverPack`, `VisualCompareShot` | rendered into `.forge/tickets/<ticket-id>/handover.md` |
| `Lesson`, `LessonProvenance`, `LessonSource` | `.forge/knowledge/lessons.md` (one `Lesson` per `### Lesson <id>` section) |
| `LocalSettings`, `UiTheme` | `.forge/local/settings.json` (gitignored) |
| `AuditEvent`, `AuditEventBase` | `.forge/audit/<YYYY-MM>.jsonl` |

`.forge/knowledge/project.md` has no dedicated type: it is loaded and rendered as free-form markdown, with no structured schema by design.
