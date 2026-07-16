import picomatch from "picomatch";
import { basename } from "path";

/**
 * Checked twice by design (docs/blueprint/02-agent-sdk-guide.md section 9):
 * once as SDK-native disallowedTools deny rules (hold in every permission
 * mode, cannot be overridden by any allow rule), and again as a
 * PreToolUse hook (Task 4) that also covers Grep/Glob explicitly, since
 * the SDK docs do not confirm Read() rules gate those tools too.
 */
export function isDeniedPath(path: string, denyReadGlobs: string[]): boolean {
  if (denyReadGlobs.length === 0) return false;
  const fileName = basename(path);
  return picomatch(denyReadGlobs, { dot: true })(fileName);
}

/** "//" anchors a disallowedTools rule at the filesystem root (verified, SDK guide section 9.1). */
export function toSdkDenyRules(denyReadGlobs: string[]): string[] {
  return denyReadGlobs.map((glob) => `Read(//**/${glob})`);
}
