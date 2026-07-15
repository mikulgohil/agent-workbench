import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTicket, initForge } from "@/lib/forge/store";
import type { Ticket } from "@/lib/forge/types";
import { resetRunRegistry, startSimulatedRun } from "@/lib/run/manager";
import { makeScratchDir } from "@/test/helpers";
import { GET } from "./route";

function streamRequest(runId: string): [Request, { params: Promise<{ runId: string }> }] {
  return [
    new Request(`http://localhost/api/runs/${runId}/stream`),
    { params: Promise.resolve({ runId }) },
  ];
}

describe("GET /api/runs/[runId]/stream", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let ticket: Ticket;

  beforeEach(async () => {
    resetRunRegistry();
    ({ dir, cleanup } = await makeScratchDir());
    vi.stubEnv("FORGE_PROJECT_DIR", dir);
    await initForge(dir);
    ticket = await createTicket(
      dir,
      { type: "generic", title: "Streamed", inputs: { prompt: "Stream me" }, jiraRef: null, source: "manual" },
      "Test Dev <dev@example.com>",
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanup();
  });

  it("returns 404 for an unknown run", async () => {
    const res = await GET(...streamRequest("run-nope"));
    expect(res.status).toBe(404);
  });

  it("replays a completed run as SSE frames and terminates after the terminal phase-change", async () => {
    const handle = startSimulatedRun(dir, ticket);
    await handle.done;

    const res = await GET(...streamRequest(handle.run.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const text = await res.text();
    expect(text).toContain("event: run-started");
    expect(text).toContain("event: todo-update");
    expect(text).toContain("event: phase-change");
    expect(text).toContain('"to":"completed"');
    expect(text.trim().split("\n\n")).toHaveLength(handle.events.length);
  });

  it("streams a live run through to completion", async () => {
    const handle = startSimulatedRun(dir, ticket, { delayMs: 1 });
    const res = await GET(...streamRequest(handle.run.id));
    const text = await res.text();
    expect(text).toContain('"to":"completed"');
    await handle.done;
  });
});
