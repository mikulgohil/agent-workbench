import { describe, expect, it } from "vitest";
import { createTicket, initForge } from "@/lib/forge/store";
import { resetRunRegistry, startSimulatedRun } from "@/lib/run/manager";
import type { RunHandle } from "@/lib/run/manager";
import { UserMessageChannel } from "@/lib/session/channel";
import { makeScratchDir } from "@/test/helpers";
import { POST } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("POST /api/runs/[runId]/iteration", () => {
  it("returns 404 for an unknown run", async () => {
    resetRunRegistry();
    const res = await POST(jsonRequest({ decision: "continue" }), { params: Promise.resolve({ runId: "run-nope" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid decision", async () => {
    resetRunRegistry();
    const res = await POST(jsonRequest({ decision: "maybe" }), { params: Promise.resolve({ runId: "run-nope" }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a run with no control", async () => {
    resetRunRegistry();
    const { dir, cleanup } = await makeScratchDir();
    await initForge(dir);
    const ticket = await createTicket(dir, { type: "generic", title: "t", inputs: { prompt: "t" }, jiraRef: null, source: "manual" }, "Dev <d@e.com>");
    const handle = startSimulatedRun(dir, ticket, { delayMs: 50 });
    const res = await POST(jsonRequest({ decision: "continue" }), { params: Promise.resolve({ runId: handle.run.id }) });
    expect(res.status).toBe(400);
    await handle.done;
    await cleanup();
  });

  it("returns 400 when the run is not at the iteration checkpoint", async () => {
    resetRunRegistry();
    const { dir, cleanup } = await makeScratchDir();
    await initForge(dir);
    const ticket = await createTicket(dir, { type: "generic", title: "t", inputs: { prompt: "t" }, jiraRef: null, source: "manual" }, "Dev <d@e.com>");
    const handle: RunHandle = startSimulatedRun(dir, ticket, { delayMs: 20 });
    handle.control = { channel: new UserMessageChannel(), resolvePermission: () => {}, abortController: new AbortController(), resolveIteration: () => {} };
    // The simulated run's view.state is not awaiting-iteration-approval.
    const res = await POST(jsonRequest({ decision: "continue" }), { params: Promise.resolve({ runId: handle.run.id }) });
    expect(res.status).toBe(400);
    await handle.done;
    await cleanup();
  });

  it("resolves the checkpoint and returns 200 when the run is awaiting the decision", async () => {
    resetRunRegistry();
    const { dir, cleanup } = await makeScratchDir();
    await initForge(dir);
    const ticket = await createTicket(dir, { type: "generic", title: "t", inputs: { prompt: "t" }, jiraRef: null, source: "manual" }, "Dev <d@e.com>");
    const handle: RunHandle = startSimulatedRun(dir, ticket, { delayMs: 20 });
    let resolved: "continue" | "stop" | null = null;
    handle.control = {
      channel: new UserMessageChannel(),
      resolvePermission: () => {},
      abortController: new AbortController(),
      resolveIteration: (d) => { resolved = d; },
    };
    // Force the view into the checkpoint state so the route's guard passes.
    handle.view = { ...handle.view, state: "awaiting-iteration-approval" };

    const res = await POST(jsonRequest({ decision: "stop" }), { params: Promise.resolve({ runId: handle.run.id }) });
    expect(res.status).toBe(200);
    expect(resolved).toBe("stop");
    await handle.done;
    await cleanup();
  });
});
