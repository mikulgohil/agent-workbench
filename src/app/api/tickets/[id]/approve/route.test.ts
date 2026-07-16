import { describe, expect, it, vi } from "vitest";
import { createTicket, initForge, readTicket } from "@/lib/forge/store";
import { resetRunRegistry } from "@/lib/run/manager";
import { makeScratchDir } from "@/test/helpers";
import { POST } from "./route";

describe("POST /api/tickets/[id]/approve", () => {
  it("returns 404 for an unknown ticket", async () => {
    resetRunRegistry();
    const { dir, cleanup } = await makeScratchDir();
    vi.stubEnv("FORGE_PROJECT_DIR", dir);
    await initForge(dir);
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id: "tkt-nope" }) });
    expect(res.status).toBe(404);
    vi.unstubAllEnvs();
    await cleanup();
  });

  it("returns 400 for a ticket not in review status", async () => {
    resetRunRegistry();
    const { dir, cleanup } = await makeScratchDir();
    vi.stubEnv("FORGE_PROJECT_DIR", dir);
    await initForge(dir);
    const ticket = await createTicket(dir, { type: "generic", title: "t", inputs: { prompt: "t" }, jiraRef: null, source: "manual" }, "Dev <d@e.com>");
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id: ticket.id }) });
    expect(res.status).toBe(400);
    vi.unstubAllEnvs();
    await cleanup();
  });

  it("marks a review ticket done when no live run/worktree remains (simulator-completed case)", async () => {
    resetRunRegistry();
    const { dir, cleanup } = await makeScratchDir();
    vi.stubEnv("FORGE_PROJECT_DIR", dir);
    await initForge(dir);
    let ticket = await createTicket(dir, { type: "generic", title: "t", inputs: { prompt: "t" }, jiraRef: null, source: "manual" }, "Dev <d@e.com>");
    const { setTicketStatus } = await import("@/lib/forge/store");
    ticket = await setTicketStatus(dir, ticket.id, "review");
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id: ticket.id }) });
    expect(res.status).toBe(200);
    expect((await readTicket(dir, ticket.id))?.status).toBe("done");
    vi.unstubAllEnvs();
    await cleanup();
  });
});
