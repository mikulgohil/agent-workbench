import { describe, expect, it } from "vitest";
import { POST } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("POST /api/runs/[runId]/approvals/[requestId]", () => {
  it("returns 404 for an unknown run", async () => {
    const res = await POST(jsonRequest({ decision: "allow" }), { params: Promise.resolve({ runId: "run-nope", requestId: "req-1" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid decision value", async () => {
    const res = await POST(jsonRequest({ decision: "maybe" }), { params: Promise.resolve({ runId: "run-nope", requestId: "req-1" }) });
    expect(res.status).toBe(400);
  });
});
