# Agent SDK integration guide

Blueprint doc 02 for Agent Workbench.
This is the correctness-critical reference for every Claude Agent SDK capability the app uses.

**Verification provenance (2026-07-15):**

- Official docs verified via WebFetch against `https://code.claude.com/docs/en/agent-sdk/*` (the `docs.claude.com/en/api/agent-sdk/*` URLs now 301/307-redirect there via `platform.claude.com`).
- Type signatures verified against the locally installed `@anthropic-ai/claude-agent-sdk@0.3.209` (`sdk.d.ts` and `sdk-tools.d.ts` in `se-agent-platform/node_modules`).
- Where the two disagree, the installed `sdk.d.ts` wins for the pinned version; the doc says so inline.
- Anything not verifiable from either source is explicitly marked **UNVERIFIED**.
- Working reference for the minimal single-shot pattern: `/Users/mikulgohil/Developer/personal/portfolio/se-agent-platform/src/lib/engineering-agent/agent-sdk-model.ts`.

---

## 1. query() fundamentals

### 1.1 Signature and the Query object

`query()` is the single entry point.
It spawns the bundled Claude Code CLI as a subprocess and returns a `Query`, which is an async generator of `SDKMessage` plus control methods.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

declare function queryShape(params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}): Query;

// Query (verified subset relevant to us, from sdk.d.ts):
// interface Query extends AsyncGenerator<SDKMessage, void> {
//   interrupt(): Promise<SDKControlInterruptResponse | undefined>;   // streaming input mode only
//   setPermissionMode(mode: PermissionMode): Promise<void>;          // streaming input mode only
//   setModel(model?: string): Promise<void>;                         // streaming input mode only
//   streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
//   initializationResult(): Promise<SDKControlInitializeResponse>;
//   supportedCommands(): Promise<SlashCommand[]>;
//   supportedModels(): Promise<ModelInfo[]>;
//   mcpServerStatus(): Promise<McpServerStatus[]>;
//   setMcpServers(servers: Record<string, McpServerConfig>): Promise<McpSetServersResult>;
//   rewindFiles(userMessageId: string, options?: { dryRun?: boolean }): Promise<RewindFilesResult>;
//   close(): void;
// }
```

The control methods (everything except iteration and `close()`) are only available in streaming input mode (see section 2).
`close()` forcefully terminates the subprocess and all pending requests; use it only for hard teardown.

### 1.2 Options we use (verified against 0.3.209)

| Option | Type | Notes for Workbench |
|---|---|---|
| `cwd` | `string` | The ticket worktree path (or the main working tree for global chat). Defaults to `process.cwd()`. |
| `abortController` | `AbortController` | One per run; aborting stops the query and cleans up the subprocess. |
| `tools` | `string[] \| { type: 'preset'; preset: 'claude_code' }` | Base set of built-in tools. `[]` disables all built-ins. See 1.3 for our recommendation. |
| `allowedTools` | `string[]` | Allow rules that auto-approve without prompting. Does NOT restrict availability; unlisted tools fall through to mode and `canUseTool`. Supports scoped rules like `Bash(pnpm run *)`. Passing `'Skill'` here is deprecated; use the `skills` option. |
| `disallowedTools` | `string[]` | Deny rules. A bare name (`"WebSearch"`) removes the tool from context entirely. A scoped rule (`"Bash(rm *)"`, `"Read(//abs/**)"`) leaves the tool available and denies matching calls in every mode, including `bypassPermissions`. |
| `permissionMode` | `'default' \| 'acceptEdits' \| 'bypassPermissions' \| 'plan' \| 'dontAsk' \| 'auto'` | We use `'default'` for runs and chat, `'plan'` for plan-then-approve tickets. |
| `canUseTool` | `CanUseTool` | Our UI permission prompt bridge (section 3). |
| `hooks` | `Partial<Record<HookEvent, HookCallbackMatcher[]>>` | Our audit trail (section 7). |
| `maxTurns` | `number` | Turn cap; result subtype becomes `error_max_turns` when hit. |
| `maxBudgetUsd` | `number` | Hard budget cap per query; result subtype `error_max_budget_usd`. Useful with our per-developer budget feature. |
| `systemPrompt` | `string \| string[] \| { type: 'preset'; preset: 'claude_code'; append?: string; excludeDynamicSections?: boolean }` | We use the preset with `append` (section 5.3). |
| `settingSources` | `('user' \| 'project' \| 'local')[]` | Controls CLAUDE.md, `.claude/settings.json`, skills, and `.mcp.json` loading (section 5). In 0.3.209, omitted means ALL sources load (CLI parity); `[]` means full isolation. |
| `skills` | `string[] \| 'all'` | Filter over discovered skills; `'all'` enables everything found via setting sources. |
| `mcpServers` | `Record<string, McpServerConfig>` | Extra programmatic servers (section 6). |
| `resume` | `string` | Session id to resume (section 4). |
| `forkSession` | `boolean` | With `resume`, branch into a new session id instead of continuing. |
| `resumeSessionAt` | `string` | With `resume`, resume only up to a specific message UUID. |
| `continue` | `boolean` | Resume the most recent session in `cwd` without tracking an id. Mutually exclusive with `resume`. |
| `persistSession` | `boolean` | Default `true`. Never set false for runs; resume depends on the on-disk transcript. |
| `env` | `{ [envVar: string]: string \| undefined }` | DANGER: replaces the subprocess environment wholesale when set (section 10.2). |
| `model` | `string` | Model alias or full id; defaults to the CLI default. |
| `fallbackModel` | `string` | Comma-separated fallbacks when the primary is overloaded. |
| `includePartialMessages` | `boolean` | Emits `stream_event` frames for token-level streaming; optional for our SSE. |
| `additionalDirectories` | `string[]` | Extra absolute paths Claude may access beyond `cwd`. |
| `stderr` | `(data: string) => void` | Capture subprocess stderr for diagnostics. |
| `strictMcpConfig` | `boolean` | Only use programmatically passed MCP servers, ignoring `.mcp.json` and settings. We leave this OFF for parity. |
| `enableFileCheckpointing` | `boolean` | Enables `Query.rewindFiles()`. Not needed in v1 (worktrees + git are our undo), but noted. |
| `allowDangerouslySkipPermissions` | `boolean` | Required companion to `bypassPermissions`. We never use it. |

Other verified options we do not plan to use in v1 (listed so nobody rediscovers them): `agents`, `agent`, `plugins`, `outputFormat`, `thinking`, `effort`, `settings`, `sandbox`, `sessionId`, `title`, `betas`, `toolConfig`, `toolAliases`, `forwardSubagentText`, `includeHookEvents`, `sessionStore` (alpha), `spawnClaudeCodeProcess`.

### 1.3 Tool surface decision

The spec says tools are Read/Write/Edit/Grep/Glob plus permission-gated Bash.
Two ways to get there:

1. `tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash', ...]` - an explicit base set.
2. Keep the default tool surface (or `tools: { type: 'preset', preset: 'claude_code' }`) and control behavior via permissions.

**Recommendation: option 2, with `disallowedTools` for anything we truly never want.**
Reasons:

- Restricting `tools` silently breaks flows that need extra tools: `AskUserQuestion` (clarifying questions), `Skill` (skills parity), `TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList` (the Plan panel's data source), and `ExitPlanMode` (plan-then-approve).
- The docs explicitly warn that if you pass a `tools` array you must add `AskUserQuestion` and `Skill` back yourself.
- Session parity ("superset of terminal Claude Code") is a locked spec decision, and the default surface is what the terminal has.
- Safety comes from the permission flow (deny rules run in every mode), not from hiding tools.

If we ever do restrict `tools`, the minimum viable list is:
`['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'AskUserQuestion', 'Skill', 'ExitPlanMode']`.

### 1.4 The message stream

Iterating the `Query` yields `SDKMessage` frames.
In 0.3.209 the union has ~39 members; always switch on `message.type` (and `subtype` where present) with a tolerant default branch, because the union grows across versions.

Core frames (all verified in `sdk.d.ts`):

```typescript
// type: 'system', subtype: 'init' - first frame; capture session_id here.
// {
//   type: 'system'; subtype: 'init';
//   session_id: string; uuid: UUID;
//   apiKeySource: ApiKeySource; claude_code_version: string;
//   cwd: string; tools: string[]; model: string;
//   mcp_servers: { name: string; status: string }[];
//   permissionMode: PermissionMode;
//   slash_commands: string[]; skills: string[]; output_style: string;
//   plugins: { name: string; path: string }[];
// }

// type: 'assistant' - one per model response segment.
// {
//   type: 'assistant';
//   message: BetaMessage;            // Anthropic API message: content blocks + usage + id
//   parent_tool_use_id: string | null; // non-null when emitted inside a subagent
//   uuid: UUID; session_id: string;
//   error?: SDKAssistantMessageError;
// }
// message.message.content holds 'text', 'thinking', and 'tool_use' blocks.

// type: 'user' - tool results and (replayed) user inputs.
// {
//   type: 'user';
//   message: MessageParam;           // content includes 'tool_result' blocks
//   parent_tool_use_id: string | null;
//   tool_use_result?: unknown;       // the tool's structured Output object (typed per tool)
//   uuid?: UUID; session_id?: string;
// }

// type: 'stream_event' (only with includePartialMessages: true)
// { type: 'stream_event'; event: BetaRawMessageStreamEvent; parent_tool_use_id: string | null; uuid: UUID; session_id: string }

// type: 'result' - exactly one, last semantic frame of the query.
// See 1.5.
```

Useful secondary frames for our UI (all present in 0.3.209):

- `{ type: 'system', subtype: 'status' }` - `status: 'compacting' | 'requesting' | null`, plus `permissionMode` changes; good for a status pill.
- `{ type: 'system', subtype: 'permission_denied' }` - emitted when a tool call is auto-denied without a prompt (deny rule, `dontAsk`); render the denial and audit it.
- `{ type: 'system', subtype: 'session_state_changed' }` - `state: 'idle' | 'running' | 'requires_action'`; an authoritative turn-over signal for the Needs Attention grouping.
- `{ type: 'tool_progress' }` - elapsed-time heartbeat per running tool.
- `{ type: 'system', subtype: 'task_started' | 'task_updated' | 'task_notification' | 'task_progress' }` - background task and subagent lifecycle (distinct from the TaskCreate/TaskUpdate todo tools, see section 8).

### 1.5 The result message and usage/cost data

`SDKResultMessage = SDKResultSuccess | SDKResultError` (verified):

```typescript
// Success:
// {
//   type: 'result'; subtype: 'success';
//   result: string;                       // final assistant text
//   is_error: boolean;
//   num_turns: number; duration_ms: number; duration_api_ms: number;
//   total_cost_usd: number;               // client-side ESTIMATE, not billing truth
//   usage: NonNullableUsage;              // cumulative token counts for this query() call
//   modelUsage: Record<string, ModelUsage>; // per-model breakdown
//   permission_denials: SDKPermissionDenial[];
//   stop_reason: string | null;
//   uuid: UUID; session_id: string;
// }
// Error subtypes: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd'
//                 | 'error_max_structured_output_retries'
// Error results still carry total_cost_usd, usage, modelUsage, permission_denials, and errors: string[].

// ModelUsage (verified):
// {
//   inputTokens: number; outputTokens: number;
//   cacheReadInputTokens: number; cacheCreationInputTokens: number;
//   webSearchRequests: number; costUSD: number;
//   contextWindow: number; maxOutputTokens: number;
// }
```

How usage arrives, and the rules for counting it (verified against the cost-tracking doc):

1. **Per step**: every `assistant` frame carries `message.message.usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) and `message.message.id`.
2. **Parallel tool calls share the same `message.message.id` with identical usage - deduplicate by id or you will double-count.**
3. **Per query**: the single `result` frame carries cumulative `total_cost_usd`, `usage`, and `modelUsage`; prefer it over summing steps yourself.
4. **Per session**: there is no session-level total; each `query()` call (including every `resume`) reports only its own cost, so the run record must accumulate across the gate-feedback iterations itself.
5. `total_cost_usd`/`costUSD` are estimates from a bundled price table; fine for our budget warnings, never for billing.

```typescript
const seenStepIds = new Set<string>();
let liveInputTokens = 0;
let liveOutputTokens = 0;

for await (const message of run) {
  if (message.type === "assistant" && !seenStepIds.has(message.message.id)) {
    seenStepIds.add(message.message.id);
    liveInputTokens += message.message.usage.input_tokens;
    liveOutputTokens += message.message.usage.output_tokens;
    emitCostTick(liveInputTokens, liveOutputTokens); // the "ticking cost" in the Plan panel
  }
  if (message.type === "result") {
    recordRunCost(message.total_cost_usd, message.usage, message.modelUsage);
  }
}
```

Gotcha: after yielding an error-subtype result, a single-shot (string-prompt) `query()` **throws** an error that wraps the failure text.
Wrap the iteration loop in try/catch and treat the already-received result frame as authoritative.

---

## 2. Streaming input mode (how we implement "steer")

Two input modes exist:

- **Single message mode**: `prompt` is a string; one-shot; no mid-run control methods, no interrupt, no follow-ups.
- **Streaming input mode** (the SDK's recommended default): `prompt` is an `AsyncIterable<SDKUserMessage>`; the session stays alive, accepts queued follow-up messages, images, and unlocks `interrupt()` and `setPermissionMode()`.

**All ticket runs and chats in Workbench use streaming input mode.**
Steer is literally "push another user message into the still-open iterable".

The `SDKUserMessage` you yield needs only these fields (verified: `uuid` and `session_id` are optional):

```typescript
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

const followUp: SDKUserMessage = {
  type: "user",
  message: { role: "user", content: "Stop refactoring the store; only fix the reducer." },
  parent_tool_use_id: null,
};
```

A push-channel is the cleanest bridge between our API routes and the generator:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

type Resolver = (result: IteratorResult<SDKUserMessage, void>) => void;

/** An AsyncIterable the SDK consumes; our routes push into it to steer. */
export class UserMessageChannel implements AsyncIterable<SDKUserMessage> {
  private readonly queue: SDKUserMessage[] = [];
  private readonly waiters: Resolver[] = [];
  private closed = false;

  push(content: string): void {
    if (this.closed) return;
    const message: SDKUserMessage = {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
    };
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: message, done: false });
    else this.queue.push(message);
  }

  /** End the input stream; the session finishes its current work and produces a result. */
  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage, void> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage, void>> => {
        const queued = this.queue.shift();
        if (queued) return Promise.resolve({ value: queued, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<SDKUserMessage, void>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

export function startRun(initialPrompt: string, options: Options): { run: Query; channel: UserMessageChannel } {
  const channel = new UserMessageChannel();
  channel.push(initialPrompt);
  const run = query({ prompt: channel, options });
  return { run, channel };
}

// Steering from the ticket chat: channel.push(userText)
// Interrupt (stop button): await run.interrupt()  - graceful; session persists for resume
// Hard teardown: options.abortController.abort() or run.close()
```

Notes:

- `Query.streamInput()` also exists but is documented as internal; the channel-as-prompt pattern is the documented one.
- Messages pushed while the agent is mid-turn are **queued** and processed sequentially; `interrupt()` cancels current work.
- Verified TypeScript pitfall from the docs: if your generator/channel throws, the run fails with the misleading error `Claude Code process aborted by user`; check channel code first when you see it.
- Keep the stream open while a `canUseTool` prompt is pending; do not `close()` the channel until you have seen the `result` frame.

---

## 3. canUseTool: the UI permission prompt

### 3.1 Exact signature (verified from sdk.d.ts 0.3.209)

```typescript
import type { PermissionResult, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";

type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;               // fires if the run is aborted while pending
    suggestions?: PermissionUpdate[];  // ready-made "always allow" rules to echo back
    blockedPath?: string;              // path that triggered the request, if applicable
    decisionReason?: string;           // why the flow fell through to a prompt
    title?: string;                    // full rendered prompt sentence - prefer this as the UI headline
    displayName?: string;              // short noun phrase, e.g. "Run command"
    description?: string;              // human-readable subtitle
    toolUseID: string;                 // correlates with the tool_use block and hooks
    agentID?: string;                  // set when the request came from a subagent
    requestId: string;                 // control-request envelope id
  },
) => Promise<PermissionResult | null>;

type PermissionResultShape =
  | {
      behavior: "allow";
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: PermissionUpdate[];
      toolUseID?: string;
      decisionClassification?: "user_temporary" | "user_permanent" | "user_reject";
    }
  | {
      behavior: "deny";
      message: string;
      interrupt?: boolean; // true = also stop the whole turn, not just this tool call
      toolUseID?: string;
      decisionClassification?: "user_temporary" | "user_permanent" | "user_reject";
    };
```

Hard rules (verified):

- **Never return `null`.**
  `null` means "I already sent the control response out-of-band"; an accidental `null` leaves the tool blocked forever because permission prompts have no park deadline.
- Always include `updatedInput` on allow (pass the original `input` through unchanged); CLI versions before v2.1.207 rejected allow results without it.
- The callback may stay pending indefinitely; the run pauses until it resolves.
  That pause IS our "run pauses until answered" spec behavior; no extra machinery needed.
- Resolve deny with a useful `message`; Claude reads it and adapts (this powers "suggest alternative" style denials).

### 3.2 Permission evaluation order and how allowlists interact

Verified order for every tool call:

1. **Hooks** (`PreToolUse`) - can deny outright, allow, modify input, or defer; a hook allow does NOT skip deny/ask rules.
2. **Deny rules** (`disallowedTools` + settings deny) - match blocks the call in every mode, including `bypassPermissions`.
3. **Ask rules** (settings) - a match forces the call to `canUseTool` even if an allow rule also matches.
4. **Permission mode** - `bypassPermissions` approves everything reaching this step; `acceptEdits` approves file operations; `plan` routes file edits and shell writes to `canUseTool` regardless of allow rules.
5. **Allow rules** (`allowedTools` + settings allow) - a match approves.
6. **`canUseTool`** - everything unresolved lands here; in `dontAsk` mode this step is skipped and the call is denied.

Consequences for Workbench:

- The `.forge/config.json` bash allowlist maps to scoped `allowedTools` entries such as `Bash(pnpm install)`, `Bash(pnpm run *)`.
  Matching commands auto-approve and **never reach `canUseTool`**; everything else falls through to our UI prompt.
  That is exactly the spec's allowlist semantics.
- Never put a bare `"Bash"` in `allowedTools`; it approves every command and shadows the prompt (since v2.1.198 the SDK emits a Node warning with code `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` for such shadowed callbacks).
- Read-only tools (`Read`, `Grep`, `Glob`) go in `allowedTools` bare so they never prompt.
- `AskUserQuestion` always reaches the callback even when allow rules match; route it to the clarifying-question UI, not the approve/deny UI.
- Checks that must run on EVERY call (audit) belong in hooks, not in `canUseTool`, because auto-approved calls skip the callback.

### 3.3 Pausing a Bash command on the UI (the Workbench bridge)

```typescript
import type { CanUseTool, PermissionResult, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";

interface PendingApproval {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  suggestions: PermissionUpdate[];
  resolve: (result: PermissionResult) => void;
}

const pendingApprovals = new Map<string, PendingApproval>();

export const workbenchCanUseTool: CanUseTool = async (toolName, input, context) => {
  const { signal, suggestions = [], requestId, title } = context;

  if (toolName === "AskUserQuestion") {
    return await routeToQuestionUi(input, requestId); // separate flow, returns allow + answers in updatedInput
  }

  // Everything reaching this point failed the allowlist - it is a genuine prompt.
  return await new Promise<PermissionResult>((resolve) => {
    pendingApprovals.set(requestId, { requestId, toolName, input, suggestions, resolve });
    emitRunEvent({ kind: "permission_request", requestId, toolName, title, input }); // -> SSE -> inline prompt UI
    appendAuditEvent({ kind: "bash_prompted", requestId, toolName, input });
    signal.addEventListener("abort", () => {
      pendingApprovals.delete(requestId);
      resolve({ behavior: "deny", message: "Run interrupted before a permission decision was made" });
    });
  });
};

/** Called by the POST /api/runs/:id/approvals/:requestId route when the developer clicks. */
export function resolveApproval(requestId: string, decision: "allow" | "always" | "deny"): void {
  const pending = pendingApprovals.get(requestId);
  if (!pending) return; // already resolved or aborted
  pendingApprovals.delete(requestId);

  if (decision === "deny") {
    appendAuditEvent({ kind: "bash_denied", requestId });
    pending.resolve({
      behavior: "deny",
      message: "Denied by the developer in the Workbench UI",
      decisionClassification: "user_reject",
    });
    return;
  }

  appendAuditEvent({ kind: "bash_approved", requestId, always: decision === "always" });
  pending.resolve({
    behavior: "allow",
    updatedInput: pending.input, // required: pass the original input through
    updatedPermissions: decision === "always" ? pending.suggestions : undefined,
    decisionClassification: decision === "always" ? "user_permanent" : "user_temporary",
  });
}
```

"Always allow" (verified pattern): echo the provided `suggestions` back as `updatedPermissions`; suggestions with `destination: 'localSettings'` persist to `.claude/settings.local.json` so future sessions skip the prompt.
For Workbench we may instead write the approved pattern into `.forge/config.json` ourselves and only apply session-scoped suggestions; decide at implementation time and audit either way.

The `Bash` tool input shape for rendering the prompt (verified from `sdk-tools.d.ts`): `{ command: string; timeout?: number; description?: string; run_in_background?: boolean; dangerouslyDisableSandbox?: boolean }`.

---

## 4. Session ids, resume, and forking

### 4.1 Where the session id comes from

- The `system`/`init` frame carries `session_id` as a direct field - capture it there, first thing, and persist it into the run JSONL immediately (a crash before the result frame must not lose it).
- Every `result` frame also carries `session_id`.

### 4.2 Resuming

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

// Gate-feedback loop iteration, or resume-after-restart from the ticket page:
const resumed = query({
  prompt: gateFailureFeedbackChannel, // streaming input again
  options: {
    cwd: worktreePath,        // MUST be the same cwd as the original session (see below)
    resume: savedSessionId,
    // canUseTool, hooks, allowedTools, settingSources, mcpServers must ALL be re-passed:
    // options are per-process and are NOT persisted with the session.
    ...sharedRunOptions,
  },
});
```

What persists across resume (verified):

- **The conversation** persists: prompt, every tool call, every tool result, every response; the resumed agent has full prior context.
- **The filesystem does not**: sessions persist the conversation, not file state (file checkpointing is the separate `enableFileCheckpointing` + `rewindFiles()` feature).
- **Options do not**: callbacks, hooks, permission rules, and MCP config must be supplied again on every `query()` call.
- Each resumed call produces its own `result` with its own `total_cost_usd`; accumulate per ticket.

Storage location (verified, and operationally critical for us):

- Transcripts live at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` (or `$CLAUDE_CONFIG_DIR/projects/...`), where `<encoded-cwd>` is the absolute `cwd` with every non-alphanumeric character replaced by `-`.
- **Resume looks the session up by the current `cwd`.** A resume from a different directory silently starts a fresh session instead.
- Workbench consequence: an unfinished run can only be resumed while its worktree still exists at the same path; the janitor must offer resume BEFORE removing an orphaned worktree, and the resume flow must run with `cwd` = the stored worktree path from the run JSONL.

### 4.3 Forking

```typescript
const fork = query({
  prompt: "Try the alternative approach we discussed",
  options: { cwd: worktreePath, resume: savedSessionId, forkSession: true },
});
// The fork's new id arrives on its system/init frame; the original session is untouched.
```

Forking copies the conversation history into a new session id and leaves the original intact.
Forking does NOT branch the filesystem; a forked agent editing the same worktree makes real changes.
v1 does not need forking, but it is the right primitive if we later add "retry run with different instructions" without losing the original transcript.

### 4.4 Session enumeration helpers

Verified exports for the run inspector and janitor: `listSessions()`, `getSessionMessages(sessionId)`, `getSessionInfo(sessionId)`, `renameSession()`, `tagSession()`, `deleteSession()`, `forkSession()`, `listSubagents()`, `getSubagentMessages()`.
`SDKSessionInfo` includes `sessionId`, `summary`, `lastModified`, `cwd`, `gitBranch`, and `firstPrompt` - enough for the janitor to match orphaned worktrees to dead sessions.
Note: we still keep our own run JSONL as the source of truth; these helpers read Claude's transcript store, which our split-transcript policy treats as local-only anyway.

---

## 5. settingSources: CLAUDE.md, skills, and system prompt layering

### 5.1 What each source loads (verified)

| Source | Settings file | Also loads |
|---|---|---|
| `'user'` | `~/.claude/settings.json` | `~/.claude/CLAUDE.md`, `~/.claude/skills/`, user hooks and permission rules |
| `'project'` | `<cwd>/.claude/settings.json` | `CLAUDE.md` or `.claude/CLAUDE.md` from `cwd` and every parent up to the repo root, `.claude/skills/`, **`.mcp.json`**, project hooks and permission rules, output styles |
| `'local'` | `<cwd>/.claude/settings.local.json` | Local (gitignored) overrides; where "always allow" suggestions persist |

Key verified facts:

- In 0.3.209, **omitting `settingSources` loads all sources** (CLI parity); `settingSources: []` is full isolation.
  Older SDK docs described `[]` as the default; the installed `sdk.d.ts` is explicit that omitted = all, so do not rely on stale blog posts.
- CLAUDE.md loading is controlled ONLY by setting sources, not by the `claude_code` system prompt preset.
- CLAUDE.md content is injected **into the conversation as project context, not into the system prompt**; it therefore works with any `systemPrompt` configuration and does not affect system prompt caching.
- Skills are discovered from `~/.claude/skills` (user source) and `.claude/skills` in `cwd` and its parents (project source); the `skills` option then filters which discovered skills are enabled.
- When you set the `skills` option, the SDK adds the Skill tool to `allowedTools` automatically; if you also pass an explicit `tools` array, include `'Skill'` in it yourself.

### 5.2 Workbench configuration

For session parity (locked decision 12), be explicit rather than relying on the default:

```typescript
import type { Options } from "@anthropic-ai/claude-agent-sdk";

const parityOptions: Options = {
  cwd: worktreePath,
  settingSources: ["user", "project", "local"], // exactly what terminal Claude Code loads
  skills: "all",
  systemPrompt: {
    type: "preset",
    preset: "claude_code",
    append: forgeContextPrompt, // .forge layering, see 5.3
  },
};
```

Being explicit protects us if a future SDK version changes the omitted-value default again, and it documents intent.
A caveat worth carrying: `'project'` also loads the target project's `.claude/settings.json` hooks and permission rules; that is intended (parity means their rules keep working), but our own deny rules and hooks must therefore be written to hold even when project settings add allow rules (deny beats allow, so this holds - see section 9).

### 5.3 Layering our own system prompt on top

Verified `systemPrompt` forms: custom `string`, `string[]` with a cache-boundary marker, or the `claude_code` preset with optional `append` and `excludeDynamicSections`.

**Recommendation: preset + `append`.**
The preset keeps Claude Code's tool guidance, safety rules, and coding conventions (parity again); `append` adds Workbench context without removing anything.

```typescript
const forgeContextPrompt = [
  "You are executing a Workbench ticket inside an isolated git worktree.",
  "Project knowledge:",
  projectMd, // .forge/knowledge/project.md
  "Lessons learned on this project:",
  lessonsMd, // .forge/knowledge/lessons.md
  "Ticket template checklist and required gates:",
  templateContext,
].join("\n\n");
```

Sizing note: `append` goes into every request's system prompt; if `lessons.md` grows large, move the bulky parts into the first user message instead and keep `append` for standing rules (the write-time lesson cap in the spec also protects this).

---

## 6. mcpServers: passing the project's servers through

### 6.1 The parity path costs nothing

The project's own `.mcp.json` (repo root) loads automatically when the `'project'` setting source is enabled.
So decision 12's "configured MCP servers" requirement is satisfied by the `settingSources` config from section 5.2 with zero MCP-specific code.
User-scoped servers from `~/.claude/settings.json` come with `'user'`.
Do NOT set `strictMcpConfig: true`; it would ignore `.mcp.json` and break parity.

### 6.2 Programmatic servers (verified config types)

```typescript
import type { Options } from "@anthropic-ai/claude-agent-sdk";

const withServers: Options = {
  mcpServers: {
    // stdio (local process):
    figma: {
      type: "stdio", // optional; stdio is the default when 'command' is present
      command: "npx",
      args: ["-y", "some-figma-mcp"],
      env: { FIGMA_TOKEN: figmaToken }, // per-server env, separate from options.env
      timeout: 30_000, // per-call tool timeout in ms (overrides MCP_TOOL_TIMEOUT)
    },
    // http / sse (remote):
    docs: { type: "http", url: "https://example.com/mcp", headers: { Authorization: `Bearer ${token}` } },
    // in-process SDK server: { type: 'sdk', name, instance } via createSdkMcpServer()
  },
  allowedTools: ["mcp__figma__*"], // wildcard allowed after a literal server prefix
};
```

Verified rules:

- Tool names are `mcp__<server>__<tool>`; the server segment comes from the config key.
- MCP tools need explicit permission: without an `allowedTools` entry they fall through to `canUseTool` (which for us means a UI prompt - acceptable, but noisy; allow the project's known-good servers).
- `acceptEdits` does not auto-approve MCP tools; prefer `allowedTools` wildcards over permission modes for MCP access.
- Check the `system`/`init` frame's `mcp_servers: { name, status }[]` at startup; statuses include `connected`, `failed`, `needs-auth`, `pending`; surface failures in the run UI instead of letting tools mysteriously miss.
- The SDK does not run OAuth flows; a `needs-auth` server is simply skipped for the run.
- Connection timeout is 30s (env `MCP_TIMEOUT`); tool results over 25,000 tokens are persisted to a file and replaced by a pointer message (env `MAX_MCP_OUTPUT_TOKENS`).
- Mid-session changes are possible via `Query.setMcpServers()` (streaming mode); not needed in v1.

---

## 7. Hooks: PreToolUse/PostToolUse and the audit log

### 7.1 Availability and shape (verified in 0.3.209)

Hooks are fully supported in the TypeScript SDK via `options.hooks`.
`HookEvent` in 0.3.209: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `Notification`, `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, `SessionEnd`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`, `PermissionRequest`, `PermissionDenied`, `Setup`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `Elicitation`, `ElicitationResult`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`, `InstructionsLoaded`, `CwdChanged`, `FileChanged`, `MessageDisplay`.

Callback contract (verified): `(input, toolUseID, { signal }) => Promise<HookJSONOutput>`; every input carries `session_id`, `cwd`, `hook_event_name`, and `agent_id`/`agent_type` when fired inside a subagent.
Matchers filter by tool name (`"Bash"`, `"Write|Edit"`, regex like `"^mcp__"`); omitted matcher = every event of that type.
A `PreToolUse` hook returns decisions via `hookSpecificOutput`: `permissionDecision: 'allow' | 'deny' | 'ask' | 'defer'`, `permissionDecisionReason`, `updatedInput`.
For pure side effects, return `{ async: true, asyncTimeout?: number }` to let the agent continue without waiting.

### 7.2 Hooks vs stream parsing for audit: use hooks

Verdict: **hooks fit our audit logging better than parsing the stream, and we should use both for different jobs.**

- Hooks fire for **every** tool call, including inside subagents, including auto-approved calls, and BEFORE the permission flow; the stream shows tool calls too, but auditing from a render pipeline couples compliance to UI code.
- Hooks give `toolUseID` correlation between request (`PreToolUse`) and outcome (`PostToolUse` / `PostToolUseFailure`) for free.
- `canUseTool` cannot be the audit point because allowlisted calls skip it.
- Keep stream parsing for what it is good at: rendering the live trace, the Plan panel, and cost ticks.

```typescript
import type { HookCallback, PostToolUseHookInput, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

const auditHook: HookCallback = async (input, toolUseID) => {
  if (input.hook_event_name === "PreToolUse") {
    const pre = input as PreToolUseHookInput;
    appendAuditEvent({ kind: "tool_requested", tool: pre.tool_name, toolUseID, input: pre.tool_input, sessionId: input.session_id });
  } else if (input.hook_event_name === "PostToolUse") {
    const post = input as PostToolUseHookInput;
    appendAuditEvent({ kind: "tool_completed", tool: post.tool_name, toolUseID, sessionId: input.session_id });
  }
  return { async: true }; // side-effect only; never slow the agent down
};

const hookOptions = {
  hooks: {
    PreToolUse: [{ hooks: [auditHook] }],
    PostToolUse: [{ hooks: [auditHook] }],
    PostToolUseFailure: [{ hooks: [auditHook] }],
  },
};
```

Additional verified hook facts we rely on:

- When multiple hooks match, all run in parallel and the most restrictive decision wins (`deny` > `defer` > `ask` > `allow`).
- Hook exceptions can interrupt the agent; catch errors inside the callback.
- Default hook timeout is 60 seconds per matcher (configurable via `timeout`).
- Hooks may not fire when the session dies at `maxTurns`; treat the audit trail as best-effort at the boundary and reconcile against the run JSONL.
- Shell-command hooks defined in the project's `.claude/settings.json` also run when `'project'` is in `settingSources`; that is parity behavior, and our audit hook runs regardless.

---

## 8. Parsing plan/todo events for the Plan & Progress panel

### 8.1 Which tools carry the plan (version-critical, verified)

As of TypeScript SDK **0.3.142** and Claude Code v2.1.142, sessions use the structured Task tools `TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList` by default; `TodoWrite` is legacy.
Our pinned 0.3.209 is past that line, so **the Plan panel's primary data source is TaskCreate/TaskUpdate tool_use blocks in assistant messages**.

Verified input/output shapes (from `sdk-tools.d.ts`):

```typescript
// TaskCreate input:  { subject: string; description: string; activeForm?: string; metadata?: Record<string, unknown> }
// TaskCreate OUTPUT (arrives in the matching tool_result): { task: { id: string; subject: string } }
// TaskUpdate input:  { taskId: string; subject?: string; description?: string; activeForm?: string;
//                      status?: 'pending' | 'in_progress' | 'completed' | 'deleted';
//                      addBlocks?: string[]; addBlockedBy?: string[]; owner?: string; metadata?: Record<string, unknown> }
// Legacy TodoWrite input: { todos: { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }[] }
```

Two verified parsing gotchas:

1. The task id is NOT in the `TaskCreate` input; it comes back in the tool_result (`{ task: { id, subject } }`), which arrives on a subsequent `user` frame - correlate by `tool_use_id`.
2. The streamed `tool_use` input is the raw model emission; Claude Code repairs near-miss key names (`id`/`task_id` to `taskId`, `active_form` to `activeForm`) before execution but NOT in the stream - read defensively.

### 8.2 Reference parser

```typescript
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

type PlanStatus = "pending" | "in_progress" | "completed";

interface PlanItem {
  id: string;
  subject: string;
  status: PlanStatus;
  activeForm?: string;
}

export class PlanTracker {
  readonly items = new Map<string, PlanItem>();
  private readonly pendingCreates = new Map<string, { subject: string; activeForm?: string }>();

  ingest(message: SDKMessage): boolean {
    let changed = false;

    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type !== "tool_use") continue;
        if (block.name === "TaskCreate") {
          const input = block.input as { subject?: string; activeForm?: string };
          this.pendingCreates.set(block.id, { subject: input.subject ?? "(untitled)", activeForm: input.activeForm });
        } else if (block.name === "TaskUpdate") {
          const input = block.input as {
            taskId?: string; id?: string; task_id?: string;
            status?: string; subject?: string; activeForm?: string; active_form?: string;
          };
          const taskId = input.taskId ?? input.id ?? input.task_id;
          const item = taskId ? this.items.get(taskId) : undefined;
          if (!item) continue;
          if (input.status === "deleted") {
            this.items.delete(item.id);
          } else {
            if (input.status === "pending" || input.status === "in_progress" || input.status === "completed") {
              item.status = input.status;
            }
            if (input.subject) item.subject = input.subject;
            const activeForm = input.activeForm ?? input.active_form;
            if (activeForm) item.activeForm = activeForm;
          }
          changed = true;
        } else if (block.name === "TodoWrite") {
          // Legacy path: one call rewrites the entire list.
          const input = block.input as { todos?: { content: string; status: PlanStatus; activeForm: string }[] };
          this.items.clear();
          for (const [index, todo] of (input.todos ?? []).entries()) {
            this.items.set(String(index), { id: String(index), subject: todo.content, status: todo.status, activeForm: todo.activeForm });
          }
          changed = true;
        }
      }
    }

    if (message.type === "user" && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (typeof block !== "object" || block === null) continue;
        const result = block as { type?: string; tool_use_id?: string };
        if (result.type !== "tool_result" || !result.tool_use_id) continue;
        const pending = this.pendingCreates.get(result.tool_use_id);
        if (!pending) continue;
        this.pendingCreates.delete(result.tool_use_id);
        const output = message.tool_use_result as { task?: { id?: string } } | undefined;
        const id = output?.task?.id ?? result.tool_use_id; // fall back to the tool_use id as a stable key
        this.items.set(id, { id, subject: pending.subject, status: "pending", activeForm: pending.activeForm });
        changed = true;
      }
    }

    return changed; // caller emits an SSE plan-update event when true
  }

  counts(): { done: number; total: number; current?: PlanItem } {
    const all = [...this.items.values()];
    return {
      done: all.filter((item) => item.status === "completed").length,
      total: all.length,
      current: all.find((item) => item.status === "in_progress"),
    };
  }
}
```

### 8.3 Plan-then-approve (plan mode)

For templates with plan-then-approve ON:

1. Start the session with `permissionMode: 'plan'`; Claude explores read-only and file edits are never auto-approved (verified: in plan mode edits prompt through `canUseTool` even when allow rules match).
2. Claude proposes its plan by calling the `ExitPlanMode` tool; because plan mode routes it to the permission flow, our `canUseTool` receives `toolName === 'ExitPlanMode'` - render the plan for approval there.
3. On approve: return allow and call `run.setPermissionMode('default')` (or `'acceptEdits'` if we ever choose that) so execution proceeds in the same session.
4. On reject: return deny with the developer's feedback; Claude revises the plan.

Caveat: in 0.3.209 `ExitPlanModeInput` is loosely typed (an index signature; its old `allowedPrompts` field is deprecated).
The plan text conventionally arrives as a markdown `plan` key in the tool input - **UNVERIFIED as a stable contract**; read it defensively and fall back to rendering the last assistant text before the `ExitPlanMode` call.

Do not confuse the todo Task tools with the `system` frames `task_started` / `task_updated` / `task_progress` / `task_notification`; those describe background tasks and subagents (useful for the run stream, not the Plan panel).

---

## 9. Deny-read enforcement (secrets protection)

Three mechanisms exist; we use two, layered.

### 9.1 Declarative deny rules (primary)

`disallowedTools` entries become deny rules, which are evaluated in **every** permission mode, including `bypassPermissions`, and cannot be overridden by any project allow rule (deny beats allow, verified).

```typescript
const denyReadRules: string[] = [
  "Read(//**/.env*)",     // '//' anchors at the filesystem root (absolute)
  "Read(//**/*.pem)",
  "Read(//**/*secret*)",
  // generated from the deny-read globs in .forge/config.json
];

const options = { disallowedTools: denyReadRules };
```

Verified anchor semantics: `//path` is an absolute filesystem path; a single leading `/` anchors at the rule's source, which for `allowedTools`/`disallowedTools` means the session `cwd`.
Verified adjacent fact: `Edit(path)` rules govern all file-writing tools including `Write` and `NotebookEdit`; use `Edit(...)` deny rules if we ever need write-side protection.
**UNVERIFIED**: whether `Read(...)` deny rules also gate `Grep`/`Glob` content access; the docs specify Read and Edit path rules but do not enumerate Grep.
Because of that gap, do not rely on rules alone.

### 9.2 PreToolUse hook (belt and braces, plus audit)

A `PreToolUse` hook runs before every step of the permission flow, covers subagents, covers `Grep`/`Glob` explicitly, and lets us audit the denial:

```typescript
import picomatch from "picomatch";
import type { HookCallback, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

const isDenied = picomatch(denyReadGlobsFromForgeConfig, { dot: true });

const denyReadHook: HookCallback = async (input) => {
  if (input.hook_event_name !== "PreToolUse") return {};
  const pre = input as PreToolUseHookInput;
  const toolInput = pre.tool_input as { file_path?: string; path?: string; pattern?: string };
  const target = toolInput.file_path ?? toolInput.path ?? "";
  if (target !== "" && isDenied(target)) {
    appendAuditEvent({ kind: "read_denied", tool: pre.tool_name, path: target });
    return {
      hookSpecificOutput: {
        hookEventName: pre.hook_event_name,
        permissionDecision: "deny",
        permissionDecisionReason: `Reading ${target} is blocked by the project's deny-read list`,
      },
    };
  }
  return {};
};

const hookOptions = {
  hooks: { PreToolUse: [{ matcher: "Read|Grep|Glob", hooks: [denyReadHook] }] },
};
```

### 9.3 Why not canUseTool

`canUseTool` is the wrong layer for deny-read: any allow rule (ours or the project's own `.claude/settings.json`, loaded for parity) would skip the callback entirely, silently bypassing the check.
This is a verified, documented failure mode.

### 9.4 The Bash hole, stated honestly

Neither Read rules nor the Read hook stop `Bash` running `cat .env`.
Mitigations, in order: the Bash permission prompt itself (non-allowlisted commands need a human click), allowlist hygiene (never allowlist `cat *`-shaped patterns), and the audit trail of every command.
Full shell-content interdiction would require the `sandbox` option or Bash-command parsing in a hook, both out of v1 scope; document this residual risk in the security notes.

---

## 10. Gotchas

### 10.1 Subprocess model

- Every `query()` spawns the SDK's bundled Claude Code CLI as a child process; the SDK talks to it over a control protocol on stdio.
- One live subprocess per concurrent run; our concurrency cap (3) is also a subprocess cap - fine, but remember it in memory/CPU expectations for the prepare-phase spike.
- `abortController.abort()` and `close()` kill the subprocess; `interrupt()` asks it to stop gracefully and keeps the session resumable - the stop button should use `interrupt()`, the janitor uses `close()`.
- The SDK exports an `AbortError` class for detecting aborts (`error instanceof AbortError`).
- On Next.js: only import the SDK from server-side modules (route handlers, server actions); it spawns processes and cannot run in a Client Component or edge runtime (the reference file carries the same warning).

### 10.2 env inheritance (do not wholesale-replace)

Verified verbatim behavior from `sdk.d.ts`:

> When set, this value REPLACES the subprocess environment entirely - it is not merged with `process.env`.
> When omitted, the subprocess inherits `process.env`.

Rules:

- Prefer omitting `options.env` entirely; inheritance is the default and correct for us.
- If any env var must be set (for example `CLAUDE_CODE_ENABLE_TASKS=0`), ALWAYS spread: `env: { ...process.env, CLAUDE_CODE_ENABLE_TASKS: "0" }`.
- Forgetting the spread strips `PATH`, `HOME`, and `ANTHROPIC_API_KEY` from the subprocess and produces confusing downstream failures.
- Optional courtesy: set `CLAUDE_AGENT_SDK_CLIENT_APP: "agent-workbench/<version>"` (with the spread) so our traffic is identifiable.

### 10.3 ANTHROPIC_API_KEY and auth

- The subprocess reads `ANTHROPIC_API_KEY` from its (inherited) environment; Workbench loads it from the developer's environment or `~/.agent-workbench/config.json` and injects it into `process.env` before the first `query()`.
- Reusing a Claude subscription login inside a third-party app is not permitted by Anthropic's ToS; API key is the supported path (recorded decision, see memory note `anthropic-auth-tos`).
- The `system`/`init` frame's `apiKeySource` field tells you where the key came from; log it once for diagnostics.
- Assistant frames can carry `error: 'authentication_failed' | 'billing_error' | 'rate_limit' | ...`; surface these as run failures with the specific reason.

### 10.4 NODE_ENV=test behavior

- A grep of the installed `sdk.mjs` found no `NODE_ENV` branching; **any claim that the SDK itself behaves differently under `NODE_ENV=test` is UNVERIFIED** (the bundled CLI binary was not inspectable).
- The behavior that matters is the reference project's own convention, which we port: its `isAnthropicReady()` returns false when `NODE_ENV === "test"` even if a key is present, so tests and CI always take the deterministic simulator seam and never spawn the subprocess.
- Workbench must implement the same gate at its simulator seam; this is app code, not SDK config.

### 10.5 Timeouts and limits

- There is no built-in wall-clock timeout on `query()`; a hung run hangs forever unless you race it.
- Use the reference pattern: an `AbortController` plus `setTimeout`, cleared in `finally` (see `agent-sdk-model.ts`).
- Layer the semantic guards: `maxTurns` (result subtype `error_max_turns`) and `maxBudgetUsd` (result subtype `error_max_budget_usd`); the latter doubles as a hard stop under our budget feature.
- Error results still carry cost and usage; always record cost regardless of `subtype`.
- Hooks may be skipped when a session ends at `maxTurns`; reconcile audit against the run JSONL.
- MCP: 30s connect timeout (`MCP_TIMEOUT`), per-call tool timeout (`MCP_TOOL_TIMEOUT` or per-server `timeout`), 25k-token output cap (`MAX_MCP_OUTPUT_TOKENS`).

### 10.6 Streaming input pitfalls

- If the message generator/channel throws, the run dies with the misleading `Claude Code process aborted by user` error; audit the channel code first (verified doc note).
- Do not close the input channel while a permission prompt is pending; the prompt resolves within the open session.
- After the `result` frame, keep iterating briefly if you enable `promptSuggestions` (suggestion frames arrive after the result); otherwise you can end the loop on `result`.

### 10.7 Version pinning advice

- **Pin the exact version (`"0.3.209"`, no caret) in package.json.**
- Behavior has demonstrably flipped inside the 0.3.x line: 0.3.142 made Task tools the default over TodoWrite AND removed the experimental V2 session API (`createSession()`); a caret range can silently change what our Plan panel parses.
- Some behaviors are additionally gated on the bundled CLI version (for example, allow-without-`updatedInput` tolerated from v2.1.207, `reinitialize()` from v2.1.195); the CLI ships inside the SDK package, so pinning the SDK pins the CLI.
- Record the SDK version in every run summary (the spec already mandates app version; include the SDK version alongside it) so cross-developer output differences are diagnosable.
- On upgrade: re-verify sections 1.2 (Options), 3.1 (CanUseTool), and 8.1 (todo/task tools) against the new `sdk.d.ts` before bumping.

### 10.8 Miscellaneous verified traps

- Settings files that fail to parse are silently skipped, **including their permission deny rules** (`SDKSettingsParseError` exists for surfacing this); validate `.claude/settings.json` health in the doctor/janitor flow.
- Bare-name deny rules remove tools from context before evaluation; scoped deny rules are the ones checked per-call.
- `allowedTools` does not constrain `bypassPermissions`; never rely on it as a ceiling (we do not use bypass mode at all).
- Subagents inherit `bypassPermissions`/`acceptEdits`/`auto` from the parent and cannot be tightened per subagent.
- Parallel tool calls share an assistant `message.message.id`; dedupe for cost (section 1.5).
- Session transcripts are keyed by exact `cwd`; moving or deleting a worktree orphans its sessions (section 4.2).

---

## Spec feature to SDK mechanism map

| Spec feature | Exact SDK mechanism |
|---|---|
| Permission-gated Bash with allowlist | `canUseTool` callback (pauses run until resolved) + scoped `allowedTools` entries like `Bash(pnpm run *)` from `.forge/config.json`; "always allow" via `updatedPermissions` echoing `suggestions` |
| Permission prompt UI content | `canUseTool` context fields: `title`, `displayName`, `description`, `decisionReason`, `blockedPath`, `toolUseID`, `requestId` |
| Interrupt (stop button) | `Query.interrupt()` (graceful, session stays resumable); `abortController.abort()` / `Query.close()` for hard teardown |
| Steer mid-run | Streaming input mode: `prompt` = `AsyncIterable<SDKUserMessage>` push-channel; follow-ups pushed from ticket chat |
| Resume after app restart | `session_id` captured from the `system`/`init` frame, persisted in run JSONL; `query({ options: { resume, cwd: sameWorktreePath } })`; helpers `listSessions()` / `getSessionMessages()` for the janitor |
| Gate-feedback loop | `resume` with the gate failure output as the next user message; cost accumulated across iterations from each `result` frame |
| Plan-then-approve | `permissionMode: 'plan'` + `ExitPlanMode` intercepted in `canUseTool` + `Query.setPermissionMode('default')` on approval |
| Session parity (CLAUDE.md, skills, MCP) | `settingSources: ['user', 'project', 'local']` + `skills: 'all'`; `.mcp.json` loads via the `'project'` source; `systemPrompt: { type: 'preset', preset: 'claude_code', append: forgeContext }` layers `.forge` knowledge on top |
| Plan & Progress panel | `TaskCreate` / `TaskUpdate` `tool_use` blocks in assistant frames + task ids from matching `tool_result` frames (`TodoWrite` legacy fallback); current step from `activeForm` of the `in_progress` item |
| Live run stream (SSE) | Async iteration of `Query`; `assistant` / `user` / `system` frames mapped to SSE events; optional `includePartialMessages` for token-level streaming; `tool_progress` and `status` frames for liveness |
| Audit log | `PreToolUse` / `PostToolUse` / `PostToolUseFailure` hooks with `{ async: true }` side-effect logging + `canUseTool` decision logging + `system`/`permission_denied` frames + `permission_denials` on the result |
| Cost tracking + budget | Per-step `message.message.usage` deduped by `message.message.id`; authoritative per-query `total_cost_usd` / `usage` / `modelUsage` on the `result` frame; `maxBudgetUsd` as the hard cap |
| Deny-read list | `disallowedTools: ['Read(//**/.env*)', ...]` deny rules (hold in every mode) + `PreToolUse` hook on `Read\|Grep\|Glob` matching `.forge/config.json` globs (also audits); Bash residual risk documented |
| Worktree isolation | `cwd` = worktree path per run; `additionalDirectories` if a run ever needs the parent repo |
| Deterministic simulator seam | App-level: same `SDKMessage` shapes emitted by a fake `Query`; gate on `ANTHROPIC_API_KEY` presence and `NODE_ENV !== 'test'` (ported from `agent-sdk-model.ts` / `isAnthropicReady()`) |

---

## UNVERIFIED items (carry into implementation spikes)

1. Whether `Read(...)` deny rules also gate `Grep`/`Glob` content access - mitigated by the PreToolUse hook regardless (section 9.1).
2. The exact `ExitPlanMode` input contract for the plan text in 0.3.209 (typed as an index signature); read defensively (section 8.3).
3. Any SDK/CLI-internal `NODE_ENV=test` behavior - none found in `sdk.mjs`; the CLI binary was not inspectable (section 10.4).
4. Windows-specific subprocess/worktree behavior - not covered by the docs pages fetched; the spec already mandates an explicit Windows test pass.
