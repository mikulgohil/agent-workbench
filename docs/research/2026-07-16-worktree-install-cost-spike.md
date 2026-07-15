# Worktree install-cost spike

Required by docs/blueprint/08-roadmap.md Phase 2 entry criteria, before any Phase 2 build work starts.
Question: is a fresh `git worktree add` + dependency install ready inside roughly the agent's planning window, or does the prepare-phase design need a mitigation before Phase 2 is implemented?

## Method

Target repo: `~/Developer/learning/experiments/vibe-kanban`, chosen because it is a real, substantial, actively-developed pnpm workspace (multiple packages under `packages/*`, not a toy fixture), and because it is not a client repo (this machine's work directories hold real client codebases that should not be used for an experimental spike without separate authorization).
The repo is a Rust + TypeScript monorepo; only the pnpm-managed JS/TS install cost is in scope here, since that is what Agent Workbench's prepare phase will run against a typical target project.

Three timed operations, each with a fresh worktree so results are not skewed by filesystem cache from a prior run in the same directory:

1. `git worktree add` timing (baseline, always cheap).
2. `pnpm install` using this machine's real global pnpm content-addressable store (the store already had many unrelated packages cached from normal personal use - this approximates a developer's day-to-day machine, not a clean CI runner).
3. `pnpm install` using a freshly emptied, isolated `--config.store-dir` (no cache at all for this dependency set), then a second `pnpm install` into a second fresh worktree reusing that now-populated isolated store, to isolate "first ever install on this machine" from "repeat install once the store is warm."

All worktrees and the isolated store directory were created under the session scratchpad and fully removed afterward (`git worktree remove --force` + `git worktree prune` + branch deletion); the target repo's own working tree and branch list were verified clean before and after.

No Storybook script exists in vibe-kanban's `package.json` or any `packages/*/package.json`, so Storybook boot cost could not be measured this pass - see "What is not covered" below.

## Numbers

| Operation | Wall time |
|---|---|
| `git worktree add` (new branch, no dependency install) | 0.72-0.85s |
| `pnpm install`, this machine's real (already-warm) global store | 63.5s |
| `pnpm install`, freshly isolated store, no cache at all (cold) | 56.5s |
| `pnpm install`, second worktree, reusing the now-warm isolated store | 26.1s |

`node_modules` size after install: 993M across the workspace's packages.

The cold-store run (56.5s) and the "this machine's real global store" run (63.5s) come out close to each other; the real global store on this machine already contained some overlapping packages from unrelated projects, but evidently not enough of this project's specific dependency graph to show a large speedup over a fully empty store - most of the ~60s in both cases is dominated by extraction/linking/postinstall work (`core-js`, `esbuild`, `@sentry/cli` all ran postinstall scripts), not network fetch. The clean signal is the warm-repeat number: once the exact dependency set is already resolved and unpacked in the store (the second worktree's install), the cost drops to 26.1s - roughly 2.2-2.4x faster than either "first install" scenario.

## Verdict

**Proceed as designed, with one named mitigation and one caveat.**

- `git worktree add` itself is effectively free (under a second) and is not a concern at any point in the roadmap.
- A warm, shared pnpm store cuts repeat-worktree install time roughly in half (63s/56s -> 26s) versus a cold store. This is already the default: pnpm's global content-addressable store is shared across all worktrees, branches, and even unrelated projects on the same machine by default, and nothing in the Phase 1 or Phase 2 design overrides it. **Mitigation to state explicitly in the Phase 2 plan: never configure a custom/isolated `store-dir` for the app's prepare-phase installs** (the isolated-store numbers above exist only to isolate the spike's measurement, not as a recommendation) - the default global store is the free win this spike confirms.
- Even in the best (warm-store, steady-state) case, install alone takes ~26 seconds on a repo of this size. The roadmap's own design already accounts for this: "Prepare phase: dependency install in the fresh worktree, run concurrently with the agent's planning phase, with its own visible status" (08-roadmap.md, Phase 2 key deliverables). A ~26s install running concurrently with a real Agent SDK planning turn (which routinely takes a comparable amount of time for non-trivial tickets) should not add visible latency in the common case. The caveat: for a very simple ticket where planning finishes in a few seconds, the prepare phase will still be the visible bottleneck, and the UI must show this honestly (a "installing dependencies..." status distinct from "planning") rather than appearing to hang - Phase 2's "own visible status" requirement already covers this, so no design change is needed, just confirmation that it's implemented and not silently dropped.

## What is not covered (deferred, not blocking Phase 2)

- **Storybook boot cost**: no pilot project with a working Storybook script was available for this spike. Phase 3 (Review surfaces) explicitly depends on this number ("`.forge/config.json` carries a working Storybook script name for the pilot project" - 08-roadmap.md Phase 3 entry criteria) and must re-run this measurement against the actual pilot project once one is chosen, before Phase 3 starts. Not a Phase 2 blocker.
- **Concurrent multi-ticket install contention**: this spike measured one install at a time. The roadmap's Phase 2 exit criterion requires two tickets running concurrently in separate worktrees; if both trigger a prepare-phase install simultaneously, they will contend for the same pnpm store's lock and for disk/CPU. Worth a quick follow-up measurement during Phase 2 implementation (two concurrent `pnpm install` runs against two fresh worktrees of the same repo), but not re-blocking this gate - the current numbers already show install is cheap enough in the single-run case that reasonable contention should still land inside a typical planning window.
- **Windows worktree/install cost**: this spike ran on macOS only. The roadmap already calls for an explicit Windows pass inside Phase 2, not deferred further by this spike.
