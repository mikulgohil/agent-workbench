import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeScratchDir } from "@/test/helpers";
import { DEFAULT_FORGE_CONFIG, createTicket, forgeDir, initForge, listTickets, readForgeConfig, readTicket, setTicketStatus } from "./store";
import type { TicketDraft } from "./store";

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

const DEV = "Test Dev <dev@example.com>";

function draft(title: string): TicketDraft {
  return {
    type: "generic",
    title,
    inputs: { prompt: `${title} prompt` },
    jiraRef: null,
    source: "manual",
  };
}

describe("forge store: tickets", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await makeScratchDir());
    await initForge(dir);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("creates a canonical ticket in backlog and reads it back", async () => {
    const ticket = await createTicket(dir, draft("Add button"), DEV);
    expect(ticket.id).toMatch(/^tkt-/);
    expect(ticket.status).toBe("backlog");
    expect(ticket.createdBy).toBe(DEV);
    expect(ticket.inputs.prompt).toBe("Add button prompt");
    expect(ticket.source).toBe("manual");
    expect(ticket.currentRunId).toBeNull();
    expect(ticket.branchName).toBeNull();
    expect(ticket.attachments).toEqual([]);
    expect(ticket.checklist).toEqual([]);
    expect(await readTicket(dir, ticket.id)).toEqual(ticket);
  });

  it("returns null for an unknown ticket", async () => {
    expect(await readTicket(dir, "tkt-nope")).toBeNull();
  });

  it("returns null for a malformed id instead of resolving a path traversal", async () => {
    expect(await readTicket(dir, "../../../etc/passwd")).toBeNull();
    expect(await readTicket(dir, "tkt-../../../../etc")).toBeNull();
  });

  it("lists tickets newest first", async () => {
    const a = await createTicket(dir, draft("First"), DEV);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = await createTicket(dir, draft("Second"), DEV);
    const titles = (await listTickets(dir)).map((t) => t.title);
    expect(titles).toEqual(["Second", "First"]);
    expect(a.createdAt <= b.createdAt).toBe(true);
  });

  it("updates status and bumps updatedAt", async () => {
    const ticket = await createTicket(dir, draft("Move me"), DEV);
    const updated = await setTicketStatus(dir, ticket.id, "running");
    expect(updated.status).toBe("running");
    expect(updated.updatedAt >= ticket.updatedAt).toBe(true);
    expect((await readTicket(dir, ticket.id))?.status).toBe("running");
  });

  it("throws when updating an unknown ticket", async () => {
    await expect(setTicketStatus(dir, "tkt-nope", "done")).rejects.toThrow(/tkt-nope/);
  });
});
