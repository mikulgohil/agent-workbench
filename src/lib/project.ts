import { resolve } from "node:path";

/**
 * Phase 1 project resolution: one env var points the app at the target
 * project repo. The project picker with ~/.agent-workbench/config.json
 * recents arrives in a later phase; this function is its future seam.
 */
export function getProjectDir(): string {
  const dir = process.env.FORGE_PROJECT_DIR;
  if (!dir || dir.trim().length === 0) {
    throw new Error(
      "FORGE_PROJECT_DIR is not set. Point it at the target project repo, e.g. FORGE_PROJECT_DIR=../my-app pnpm dev",
    );
  }
  return resolve(dir);
}

/** Event pacing for simulated runs; 0 in unit tests, small in e2e, 250 in dev. */
export function getSimDelayMs(): number {
  const raw = process.env.FORGE_SIM_DELAY_MS;
  if (raw === undefined || raw.trim().length === 0) return 250;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 250;
}
