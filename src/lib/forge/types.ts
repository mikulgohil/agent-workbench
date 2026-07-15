/**
 * Core domain model for Agent Workbench - Phase 1 subset.
 *
 * CANONICAL SOURCE: docs/blueprint/05-data-model.md.
 * Every name and field here matches that document exactly; later phases
 * extend this file with the remaining canonical types (RunSummary,
 * AuditEvent, Lesson, TaskTemplate, ...) instead of renaming anything.
 *
 * Design notes:
 * - String-literal unions (not enums) keep every type JSON-serializable.
 * - Discriminated unions (RunEvent) are keyed by `kind`.
 * - All timestamps are ISO strings, never Date.
 * - Identity fields are the git-identity string, never a structured object.
 */

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

export interface ForgeConfig {
  formatVersion: number;
  packageManager: PackageManager;
  baseBranch: string;
  concurrencyCap: number;
  scripts: ForgeConfigScripts;
  bashAllowlist: string[];
  denyReadGlobs: string[];
}

/* ------------------------------------------------------------------ */
/* Tickets                                                             */
/* ------------------------------------------------------------------ */

export const TICKET_TYPES = [
  "figma-to-component",
  "bug-fix",
  "improvement",
  "generic",
] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export function isTicketType(value: string): value is TicketType {
  return (TICKET_TYPES as readonly string[]).includes(value);
}

export const GATE_NAMES = [
  "typecheck",
  "lint",
  "test",
  "accessibility",
  "security",
  "maintainability",
] as const;
export type GateName = (typeof GATE_NAMES)[number];

export const CHECKLIST_ITEM_ORIGINS = ["command", "manual"] as const;
export type ChecklistItemOrigin = (typeof CHECKLIST_ITEM_ORIGINS)[number];

export interface ChecklistItem {
  id: string;
  label: string;
  origin: ChecklistItemOrigin;
  gate: GateName | null;
  checked: boolean;
  checkedBy: string | null;
  checkedAt: string | null;
  note: string | null;
}

export const TICKET_STATUSES = [
  "backlog",
  "running",
  "review",
  "done",
  "rejected",
  "failed",
] as const;
/**
 * The only persisted lifecycle field on a ticket. Sidebar groups
 * (Needs Attention / Running / Review / Idle) are computed in the UI from
 * this field plus the current run's RunState - never persisted.
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
  fileName: string;
  kind: AttachmentKind;
  addedAt: string;
}

export interface Ticket {
  id: string;
  type: TicketType;
  title: string;
  status: TicketStatus;
  jiraRef: string | null;
  /** Keyed by the owning template's requiredInputs[].key; prompt-first creation stores the prompt under "prompt". */
  inputs: Record<string, string>;
  attachments: Attachment[];
  checklist: ChecklistItem[];
  gates: GateName[];
  planThenApprove: boolean;
  currentRunId: string | null;
  branchName: string | null;
  /** Git identity string, e.g. "Jane Dev <jane@example.com>". */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  source: TicketSource;
}

/* ------------------------------------------------------------------ */
/* Quality gates                                                       */
/* ------------------------------------------------------------------ */

export const GATE_BASES = ["command", "heuristic"] as const;
export type GateBasis = (typeof GATE_BASES)[number];

export const GATE_STATUSES = ["passed", "warning", "failed"] as const;
export type GateStatus = (typeof GATE_STATUSES)[number];

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
export type RunState = (typeof RUN_STATES)[number];

const TERMINAL_RUN_STATES: readonly RunState[] = [
  "completed",
  "rejected",
  "interrupted",
  "failed",
];

export function isTerminalState(state: RunState): boolean {
  return TERMINAL_RUN_STATES.includes(state);
}

export interface ApprovalDecision {
  decidedBy: string;
  approved: boolean;
  note: string;
  decidedAt: string;
}

/**
 * The live, in-memory shape of a run (canonical). Phase 1 keeps it in the
 * run manager only; Phase 2 reconstructs it from the local run transcript
 * for resume.
 */
export interface Run {
  id: string;
  ticketId: string;
  state: RunState;
  sessionId: string | null;
  worktreePath: string | null;
  iteration: number;
  approval: ApprovalDecision | null;
  startedAt: string;
  endedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* Run events - the full local transcript protocol                     */
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

/** Helper (not in the canonical doc): the SSE route and client listen per kind. */
export const RUN_EVENT_KINDS = [
  "run-started",
  "plan-proposed",
  "plan-decision",
  "todo-update",
  "message",
  "steer-message",
  "tool-use",
  "tool-result",
  "permission-request",
  "permission-decision",
  "bash-command",
  "gate-result",
  "gate-retry-projection",
  "cost-update",
  "phase-change",
  "error",
] as const;
export type RunEventKind = (typeof RUN_EVENT_KINDS)[number];

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
    | { kind: "tool-result"; toolUseId: string; output: string; isError: boolean }
    | { kind: "permission-request"; requestId: string; command: string }
    | { kind: "permission-decision"; requestId: string; decision: PermissionDecision }
    | {
        kind: "bash-command";
        command: string;
        source: BashCommandSource;
        exitCode: number;
        durationMs: number;
      }
    | { kind: "gate-result"; gate: Gate }
    | { kind: "gate-retry-projection"; iteration: number; projectedCostUsd: number }
    | { kind: "cost-update"; cumulative: CostRecord }
    | { kind: "phase-change"; from: RunState; to: RunState }
    | { kind: "error"; message: string; recoverable: boolean }
  );

/** A run ends when a phase-change lands in one of the four terminal states. */
export function isTerminalEvent(event: RunEvent): boolean {
  return event.kind === "phase-change" && isTerminalState(event.to);
}
