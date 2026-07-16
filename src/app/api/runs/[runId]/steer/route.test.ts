import { describe, expect, it } from "vitest";
import { createTicket, initForge } from "@/lib/forge/store";
import { resetRunRegistry, startSimulatedRun } from "@/lib/run/manager";
import { makeScratchDir } from "@/test/helpers";
import { POST } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("POST /api/runs/[runId]/steer", () => {
  it("returns 404 for an unknown run", async () => {
    resetRunRegistry();
    const res = await POST(jsonRequest({ message: "hi" }), { params: Promise.resolve({ runId: "run-nope" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a run with no control channel", async () => {
    resetRunRegistry();
    const { dir, cleanup } = await makeScratchDir();
    await initForge(dir);
    const ticket = await createTicket(dir, { type: "generic", title: "t", inputs: { prompt: "t" }, jiraRef: null, source: "manual" }, "Dev <d@e.com>");
    const handle = startSimulatedRun(dir, ticket, { delayMs: 50 });
    const res = await POST(jsonRequest({ message: "hi" }), { params: Promise.resolve({ runId: handle.run.id }) });
    expect(res.status).toBe(400);
    await handle.done;
    await cleanup();
  });

  it("returns 400 for an empty message", async () => {
    resetRunRegistry();
    const res = await POST(jsonRequest({ message: "  " }), { params: Promise.resolve({ runId: "run-nope" }) });
    expect(res.status).toBe(400);
  });
});
