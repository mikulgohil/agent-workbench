import { execFile } from "node:child_process";
import type { ForgeConfig } from "@/lib/forge/types";

export function installCommand(packageManager: ForgeConfig["packageManager"]): [string, string[]] {
  return [packageManager, ["install"]];
}

/**
 * Runs the install via execFile (never a shell) inside the fresh worktree.
 * Never rejects: an install failure is a warning surfaced to the run, not
 * a hard stop (docs/blueprint/06-execution-model.md: "does not force failed").
 */
export function startInstall(
  worktreePath: string,
  packageManager: ForgeConfig["packageManager"],
): Promise<{ ok: boolean; output: string }> {
  const [command, args] = installCommand(packageManager);
  return new Promise((resolve) => {
    execFile(command, args, { cwd: worktreePath }, (error, stdout, stderr) => {
      resolve({ ok: !error, output: `${stdout}${stderr}` });
    });
  });
}

/**
 * Queues Bash tool calls until the prepare-phase install settles, so the
 * agent's first script execution never races an incomplete node_modules
 * (docs/blueprint/06-execution-model.md: prepare phase). Reading/editing/
 * planning is never gated - only Bash calls wait on this.
 */
export class BashGate {
  private ready = false;
  private waiters: Array<() => void> = [];

  markReady(): void {
    if (this.ready) return;
    this.ready = true;
    for (const resolve of this.waiters.splice(0)) resolve();
  }

  waitUntilReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}
