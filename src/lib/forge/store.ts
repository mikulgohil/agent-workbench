import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { newId, nowIso } from "./ids";
import type { ForgeConfig, Ticket, TicketSource, TicketStatus, TicketType } from "./types";

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

/** Write-input for createTicket; an internal supporting shape, not part of the canonical model. */
export interface TicketDraft {
  type: TicketType;
  title: string;
  inputs: Record<string, string>;
  jiraRef: string | null;
  source: TicketSource;
}

function ticketPath(projectDir: string, ticketId: string): string {
  return join(forgeDir(projectDir), "tickets", ticketId, "ticket.json");
}

async function writeTicket(projectDir: string, ticket: Ticket): Promise<void> {
  await mkdir(join(forgeDir(projectDir), "tickets", ticket.id), { recursive: true });
  await writeFile(ticketPath(projectDir, ticket.id), `${JSON.stringify(ticket, null, 2)}\n`, "utf8");
}

export async function createTicket(
  projectDir: string,
  draft: TicketDraft,
  createdBy: string,
): Promise<Ticket> {
  const now = nowIso();
  const ticket: Ticket = {
    id: newId("tkt"),
    type: draft.type,
    title: draft.title,
    status: "backlog",
    jiraRef: draft.jiraRef,
    inputs: draft.inputs,
    // Template snapshots (checklist, gates, planThenApprove) stay empty
    // until templates land in a later phase; the fields exist now so
    // ticket.json is forward-compatible with the canonical model.
    attachments: [],
    checklist: [],
    gates: [],
    planThenApprove: false,
    // Maintained by the run manager from Phase 2 (resume support).
    currentRunId: null,
    branchName: null,
    createdBy,
    createdAt: now,
    updatedAt: now,
    source: draft.source,
  };
  await writeTicket(projectDir, ticket);
  return ticket;
}

export async function readTicket(projectDir: string, ticketId: string): Promise<Ticket | null> {
  const path = ticketPath(projectDir, ticketId);
  if (!(await exists(path))) return null;
  return JSON.parse(await readFile(path, "utf8")) as Ticket;
}

export async function listTickets(projectDir: string): Promise<Ticket[]> {
  const dir = join(forgeDir(projectDir), "tickets");
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const tickets: Ticket[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const ticket = await readTicket(projectDir, entry.name);
    if (ticket) tickets.push(ticket);
  }
  return tickets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function setTicketStatus(
  projectDir: string,
  ticketId: string,
  status: TicketStatus,
): Promise<Ticket> {
  const ticket = await readTicket(projectDir, ticketId);
  if (!ticket) throw new Error(`ticket not found: ${ticketId}`);
  const updated: Ticket = { ...ticket, status, updatedAt: nowIso() };
  await writeTicket(projectDir, updated);
  return updated;
}
