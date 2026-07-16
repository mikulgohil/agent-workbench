import picomatch from "picomatch";

export type BashDecision = { kind: "allowlisted" } | { kind: "prompt" };

/**
 * Exact match first, then glob (docs/blueprint/06-execution-model.md:
 * Bash allowlist resolution). There is no deny-list for Bash - only
 * allow vs. prompt, matching Claude Code's own permission model.
 */
export function resolveBashCommand(command: string, allowlist: string[]): BashDecision {
  if (allowlist.includes(command)) return { kind: "allowlisted" };
  const isAllowed = picomatch(allowlist)(command);
  return isAllowed ? { kind: "allowlisted" } : { kind: "prompt" };
}
