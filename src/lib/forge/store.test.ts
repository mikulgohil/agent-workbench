import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeScratchDir } from "@/test/helpers";
import { DEFAULT_FORGE_CONFIG, forgeDir, initForge, readForgeConfig } from "./store";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("forge store: init and config", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await makeScratchDir());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("creates the .forge skeleton with a gitignored local folder", async () => {
    await initForge(dir);
    const root = forgeDir(dir);
    for (const sub of ["tickets", "knowledge", "audit", "templates", "local/runs", "local/notes"]) {
      expect(await exists(join(root, sub))).toBe(true);
    }
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe("local/\n");
  });

  it("writes default config on first init and leaves an existing one alone", async () => {
    await initForge(dir);
    const configPath = join(forgeDir(dir), "config.json");
    const written = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    expect(written).toEqual(DEFAULT_FORGE_CONFIG);

    const { writeFile } = await import("node:fs/promises");
    await writeFile(configPath, JSON.stringify({ baseBranch: "develop" }), "utf8");
    await initForge(dir);
    const kept = JSON.parse(await readFile(configPath, "utf8")) as { baseBranch: string };
    expect(kept.baseBranch).toBe("develop");
  });

  it("merges a partial config file over the defaults when reading", async () => {
    await initForge(dir);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(forgeDir(dir), "config.json"),
      JSON.stringify({ baseBranch: "develop", scripts: { test: "test:unit" } }),
      "utf8",
    );
    const config = await readForgeConfig(dir);
    expect(config.baseBranch).toBe("develop");
    expect(config.scripts.test).toBe("test:unit");
    expect(config.scripts.typecheck).toBe(DEFAULT_FORGE_CONFIG.scripts.typecheck);
    expect(config.concurrencyCap).toBe(DEFAULT_FORGE_CONFIG.concurrencyCap);
    expect(config.formatVersion).toBe(DEFAULT_FORGE_CONFIG.formatVersion);
  });

  it("returns pure defaults when no .forge exists", async () => {
    expect(await readForgeConfig(dir)).toEqual(DEFAULT_FORGE_CONFIG);
  });
});
