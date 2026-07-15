import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Creates an isolated scratch directory per test and a cleanup function.
 * Every fs-touching test in this repo runs against one of these, never
 * against the app repo or a real project.
 */
export async function makeScratchDir(): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "forge-test-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
