# `.forge/` format specification (v1)

This is the normative specification for `.forge/`, the folder committed inside every target project repo that Agent Workbench manages.
`.forge/` is the team's shared brain: templates, knowledge, ticket records, and audit history live here as plain files, versioned by git alongside the code they describe.
Only `.forge/local/` is excluded from git; everything else in this document is committed and shared by every developer who clones the project.

This document is the source of truth for file layout and on-disk schemas.
`docs/blueprint/05-data-model.md` defines the equivalent TypeScript types and must stay in lockstep with the field names and shapes defined here.

## Conventions used throughout this document

- All JSON files use **camelCase** keys, matching the TypeScript domain model directly with no case-conversion layer.
  Decision: the spec does not mandate a JSON key casing convention; camelCase is simplest given the app is TypeScript end to end.
- All timestamps are ISO 8601 strings in UTC, e.g. `2026-07-15T14:32:10.000Z`. No file ever stores a native `Date`.
- User identity is always the string `git config user.name` + `" <"` + `git config user.email` + `">"`, e.g. `"Alex Kim <alex@company.com>"`. This is the only identity source (locked decision 2 in the spec: no auth, no server).
- Ticket ids are a slug of the title plus a 6-character lowercase hex suffix, e.g. `hero-button-a1b2c3`. Decision: format not specified by the spec; this keeps ids both readable and collision-safe.
- Run ids are `run-` plus a compact ISO timestamp (no separators) plus a 4-character hex suffix, e.g. `run-20260715T143210-x9f2`. Decision: same reasoning as ticket ids.
- App version strings are semver, e.g. `"0.4.2"`, read from the running app's own `package.json` at write time.
- Examples in this document form one consistent scenario (ticket `hero-button-a1b2c3`, user Alex Kim, date 2026-07-15) so they can be cross-referenced.

## Full directory tree

```
.forge/
  config.json                     # project config (mutable JSON)
  design-system.json               # Figma -> code mapping (mutable JSON)
  templates/
    figma-to-component/
      template.json                # template metadata (mutable JSON)
      checklist.md                 # authored checklist source (markdown)
    bug-fix/
      template.json
      checklist.md
    improvement/
      template.json
      checklist.md
    generic/
      template.json
      checklist.md
  knowledge/
    project.md                     # curated project knowledge (markdown)
    lessons.md                     # auto-learned lessons + provenance (markdown)
  tickets/
    <ticket-id>/
      ticket.json                  # ticket record (mutable JSON)
      attachments/
        figma-snapshot/
          manifest.json            # snapshot manifest (write-once JSON)
          screenshot-1.png         # node screenshot(s)
          variables.json           # extracted Figma variables
          component-structure.json # extracted Figma component tree
      chat.jsonl                   # ticket chat transcript (append-only JSONL)
      runs/
        <run-id>.summary.json      # sanitized run summary (write-once JSON)
      handover.md                  # QA handover pack (write-once markdown)
  audit/
    <YYYY-MM>.jsonl                # audit events for the month (append-only JSONL)
  .gitignore                       # written by the app; ignores local/
  local/                           # GITIGNORED - per-user, never committed
    settings.json                  # per-user UI prefs + monthly budget cap
    notes/
      <note-id>.md                 # per-user markdown notes
    runs/
      <ticket-id>/
        <run-id>.jsonl             # FULL run transcript, local only
```

Two storage shapes are used deliberately, matching the spec's git-as-database principle:

- **Append-only JSONL** (`chat.jsonl`, `audit/<YYYY-MM>.jsonl`, `local/runs/.../<run-id>.jsonl`): new lines are only ever added, never rewritten. Two developers touching the same file in parallel branches produce a textual git conflict at worst - resolved by keeping both sets of lines (order does not need to be preserved across the conflict marker; each line is independently parseable).
- **Mutable JSON** (`config.json`, `design-system.json`, `template.json`, `ticket.json`, `*.summary.json`, `manifest.json`): the whole file is rewritten on each update. Two developers editing the same ticket's `ticket.json` (e.g. both changing `status`) can produce a real git conflict; this is accepted and documented (spec locked decision 3) - resolve it like any other JSON merge conflict. In practice this is rare because most tickets are worked by one developer at a time.
- `*.summary.json`, `manifest.json`, and `handover.md` are **write-once**: written exactly once (on run completion, on snapshot capture, and on ticket completion respectively) and never edited afterward, so they carry no realistic conflict risk despite being mutable-JSON in shape.

## File-by-file specification

### `.forge/config.json`

**Purpose**: the single source of project-level configuration: which scripts to run for each gate, the package manager, concurrency limits, the base branch, and the two agent-safety lists (Bash allowlist, deny-read globs).

**Format**: mutable JSON, one object, always present (the app refuses to open a project without it and offers to scaffold defaults).

**Schema**:

| Field | Type | Default | Notes |
|---|---|---|---|
| `formatVersion` | `number` | `1` | See "Versioning rule" below. |
| `packageManager` | `"npm" \| "pnpm" \| "yarn"` | `"pnpm"` | Decision: default chosen to match the app's own stack; overridable per project. |
| `baseBranch` | `string` | `"main"` | Branch ticket branches are created from and diffed against. |
| `concurrencyCap` | `number` | `3` | Max simultaneous runs, per spec. |
| `scripts.typecheck` | `string` | `"typecheck"` | `package.json` script name for the typecheck gate. |
| `scripts.lint` | `string` | `"lint"` | `package.json` script name for the lint gate. |
| `scripts.test` | `string` | `"test"` | `package.json` script name for the test gate. |
| `scripts.storybook` | `string` | `"storybook"` | `package.json` script name used to boot Storybook inside a worktree. |
| `bashAllowlist` | `string[]` | see below | Glob/prefix patterns matched against the full command string; a match runs without a prompt. |
| `denyReadGlobs` | `string[]` | `[".env*", "*.pem", "*secret*"]` | Globs the agent's Read/Grep/Glob tools may never resolve, regardless of any other setting. |

Decision (spec gives examples, not an exhaustive default list): the default `bashAllowlist` is:

```json
["pnpm install", "pnpm run *", "pnpm exec *", "git status", "git diff*", "git log*"]
```

The final commit/push actions are never run by the agent itself (they are executed by the app via `execFile` outside the agent's Bash tool entirely, for determinism), so `git commit`/`git push` are intentionally absent from the default allowlist.

**Example**:

```json
{
  "formatVersion": 1,
  "packageManager": "pnpm",
  "baseBranch": "main",
  "concurrencyCap": 3,
  "scripts": {
    "typecheck": "typecheck",
    "lint": "lint",
    "test": "test",
    "storybook": "storybook"
  },
  "bashAllowlist": [
    "pnpm install",
    "pnpm run *",
    "pnpm exec *",
    "git status",
    "git diff*",
    "git log*"
  ],
  "denyReadGlobs": [".env*", "*.pem", "*secret*"]
}
```

**Merge-conflict posture**: mutable JSON, whole-file rewrite. Conflicts are rare (config changes infrequently) and resolved like any JSON merge conflict.

### `.forge/design-system.json`

**Purpose**: the per-project mapping from Figma variables to code tokens and from Figma components to code components, driving the figma-to-component template. The template refuses to run if this file is missing.

**Format**: mutable JSON, one object with two arrays.

**Schema**:

| Field | Type | Notes |
|---|---|---|
| `tokens` | `TokenMapping[]` | `{ figmaVariable, codeToken, category }` |
| `components` | `ComponentMapping[]` | `{ figmaComponent, codeComponent, importPath, propsMapping }` |

`TokenMapping.category` is one of `"color" \| "spacing" \| "typography" \| "radius" \| "shadow" \| "other"`.
`ComponentMapping.propsMapping` is a flat object mapping the Figma component's property names to the code component's prop names.

**Example**:

```json
{
  "tokens": [
    { "figmaVariable": "color/brand/primary", "codeToken": "--color-brand-primary", "category": "color" },
    { "figmaVariable": "spacing/md", "codeToken": "--spacing-md", "category": "spacing" }
  ],
  "components": [
    {
      "figmaComponent": "Button/Primary",
      "codeComponent": "Button",
      "importPath": "@/components/ui/Button",
      "propsMapping": { "Variant": "variant", "Size": "size", "Label": "children" }
    }
  ]
}
```

**Merge-conflict posture**: mutable JSON. Conflicts are possible when two developers extend the mapping at once; resolved like any JSON merge conflict. Expected to change slowly relative to tickets.

### `.forge/templates/<type>/template.json`

**Purpose**: metadata for one ticket type - which inputs the create-ticket form must collect, which gates the template runs, and whether a plan-approval step is required before execution.

**Format**: mutable JSON, one object per template folder. The four shipped template folders are `figma-to-component`, `bug-fix`, `improvement`, `generic`.

**Schema**:

| Field | Type | Notes |
|---|---|---|
| `type` | `TicketType` | Must match the folder name. |
| `displayName` | `string` | Shown in the template picker. |
| `description` | `string` | One-line description shown in the template picker. |
| `requiredInputs` | `TemplateInputField[]` | Rendered as form fields when this template is selected. |
| `checklistFile` | `string` | Relative path to the checklist markdown, default `"checklist.md"`. |
| `gates` | `GateName[]` | Which of the six gates run for this template. |
| `planThenApprove` | `boolean` | Default **on** for `figma-to-component`, **off** for `bug-fix` (per spec); each template sets its own value explicitly. |

`TemplateInputField` is `{ key, label, inputKind, required, placeholder?, helpText? }`, where `inputKind` is `"text" \| "textarea" \| "url" \| "file-ref"`.

**Complete example - `templates/figma-to-component/template.json`**:

```json
{
  "type": "figma-to-component",
  "displayName": "Figma to component",
  "description": "Build a production component from a Figma design using the project's design-system mapping.",
  "requiredInputs": [
    {
      "key": "figmaLink",
      "label": "Figma frame link",
      "inputKind": "url",
      "required": true,
      "placeholder": "https://figma.com/file/...",
      "helpText": "Link to the specific frame or component, not the whole file."
    },
    {
      "key": "confluenceLink",
      "label": "Confluence spec link",
      "inputKind": "url",
      "required": false
    },
    {
      "key": "jiraRef",
      "label": "Jira reference",
      "inputKind": "text",
      "required": false,
      "placeholder": "TEAM-1234"
    }
  ],
  "checklistFile": "checklist.md",
  "gates": ["typecheck", "lint", "test", "accessibility"],
  "planThenApprove": true
}
```

**Merge-conflict posture**: mutable JSON. Rare conflicts; templates change only when the team deliberately evolves its process.

### `.forge/templates/<type>/checklist.md`

**Purpose**: the human-authored, git-reviewable source of a template's default checklist. This is the file developers actually edit when the team's process changes; it is never mutated by a running ticket.

**Format**: a markdown checklist using one line convention per item:

```
- [ ] <label> (manual)
- [ ] <label> (gate:<gateName>)
```

Decision (the spec does not define a machine-readable convention for markdown checklists): `(manual)` marks a developer-checked item; `(gate:<gateName>)` binds the item to one of the six `GateName` values and auto-checks it from that gate's result. At ticket creation, the app parses this file into a `ChecklistItem[]` snapshot stored in the new ticket's `ticket.json`; each item's `id` is the kebab-case slug of its label (de-duplicated with a numeric suffix on collision). Editing `checklist.md` afterward only affects tickets created from that point on.

**Complete example - `templates/figma-to-component/checklist.md`**:

```markdown
# Figma to component checklist

- [ ] Component visually matches the Figma frame (manual)
- [ ] Storybook story added for all variants (manual)
- [ ] Uses design-system tokens, no hardcoded values (manual)
- [ ] TypeScript passes (gate:typecheck)
- [ ] Lint passes (gate:lint)
- [ ] Tests pass (gate:test)
- [ ] Accessibility review has no high-severity findings (gate:accessibility)
- [ ] Sitecore rendering/field wiring completed manually (manual)
```

**Merge-conflict posture**: plain markdown; normal git text-merge conflicts, same as any other checked-in doc.

### `.forge/knowledge/project.md`

**Purpose**: curated, developer-editable project knowledge - conventions, architecture notes, anything the team wants every agent session to know. Loaded into every session's context alongside `lessons.md`.

**Format**: free-form markdown, edited directly in the app's Knowledge page or in an editor. No required structure.

**Example**:

```markdown
# Project knowledge

## Component conventions
- All components live under `src/components/<domain>/`.
- Every component ships a Storybook story in the same folder.
- Use `cva` for variant styling, never inline conditional class strings.

## Gotchas
- The `pnpm run storybook` script takes ~40s to boot on a cold worktree; this is expected.
```

**Merge-conflict posture**: plain markdown; normal git text-merge conflicts.

### `.forge/knowledge/lessons.md`

**Purpose**: the automatically-learned lessons feed described in the spec's Learning system. Every entry carries a provenance block so a bad lesson can be traced and reverted.

**Format**: markdown, one `### Lesson <id>` section per lesson, newest first. Decision (the spec requires "one-click revert" and a provenance block but does not specify machine identification): each lesson gets a stable id in its heading (`lsn-` plus a 6-character hex suffix) so the app can locate and remove a single entry precisely - a revert is a normal git-tracked deletion of that one section.

**Schema per entry**:

```markdown
### Lesson <id>

<lesson text, 1-3 sentences>

- Ticket: <ticket id>
- User: <git identity>
- Date: <ISO date, YYYY-MM-DD>
- Source: correction | gate-failure | clarification
```

**Complete example**:

```markdown
# Lessons

### Lesson lsn-4f2a91

Prefer `Tooltip` from `@ui/overlays` over rolling a custom hover popover; the team already has an accessible one.

- Ticket: hero-button-a1b2c3
- User: Alex Kim <alex@company.com>
- Date: 2026-07-15
- Source: correction

### Lesson lsn-091ab3

The `test` gate is flaky when Storybook is booting concurrently on the same machine; prefer waiting for the Storybook-ready signal before running tests locally.

- Ticket: hero-button-a1b2c3
- User: Alex Kim <alex@company.com>
- Date: 2026-07-14
- Source: gate-failure
```

Write-time hygiene (per spec): before appending, the reflection step dedupes against existing entries and skips near-duplicates; a hard cap on lesson count forces an oldest-first review pass ("consolidate knowledge") once reached.

**Merge-conflict posture**: markdown, effectively append-only in normal operation (new sections added at the top) but individual sections can be deleted (revert) or rewritten (consolidate). Two developers both appending a lesson in parallel branches merge cleanly as long as they touch different sections; a revert racing a consolidate on the same section is a normal text conflict, resolved manually.

### `.forge/tickets/<ticket-id>/ticket.json`

**Purpose**: the ticket record - type, title, status, template-defined inputs, the per-ticket checklist snapshot, and audit-relevant metadata.

**Format**: mutable JSON, one object, folder name equals `id`.

**Schema**:

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Equals the folder name. |
| `type` | `TicketType` | `"figma-to-component" \| "bug-fix" \| "improvement" \| "generic"`. |
| `title` | `string` | |
| `status` | `TicketStatus` | `"backlog" \| "running" \| "review" \| "done" \| "rejected" \| "failed"`. |
| `jiraRef` | `string \| null` | Free-text reference to an official ticket; no integration (locked decision). |
| `inputs` | `Record<string, string>` | Keyed by the owning template's `requiredInputs[].key`. Decision: kept as flat string values for v1 simplicity; a template needing multiple values for one key would use suffixed keys (`fileRef1`, `fileRef2`) rather than an array, deferred until a real need appears. |
| `attachments` | `Attachment[]` | `{ fileName, kind, addedAt }`, `kind` is `"figma-screenshot" \| "figma-variables" \| "figma-component-structure" \| "upload"`. |
| `checklist` | `ChecklistItem[]` | Snapshot parsed from the template's `checklist.md` at creation time; mutated per-ticket from then on. |
| `gates` | `GateName[]` | Copied from the template at creation time, so later template edits do not retroactively change a ticket's requirements. |
| `planThenApprove` | `boolean` | Copied from the template at creation time. |
| `currentRunId` | `string \| null` | The active or most recent run. |
| `branchName` | `string \| null` | `forge/<ticket-id>`; set once the first run starts. |
| `createdBy` | `string` | Git identity. |
| `createdAt` | `string` | ISO timestamp. |
| `updatedAt` | `string` | ISO timestamp. |
| `source` | `TicketSource` | `"manual" \| "chat" \| "file-explorer"`. |

Note on `status`: this is the only persisted lifecycle field. The sidebar's "Needs Attention / Running / Review / Idle" grouping and the alternate kanban view's "backlog / running / review / done" columns are both **computed in the UI** from `status` plus the current run's `state` (e.g. a `running` ticket whose run is paused on `awaiting-permission` or `awaiting-plan-approval` is grouped into Needs Attention) - they are not separate stored fields. Decision: the spec names `rejected` implicitly (worktree removed, branch kept) and a distinct mid-run-failure outcome (WIP commit, same cleanup as rejection); these are modeled as two separate terminal statuses (`rejected` = explicit developer decision, `failed` = system-detected failure) since the audit and UI both need to distinguish "I said no" from "it broke," even though both end with a kept branch and a removed worktree.

**Complete example**:

```json
{
  "id": "hero-button-a1b2c3",
  "type": "figma-to-component",
  "title": "Hero CTA button component",
  "status": "review",
  "jiraRef": "TEAM-1234",
  "inputs": {
    "figmaLink": "https://figma.com/file/abc123/Marketing?node-id=42-100",
    "confluenceLink": "",
    "jiraRef": "TEAM-1234"
  },
  "attachments": [
    { "fileName": "figma-snapshot/manifest.json", "kind": "figma-component-structure", "addedAt": "2026-07-15T14:30:00.000Z" },
    { "fileName": "figma-snapshot/screenshot-1.png", "kind": "figma-screenshot", "addedAt": "2026-07-15T14:30:00.000Z" }
  ],
  "checklist": [
    {
      "id": "component-visually-matches-the-figma-frame",
      "label": "Component visually matches the Figma frame",
      "origin": "manual",
      "gate": null,
      "checked": false,
      "checkedBy": null,
      "checkedAt": null,
      "note": null
    },
    {
      "id": "typescript-passes",
      "label": "TypeScript passes",
      "origin": "command",
      "gate": "typecheck",
      "checked": true,
      "checkedBy": null,
      "checkedAt": "2026-07-15T14:41:02.000Z",
      "note": "0 errors."
    }
  ],
  "gates": ["typecheck", "lint", "test", "accessibility"],
  "planThenApprove": true,
  "currentRunId": "run-20260715T143210-x9f2",
  "branchName": "forge/hero-button-a1b2c3",
  "createdBy": "Alex Kim <alex@company.com>",
  "createdAt": "2026-07-15T14:28:00.000Z",
  "updatedAt": "2026-07-15T14:41:10.000Z",
  "source": "manual"
}
```

**Merge-conflict posture**: mutable JSON, whole-file rewrite. `status` changes are the most likely field to conflict when two developers touch the same ticket; accepted per spec and resolved like any JSON merge conflict.

### `.forge/tickets/<ticket-id>/attachments/figma-snapshot/manifest.json`

**Purpose**: describes the Figma context snapshot taken at ticket creation, so the agent and the visual-compare feature both know what was captured and where.

**Format**: write-once JSON, written once by the Figma snapshot step and never edited afterward.

**Schema**: `{ nodeId, nodeName, capturedAt, screenshots, variablesFile, componentStructureFile }` where `screenshots` is a list of relative file names.

**Example**:

```json
{
  "nodeId": "42:100",
  "nodeName": "Hero / CTA Button",
  "capturedAt": "2026-07-15T14:30:00.000Z",
  "screenshots": ["screenshot-1.png"],
  "variablesFile": "variables.json",
  "componentStructureFile": "component-structure.json"
}
```

**Merge-conflict posture**: write-once; no realistic conflict since it is written exactly once per ticket at creation and never touched again.

### `.forge/tickets/<ticket-id>/chat.jsonl`

**Purpose**: the ticket's chat thread - the steering channel during a run and the iteration channel after.

**Format**: append-only JSONL, one `ChatMessage` per line: `{ id, role, text, at, author }` where `role` is `"user" \| "assistant" \| "system"` and `author` is the git identity for user messages, `null` otherwise.

**Example**:

```
{"id":"msg-1","role":"user","text":"Can you use the design-system Tooltip instead of a custom one?","at":"2026-07-15T14:35:00.000Z","author":"Alex Kim <alex@company.com>"}
{"id":"msg-2","role":"assistant","text":"Done - swapped in `@ui/overlays` Tooltip and removed the custom popover.","at":"2026-07-15T14:35:40.000Z","author":null}
```

Decision: the global (non-ticket) chat has no dedicated shared file. It lives only in application memory until its first file edit, at which point the app auto-creates a ticket and that conversation becomes this ticket's `chat.jsonl` from that point forward (matching the spec's "chat auto-tickets are records only" behavior without inventing an extra committed file for pre-edit conversation).

**Merge-conflict posture**: append-only JSONL; conflicts are rare and resolve by keeping both sets of lines.

### `.forge/tickets/<ticket-id>/runs/<run-id>.summary.json`

**Purpose**: the sanitized, committed record of one run - everything a teammate needs to understand what happened, with **no file contents ever included** (per spec locked decision 11).

**Format**: write-once JSON, written once when a run reaches a terminal state (`completed`, `rejected`, `interrupted`, or `failed`).

**Schema**:

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Run id, equals the file's base name. |
| `ticketId` | `string` | |
| `state` | `RunState` | The terminal state reached. |
| `filesTouched` | `FileTouch[]` | `{ path, kind }`, `kind` is `"added" \| "modified" \| "deleted"`. Paths only, never contents or diffs. |
| `commandsRun` | `CommandRecord[]` | `{ command, source, exitCode, durationMs }`, `source` is `"allowlisted" \| "approved"`. |
| `gates` | `Gate[]` | Final gate results for this run. |
| `iteration` | `number` | How many gate-feedback retry iterations occurred (0-3). |
| `cost` | `CostRecord` | Total token usage and cost for the run. |
| `approval` | `ApprovalDecision \| null` | Present once a human has approved or rejected the run. |
| `startedAt` / `endedAt` | `string` | ISO timestamps. |
| `durationMs` | `number` | Wall-clock run duration. |
| `appVersion` | `string` | The app version that produced this run. |

**Complete example**:

```json
{
  "id": "run-20260715T143210-x9f2",
  "ticketId": "hero-button-a1b2c3",
  "state": "completed",
  "filesTouched": [
    { "path": "src/components/ui/HeroButton.tsx", "kind": "added" },
    { "path": "src/components/ui/HeroButton.stories.tsx", "kind": "added" }
  ],
  "commandsRun": [
    { "command": "pnpm install", "source": "allowlisted", "exitCode": 0, "durationMs": 18342 },
    { "command": "pnpm run typecheck", "source": "allowlisted", "exitCode": 0, "durationMs": 4210 }
  ],
  "gates": [
    { "name": "typecheck", "basis": "command", "status": "passed", "score": 100, "explanation": "0 errors.", "durationMs": 4210 },
    { "name": "accessibility", "basis": "heuristic", "status": "passed", "score": 92, "explanation": "No high-severity findings; one low-severity contrast note.", "durationMs": 3100 }
  ],
  "iteration": 0,
  "cost": { "inputTokens": 48210, "outputTokens": 9110, "cacheReadTokens": 22000, "cacheWriteTokens": 4800, "costUsd": 0.87 },
  "approval": { "decidedBy": "Alex Kim <alex@company.com>", "approved": true, "note": "Looks good, ship it.", "decidedAt": "2026-07-15T14:42:00.000Z" },
  "startedAt": "2026-07-15T14:32:10.000Z",
  "endedAt": "2026-07-15T14:42:05.000Z",
  "durationMs": 595000,
  "appVersion": "0.4.2"
}
```

**Merge-conflict posture**: write-once; run ids are unique per run, so no two developers ever write the same summary file. No realistic conflict.

### `.forge/tickets/<ticket-id>/handover.md`

**Purpose**: the QA handover pack, generated on ticket completion, viewable and exportable from the UI.

**Format**: write-once markdown, generated from a `HandoverPack` data object (see doc 05) and never edited by hand afterward (regenerated wholesale if the ticket is reopened and re-completed).

**Complete example**:

```markdown
# Handover: Hero CTA button component

**Ticket**: hero-button-a1b2c3 · **Run**: run-20260715T143210-x9f2 · **Generated**: 2026-07-15T14:43:00.000Z

## Summary
Added a new `HeroButton` component matching the Figma "Hero / CTA Button" frame, with a Storybook story covering all three variants.

## Files changed
- `src/components/ui/HeroButton.tsx` (added)
- `src/components/ui/HeroButton.stories.tsx` (added)

## How to see it
- Storybook: http://localhost:6006/?path=/story/ui-herobutton--primary
- Route: n/a (component-only change)

## Gate results
| Gate | Status | Score |
|---|---|---|
| typecheck | passed | 100 |
| lint | passed | 100 |
| test | passed | 100 |
| accessibility | passed | 92 |

## Checklist state
- [x] Component visually matches the Figma frame
- [x] Storybook story added for all variants
- [ ] Sitecore rendering/field wiring completed manually

## Remaining manual test todos
- Verify keyboard focus ring against the design-system focus token in dark mode.

## Visual compare
![Figma vs Storybook](../attachments/figma-snapshot/screenshot-1.png)
```

**Merge-conflict posture**: write-once; regenerated wholesale on each completion, so conflicts are unlikely outside two concurrent completions of the same ticket, which is prevented by the concurrency model (one active run per ticket).

### `.forge/audit/<YYYY-MM>.jsonl`

**Purpose**: the append-only audit trail for every file-modifying action taken through the app, filterable by user, ticket, and date.

**Format**: append-only JSONL, one file per calendar month, one `AuditEvent` per line.

**Full event-type list** (from the spec, verbatim):

1. `ticket-created`
2. `run-started`
3. `run-interrupted`
4. `run-steered`
5. `run-approved`
6. `run-rejected`
7. `chat-auto-ticket-created`
8. `bash-command-approved`
9. `bash-command-allowlisted`
10. `bash-command-denied`
11. `lesson-added`
12. `lesson-reverted`
13. `knowledge-consolidated`
14. `handover-generated`

**Common fields on every event**: `user` (git identity), `at` (ISO timestamp), `ticketId` (`string | null` - `knowledge-consolidated` is not ticket-scoped), `detail` (a short human-readable summary line), `appVersion`. Each `kind` additionally carries the structured fields specific to that event (see doc 05 for the exact discriminated union).

**Example lines**:

```
{"kind":"ticket-created","at":"2026-07-15T14:28:00.000Z","user":"Alex Kim <alex@company.com>","ticketId":"hero-button-a1b2c3","detail":"created figma-to-component ticket \"Hero CTA button component\"","appVersion":"0.4.2","ticketType":"figma-to-component","title":"Hero CTA button component"}
{"kind":"run-started","at":"2026-07-15T14:32:10.000Z","user":"Alex Kim <alex@company.com>","ticketId":"hero-button-a1b2c3","detail":"started run run-20260715T143210-x9f2","appVersion":"0.4.2","runId":"run-20260715T143210-x9f2"}
{"kind":"bash-command-allowlisted","at":"2026-07-15T14:32:15.000Z","user":"Alex Kim <alex@company.com>","ticketId":"hero-button-a1b2c3","detail":"ran `pnpm install`","appVersion":"0.4.2","runId":"run-20260715T143210-x9f2","command":"pnpm install"}
{"kind":"run-approved","at":"2026-07-15T14:42:00.000Z","user":"Alex Kim <alex@company.com>","ticketId":"hero-button-a1b2c3","detail":"approved run run-20260715T143210-x9f2 on branch forge/hero-button-a1b2c3","appVersion":"0.4.2","runId":"run-20260715T143210-x9f2","note":"Looks good, ship it."}
```

Note on naming overlap: the local run transcript (below) also has an event of kind `"run-started"`. These are two independent event systems - the audit trail (one line per audited action, committed) and the full run transcript (every SDK event, local-only) - and the shared name is intentional, not a schema collision.

**Merge-conflict posture**: append-only JSONL; conflicts are rare (each developer's actions append to the same month's file) and resolve by keeping both sets of lines.

### `.forge/.gitignore`

**Purpose**: the mechanism that keeps `.forge/local/` out of git without touching the target project's own root `.gitignore`.

**Format**: plain text, written once by the app the first time it initializes `.forge/` in a project, and re-verified (recreated if missing) on every launch.

**Exact contents**:

```
local/
```

Decision: a scoped `.forge/.gitignore` is used instead of appending to the project's root `.gitignore`, since it is self-contained, never produces a merge conflict with the project's own ignore rules, and is obviously legible as "this folder governs `.forge/` only."

### `.forge/local/settings.json`

**Purpose**: per-user UI preferences and the personal monthly budget cap.

**Format**: mutable JSON, gitignored, never shared.

**Schema**: `{ monthlyBudgetUsd: number, theme: "light" | "dark" | "system" }`. Decision: `theme` is a reasonable per-user UI preference to seed this file with; more preferences are added here as the UI grows, never requiring a shared-file schema change.

**Example**:

```json
{
  "monthlyBudgetUsd": 50,
  "theme": "system"
}
```

**Merge-conflict posture**: n/a - gitignored, never committed, so it never conflicts.

### `.forge/local/notes/<note-id>.md`

**Purpose**: per-user markdown notes, private, never shared, never audited.

**Format**: free-form markdown, one file per note, gitignored.

**Merge-conflict posture**: n/a - gitignored.

### `.forge/local/runs/<ticket-id>/<run-id>.jsonl`

**Purpose**: the FULL local transcript of one run - every Agent SDK event, reviewable in-app by the person who ran it, never committed. This is also the resume source: on app restart, the janitor reconstructs a run's live state by reading this file's `run-started` event (session id, worktree path) plus the most recent `phase-change` event (current state).

**Format**: append-only JSONL, one `RunEvent` per line. See doc 05 for the full discriminated union (16 event kinds: `run-started`, `plan-proposed`, `plan-decision`, `todo-update`, `message`, `steer-message`, `tool-use`, `tool-result`, `permission-request`, `permission-decision`, `bash-command`, `gate-result`, `gate-retry-projection`, `cost-update`, `phase-change`, `error`).

**Example (abridged)**:

```
{"seq":1,"at":"2026-07-15T14:32:10.000Z","kind":"run-started","sessionId":"sess-8b2c","worktreePath":"/Users/alex/.agent-workbench/worktrees/8f2a/hero-button-a1b2c3","branchName":"forge/hero-button-a1b2c3"}
{"seq":2,"at":"2026-07-15T14:32:11.000Z","kind":"phase-change","from":"preparing","to":"planning"}
{"seq":3,"at":"2026-07-15T14:32:40.000Z","kind":"plan-proposed","planMarkdown":"1. Read the Figma snapshot and design-system mapping.\n2. Scaffold HeroButton.tsx.\n3. Add Storybook story.\n4. Run gates."}
{"seq":4,"at":"2026-07-15T14:33:00.000Z","kind":"plan-decision","decision":"approved","note":""}
{"seq":5,"at":"2026-07-15T14:33:05.000Z","kind":"tool-use","toolUseId":"tu-1","toolName":"Write","input":{"file_path":"src/components/ui/HeroButton.tsx"}}
{"seq":6,"at":"2026-07-15T14:33:06.000Z","kind":"tool-result","toolUseId":"tu-1","output":"File written.","isError":false}
{"seq":7,"at":"2026-07-15T14:41:00.000Z","kind":"gate-result","gate":{"name":"typecheck","basis":"command","status":"passed","score":100,"explanation":"0 errors.","durationMs":4210}}
{"seq":8,"at":"2026-07-15T14:42:00.000Z","kind":"cost-update","cumulative":{"inputTokens":48210,"outputTokens":9110,"cacheReadTokens":22000,"cacheWriteTokens":4800,"costUsd":0.87}}
{"seq":9,"at":"2026-07-15T14:42:05.000Z","kind":"phase-change","from":"awaiting-approval","to":"completed"}
```

**Merge-conflict posture**: n/a - gitignored, per-user, never committed.

## Versioning rule

`config.json.formatVersion` is the single version marker for the entire `.forge/` format; no other file carries its own version field.

- Current value: `1`.
- On launch, before reading any other `.forge/` file, the app reads `config.json.formatVersion`.
- If it is **lower** than the version the running app supports, the app runs its migration chain sequentially (v1 -> v2 -> ... -> current), each migration step rewriting whichever files changed shape and bumping `formatVersion` by one; the app shows a diff and requires explicit confirmation before writing, since this mutates shared, committed files.
- If it is **higher** than the version the running app supports (an older app opening a repo touched by a newer one), the app opens the project read-only and prompts the developer to update the app, rather than risking a lossy downgrade write.
- No migrations exist yet at `formatVersion: 1`; this section exists so the first breaking format change has a defined home.
