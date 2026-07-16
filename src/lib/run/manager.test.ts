import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTicket, initForge, readTicket } from "@/lib/forge/store";
import * as store from "@/lib/forge/store";
import type { ForgeConfig, RunEvent, Ticket } from "@/lib/forge/types";
import { DEFAULT_FORGE_CONFIG } from "@/lib/forge/store";
import { makeScratchDir } from "@/test/helpers";
import {
  findLatestRunForTicket,
  getRun,
  resetRunRegistry,
  startRun,
  startSimulatedRun,
  subscribe,
} from "./manager";

const DEV = "Test Dev <dev@example.com>";

describe("run manager", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let ticket: Ticket;

  beforeEach(async () => {
    resetRunRegistry();
    ({ dir, cleanup } = await makeScratchDir());
    await initForge(dir);
    ticket = await createTicket(
      dir,
      { type: "generic", title: "Demo", inputs: { prompt: "Do a demo" }, jiraRef: null, source: "manual" },
      DEV,
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  it("emits a terminal event and resolves done when the background run throws", async () => {
    vi.spyOn(store, "setTicketStatus").mockImplementationOnce(() => {
      throw new Error("disk exploded");
    });
    const handle = startSimulatedRun(dir, ticket);
    const received: RunEvent[] = [];
    subscribe(handle.run.id, (event) => received.push(event));

    await expect(handle.done).resolves.toBeUndefined();

    expect(handle.run.state).toBe("failed");
    const terminal = handle.events.at(-1);
    expect(terminal?.kind).toBe("phase-change");
    expect(terminal && terminal.kind === "phase-change" && terminal.to).toBe("failed");
    expect(handle.events.some((event) => event.kind === "error")).toBe(true);
    expect(received.at(-1)?.kind).toBe("phase-change");
  });

  it("runs to completion and moves the ticket from running to review", async () => {
    const handle = startSimulatedRun(dir, ticket);
    await handle.done;
    expect(handle.view.state).toBe("completed");
    expect(handle.run.state).toBe("completed");
    expect(handle.run.sessionId).toBe(`sim-session-${handle.run.id}`);
    expect(handle.run.endedAt).not.toBeNull();
    expect(handle.events.at(-1)?.kind).toBe("phase-change");
    expect((await readTicket(dir, ticket.id))?.status).toBe("review");
  });

  it("replays buffered events to late subscribers", async () => {
    const handle = startSimulatedRun(dir, ticket);
    await handle.done;
    const received: RunEvent[] = [];
    const unsubscribe = subscribe(handle.run.id, (event) => received.push(event));
    unsubscribe();
    expect(received).toHaveLength(handle.events.length);
    expect(received.at(-1)?.kind).toBe("phase-change");
  });

  it("delivers live events to early subscribers exactly once", async () => {
    const handle = startSimulatedRun(dir, ticket, { delayMs: 1 });
    const received: RunEvent[] = [];
    subscribe(handle.run.id, (event) => received.push(event));
    await handle.done;
    expect(received.map((e) => e.seq)).toEqual(handle.events.map((e) => e.seq));
  });

  it("finds the latest run for a ticket", async () => {
    const first = startSimulatedRun(dir, ticket);
    await first.done;
    const second = startSimulatedRun(dir, ticket);
    await second.done;
    expect(getRun(first.run.id)?.run.id).toBe(first.run.id);
    expect(getRun("run-nope")).toBeNull();
    expect(findLatestRunForTicket(ticket.id)?.run.id).toBe(second.run.id);
  });
});

describe("startRun engine seam", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let ticket: Ticket;

  beforeEach(async () => {
    resetRunRegistry();
    ({ dir, cleanup } = await makeScratchDir());
    await initForge(dir);
    ticket = await createTicket(
      dir,
      { type: "generic", title: "Seam check", inputs: { prompt: "Seam check" }, jiraRef: null, source: "manual" },
      DEV,
    );
  });

  afterEach(async () => {
    await cleanup();
  });

  it("delegates to the simulator when the real engine is unavailable (no ANTHROPIC_API_KEY / NODE_ENV=test)", async () => {
    const config: ForgeConfig = DEFAULT_FORGE_CONFIG;
    const handle = startRun(dir, ticket, config);
    await handle.done;
    expect(handle.run.state).toBe("completed");
    expect(handle.run.sessionId).toMatch(/^sim-session-/);
  });
});
