import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listTickets, readTicket } from "@/lib/forge/store";
import { findLatestRunForTicket, resetRunRegistry } from "@/lib/run/manager";
import { makeScratchDir } from "@/test/helpers";
import { POST } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/tickets", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    resetRunRegistry();
    ({ dir, cleanup } = await makeScratchDir());
    vi.stubEnv("FORGE_PROJECT_DIR", dir);
    vi.stubEnv("FORGE_SIM_DELAY_MS", "0");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanup();
  });

  it("rejects an empty prompt with 400", async () => {
    const res = await POST(jsonRequest({ prompt: "  " }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/prompt/);
  });

  it("rejects a non-json body with 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/tickets", { method: "POST", body: "nope" }),
    );
    expect(res.status).toBe(400);
  });

  it("creates a ticket, starts a simulated run, and returns both ids", async () => {
    const res = await POST(jsonRequest({ prompt: "Add a Button component" }));
    expect(res.status).toBe(201);
    const { ticketId, runId } = (await res.json()) as { ticketId: string; runId: string };

    const handle = findLatestRunForTicket(ticketId);
    expect(handle?.run.id).toBe(runId);
    await handle?.done;

    const ticket = await readTicket(dir, ticketId);
    expect(ticket?.title).toBe("Add a Button component");
    expect(ticket?.type).toBe("generic");
    expect(ticket?.inputs.prompt).toBe("Add a Button component");
    expect(ticket?.createdBy).toMatch(/<.+>/);
    expect(ticket?.status).toBe("review");
    expect(await listTickets(dir)).toHaveLength(1);
  });
});
