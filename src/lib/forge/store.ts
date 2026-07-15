import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ForgeConfig } from "./types";

export const DEFAULT_FORGE_CONFIG: ForgeConfig = {
  formatVersion: 1,
  packageManager: "pnpm",
  baseBranch: "main",
  concurrencyCap: 3,
  scripts: {
    typecheck: "typecheck",
    lint: "lint",
    test: "test",
    storybook: "storybook",
  },
  bashAllowlist: ["pnpm install", "pnpm run *"],
  denyReadGlobs: [".env*", "*.pem", "*secret*"],
};

export function forgeDir(projectDir: string): string {
  return join(projectDir, ".forge");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Idempotent: safe to call on every app start and on every ticket creation.
 * The app (not the developer) writes the .gitignore entry that keeps
 * .forge/local/ out of git (spec: .forge layout).
 */
export async function initForge(projectDir: string): Promise<void> {
  const root = forgeDir(projectDir);
  const subdirs = [
    "tickets",
    "knowledge",
    "audit",
    "templates",
    join("local", "runs"),
    join("local", "notes"),
  ];
  for (const sub of subdirs) {
    await mkdir(join(root, sub), { recursive: true });
  }
  const configPath = join(root, "config.json");
  if (!(await exists(configPath))) {
    await writeFile(configPath, `${JSON.stringify(DEFAULT_FORGE_CONFIG, null, 2)}\n`, "utf8");
  }
  await writeFile(join(root, ".gitignore"), "local/\n", "utf8");
}

export async function readForgeConfig(projectDir: string): Promise<ForgeConfig> {
  const configPath = join(forgeDir(projectDir), "config.json");
  if (!(await exists(configPath))) return DEFAULT_FORGE_CONFIG;
  const parsed = JSON.parse(await readFile(configPath, "utf8")) as Partial<ForgeConfig>;
  return {
    ...DEFAULT_FORGE_CONFIG,
    ...parsed,
    scripts: { ...DEFAULT_FORGE_CONFIG.scripts, ...(parsed.scripts ?? {}) },
  };
}
