import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Gate, GateName } from "@/lib/forge/types";

const MAX_OUTPUT_CHARS = 50_000;
const HEAD_TAIL_CHARS = 20_000;

function truncate(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  const head = output.slice(0, HEAD_TAIL_CHARS);
  const tail = output.slice(-HEAD_TAIL_CHARS);
  const cutChars = output.length - HEAD_TAIL_CHARS * 2;
  return `${head}\n... truncated ${Math.round(cutChars / 1000)}k chars ...\n${tail}`;
}

async function scriptExists(worktreePath: string, scriptName: string): Promise<boolean> {
  try {
    const raw = await readFile(join(worktreePath, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return Boolean(pkg.scripts?.[scriptName]);
  } catch {
    return false;
  }
}

/**
 * A gate is a single execFile call (no shell, no agent) against the
 * script name configured in .forge/config.json - the same script name
 * produces the same result regardless of what the agent itself ran
 * (docs/blueprint/06-execution-model.md: gate execution).
 */
export async function runGate(
  worktreePath: string,
  name: GateName,
  scriptName: string,
  packageManager: "npm" | "pnpm" | "yarn",
  timeoutMs = 180_000,
): Promise<Gate> {
  const start = Date.now();

  if (!(await scriptExists(worktreePath, scriptName))) {
    return {
      name,
      basis: "command",
      status: "warning",
      score: 0,
      explanation: `Script "${scriptName}" is not configured in this project's package.json`,
      durationMs: Date.now() - start,
    };
  }

  return new Promise<Gate>((resolve) => {
    const child = execFile(
      packageManager,
      ["run", scriptName],
      { cwd: worktreePath, timeout: timeoutMs, killSignal: "SIGTERM" },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - start;
        const output = `${stdout}${stderr}`;
        if (error && (error as NodeJS.ErrnoException & { killed?: boolean }).killed) {
          resolve({
            name,
            basis: "command",
            status: "failed",
            score: 0,
            explanation: `Gate timeout after ${timeoutMs}ms and was killed`,
            durationMs,
          });
          return;
        }
        resolve({
          name,
          basis: "command",
          status: error ? "failed" : "passed",
          score: error ? 0 : 100,
          explanation: error ? truncate(output) : `${scriptName} exited 0`,
          durationMs,
        });
      },
    );
    void child;
  });
}
