import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function gitConfig(key: string, cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["config", key], { cwd });
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Identity is the git-identity STRING, never a structured user object
 * (canonical model, locked decision 2: no auth, no user table). The
 * fallback keeps the app usable on a machine without git config, while
 * making the missing setup visible in the audit trail.
 *
 * `git config` must run with the target project directory as cwd, not the
 * app process's cwd, since developers can have per-repo git identities and
 * this value is persisted into the target project's own ticket.json.
 */
export async function resolveIdentity(projectDir: string): Promise<string> {
  const [name, email] = await Promise.all([
    gitConfig("user.name", projectDir),
    gitConfig("user.email", projectDir),
  ]);
  return `${name ?? "unknown"} <${email ?? "unknown@local"}>`;
}
