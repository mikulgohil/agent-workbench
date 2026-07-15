import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function gitConfig(key: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["config", key]);
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
 */
export async function resolveIdentity(): Promise<string> {
  const [name, email] = await Promise.all([gitConfig("user.name"), gitConfig("user.email")]);
  return `${name ?? "unknown"} <${email ?? "unknown@local"}>`;
}
