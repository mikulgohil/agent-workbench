# 09 - Testing Strategy

This document expands the spec's "Testing strategy" section (docs/specs/2026-07-15-agent-workbench-v1-design.md) into a concrete, phase-aware strategy.
The governing philosophy is ported from the Forge reference app: **everything around the agent is tested offline and deterministically; the live agent session itself is never in CI.**

## Test pyramid for this app

From widest to narrowest:

1. **Unit tests (vitest, node environment) - the bulk.**
   Pure functions (reducers, grouping, formatting, gate scoring, lesson parsing) tested with plain inputs, and filesystem modules (forge store, JSONL, audit writer, worktree lifecycle) tested against scratch directories and scratch git repos in `os.tmpdir()`.
   Fast, parallel, zero external dependencies, colocated as `*.test.ts` next to the module.
2. **Integration tests (vitest, same runner) - a solid middle.**
   Route handlers (`POST`/`GET` exports) invoked directly as functions with real `Request` objects; the run manager pumping the real simulator into the real store; SSE responses read to completion and parsed as frames.
   Still fully offline and deterministic; no dev server, no browser.
3. **E2E tests (Playwright CLI) - few and scenario-shaped.**
   The real Next.js dev server, a fresh fixture project per run, and the deterministic simulator as the event source.
   These verify the wiring the unit layers cannot see: SSE over HTTP, EventSource in a real browser, server-component refresh, and visible UI state.
   Playwright is always driven via the CLI (`pnpm exec playwright test`), never the MCP plugin.
4. **Manual verification (documented recipe) - the tip.**
   The only layer that touches the real Agent SDK, executed by a human with a real key against a scratch project, before any release that changed the execution core.

Rough proportion target: if the suite drifts toward more e2e than integration tests, or scenarios appear in e2e that a route-handler test could cover, pull them down the pyramid.

## What the deterministic simulator seam covers

The simulator (`src/lib/sim/simulator.ts`) emits the exact `RunEvent` protocol the real Agent SDK adapter emits behind the same seam.
Everything downstream of the seam is therefore testable offline:

- The event protocol itself (ordering, seq monotonicity, todo list proposed before execution, terminal phase-change).
- The `RunView` reducer and the Plan & Progress panel state derived from it.
- The SSE transport: replay of buffered events, live streaming, stream termination after the terminal `phase-change` event.
- Ticket lifecycle transitions driven by runs (backlog -> running -> review).
- The whole UI: sidebar grouping, create flow, run view, gate badges, cost ticker - in both vitest (logic) and Playwright (rendering).
- Demos and UI development without burning tokens.
- From Phase 2 on: scripted failure and interrupt variants of the simulator cover gate-failure feedback, permission-prompt pauses, interrupt/WIP-commit, and resume flows in e2e without a live model.

What the simulator deliberately cannot cover (and manual verification must):

- Real Agent SDK behavior: session parity (CLAUDE.md, skills, MCP servers), streaming input for steer, session resume semantics.
- Real token usage and cost numbers.
- Real command execution inside worktrees (installs, gates against a real repo, Storybook boot).
- Model output quality (whether the generated component is any good).

## Unit-test inventory per module

Modules land in different phases; each row states its phase so the inventory doubles as a build checklist.

| Module | Phase | Test approach | Key scenarios |
|---|---|---|---|
| `forge/types` + guards | 1 | pure | union guards, compile-time event coverage check, terminal-event narrowing |
| `forge/ids` | 1 | pure | prefix format, uniqueness, ISO timestamps |
| `forge/jsonl` | 1 | scratch dir | missing file returns `[]`, append order preserved, nested dir creation, blank-line tolerance; Phase 3 adds corrupt-line handling policy |
| `forge/store` (init/config) | 1 | scratch dir | skeleton idempotence, `.gitignore` shields `local/`, default config written once, partial config merges over defaults |
| `forge/store` (tickets) | 1 | scratch dir | create/read/list/status-update round trips, newest-first ordering, unknown-id behavior |
| `sim/simulator` | 1 | pure async | determinism (two runs deep-equal), event ordering, each todo in_progress exactly once then completed, command-basis gate results, monotone cost |
| `run/reducer` | 1 | pure | full-fold into a completed `RunView`, mid-fold in_progress todo tracking, preparing -> planning phase-change, immutability |
| `run/manager` | 1 | scratch dir | completion updates ticket status, late-subscriber replay, live-subscriber exactly-once delivery, latest-run lookup |
| `ticket-draft`, `group-tickets`, `format`, `describe-event` | 1 | pure | title derivation and truncation, status-to-group mapping, cost/progress strings, one-liner per event variant |
| API routes (`/api/tickets`, `/api/runs/[runId]/stream`) | 1 | handler-as-function | validation errors, created ticket + run ids, SSE frame count and termination, 404s |
| **worktree lifecycle** | 2 | **scratch git repos in tmpdir** | `git init` a scratch repo, add commits, then: worktree create with `forge/<slug>` branch, list, remove; approval commit on the branch; WIP commit on interrupt; branch survives worktree removal; janitor detects an orphaned worktree dir; path behavior asserted with `node:path` so the suite stays Windows-honest |
| prepare phase | 2 | scratch dir + fake runner | install command selection from `packageManager`, concurrent status reporting, failure surfaces as a run event |
| permission gate | 2 | pure + fixture config | allowlist glob matching (`pnpm run *`), deny-by-default, every decision produces an audit event |
| **gate scoring** | 2 | **fixture command outputs** | exit-code 0/1 mapping to passed/failed, parsed summaries from captured stdout fixtures (tsc, eslint, vitest), missing-script-means-warning rule, timeout maps to failed with truncated output, `basis: "command"` vs `basis: "heuristic"` tagging |
| transcript split writer | 2 | scratch dir | full transcript lands under `.forge/local/runs/`, summary under the ticket contains no file contents, both reference the same run id |
| cost tracking + budget | 2 | pure | usage-to-USD from pricing tables, monthly aggregation, warn threshold, explicit override past cap |
| **audit writer** | 3 | scratch dir + JSONL | event shape (user, ISO time, ticket id, type, detail, `appVersion`), month-file naming (`YYYY-MM.jsonl`), append-only (existing lines never rewritten), filter queries by user/ticket/date |
| checklist state | 3 | pure | command-backed items auto-check from gate results, manual items toggle, mixed-state summary |
| diff summarization | 3 | fixture diffs | branch-vs-base stat parsing, large-file capping |
| figma snapshot mapper | 4 | fixture API payloads | variables/components extraction from captured Figma REST responses, snapshot file layout under `attachments/` |
| `design-system.json` validation | 4 | fixture files | mapping completeness check, refuse-to-run error with setup path when missing |
| visual compare | 4 | fixture images | screenshot pairing and naming, overlay metadata; pixel work stays manual/e2e |
| **lesson append/revert** | 5 | scratch dir | provenance block format (ticket id, user, date, source), near-duplicate skipped at write time, hard cap triggers oldest-first review state, revert removes exactly one lesson and leaves the rest byte-identical |
| **handover generation** | 5 | fixture data | markdown assembled from fixture ticket + gates + checklist + screenshots list, every section present, no empty-section headers, stable output for identical input |
| chat auto-ticket | 5 | scratch dir | first file edit creates exactly one `generic` record, read-only chats create nothing, record appears in the Chat activity lane query |

Shared rule: any test that touches the filesystem gets a fresh scratch dir from `src/test/helpers.ts` (`mkdtemp` in `os.tmpdir()`) and cleans it up in `afterEach`; no test ever reads or writes the app repo or a real project.

## Playwright e2e scenarios

All e2e runs use: the dev server started by Playwright's `webServer`, `FORGE_PROJECT_DIR` pointed at a freshly rebuilt fixture project (`e2e/global-setup.ts`), and `FORGE_SIM_DELAY_MS=25` so streams are fast but still observably progressive.
From Phase 2 the fixture project becomes a scratch **git repo** with a minimal package.json and stub scripts, so worktree and commit flows are real git operations against a throwaway repo.

| Scenario | Phase | What it proves |
|---|---|---|
| Smoke: create task, watch simulated run complete, sidebar regroups to Review | 1 | the whole loop: create box -> API -> store -> simulator -> SSE -> reducer -> panel -> refresh |
| Replay: revisit a finished task and see the rebuilt panel | 1 | SSE replay of buffered events for completed runs |
| Interrupt: stop a running (simulated) task, see interrupted state and WIP branch info | 2 | abort path, cleanup messaging, Needs Attention behavior |
| Permission prompt: simulated non-allowlisted command pauses the run; approve and deny variants | 2 | prompt rendering, run pause/resume, audit entries |
| Plan-then-approve: template-gated run waits for plan approval before executing | 2 | approval flow and Needs Attention grouping |
| Approve ticket: approve a completed run and verify branch + commit exist in the fixture repo | 2 | the git-facing contract, asserted with `git log` in the test |
| Review surfaces: open diff and checklist for a completed ticket, tick a manual item | 3 | review page wiring against fixture branch data |
| Figma template: mapping-missing refusal shows the setup path | 4 | the refuse-to-run rule end to end |
| Global chat: file-modifying chat creates an auto-ticket in the Chat activity lane | 5 | chat-to-record loop with the simulator |

E2e discipline: semantic locators (`getByRole` first), no `waitForTimeout`, one concept per test, and every scenario must pass against the simulator only - a scenario that needs a live model is by definition a manual-recipe item, not an e2e test.

## Manual verification recipe: the real Agent SDK path

This is the documented, human-executed recipe for the layer CI cannot cover.
Run it before any release that changed the execution core (session setup, permissions, gates, worktrees, streaming), and record the date and outcome in docs/research/ or the release notes.

Prerequisites:

- `ANTHROPIC_API_KEY` exported in the shell (from the developer's environment or `~/.agent-workbench/config.json`; never from any project repo).
- A scratch project: a real but disposable git repo with a working `package.json`, the scripts named in `.forge/config.json` (typecheck, lint, test), a CLAUDE.md, and `.forge/` initialized.
- Budget awareness: a small ticket run costs real money; keep the ticket genuinely small.

Steps:

1. `FORGE_PROJECT_DIR=<scratch project> pnpm dev` and open the app.
2. Confirm the real model is selectable/active (key detected) and the simulator badge is gone.
3. Create a small figma-to-component ticket (or bug-fix ticket before Phase 4) with a real prompt.
4. Watch the Plan & Progress panel: the plan must come from the live session, steps must tick, and cost must show real token-derived numbers.
5. Trigger a permission prompt: include an instruction that requires a non-allowlisted command, and verify the run pauses, the prompt renders, and both approve and deny behave and are audited.
6. Interrupt a run mid-step and verify the WIP commit exists on the ticket branch; resume or cleanly fail it from the ticket page.
7. Let a run complete: verify real gate results, review the diff, and approve; verify the local commit on the `forge/<slug>` branch and the worktree removal.
8. Inspect `.forge/`: run summary committed without file contents, full transcript present under `.forge/local/runs/`, audit events for every mutating step, and `git status` in the scratch project showing only expected changes.
9. Session-parity spot check: ask the agent something answerable only from the project's CLAUDE.md or a project skill, and confirm it answers accordingly.

## CI shape (GitHub Actions)

One workflow, four jobs (or one job with four steps while the suite is small), on every push and PR:

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm exec playwright install chromium --with-deps
      - run: pnpm e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

Notes:

- The e2e job runs entirely on the simulator; `FORGE_PROJECT_DIR` and `FORGE_SIM_DELAY_MS` come from `playwright.config.ts`, so CI needs no extra env.
- Windows coverage: before team rollout (Phase 2 exit), add a `windows-latest` matrix entry for `pnpm test` so the worktree and path-handling units run on Windows in CI, even if e2e stays Linux-only.
- Zero tolerance for rot: a flaky test is treated as a failing test - fix or delete, never `.skip`.

## The live-session rule (explicit and non-negotiable)

**The live Agent SDK session is never exercised in CI.**

- No `ANTHROPIC_API_KEY` is ever configured as a secret for test or e2e jobs; if a key leaks into the environment, the code guard below still keeps tests deterministic.
- The readiness guard (ported from Forge's `isAnthropicReady()`) returns false whenever `NODE_ENV === "test"` or `CI` is set, regardless of key presence, so the simulator is always the event source in test contexts.
- Any test that would need a live model response is, by definition, a manual-recipe item and must be moved to the recipe above.
- PR checklist item: a change to the execution core states either "manual recipe run on <date>: pass" or "not required because <reason>".

The reasons are cost (every CI run would spend real tokens), determinism (model output varies run to run, so assertions rot into flakiness), and secrecy (no API key belongs in CI for this repo).
The simulator seam exists precisely so this rule costs nothing in coverage for everything the team can control.
