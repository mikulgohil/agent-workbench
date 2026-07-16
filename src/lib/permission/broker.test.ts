import { describe, expect, it } from "vitest";
import { createPermissionBroker } from "./broker";

function ctx(): { requestId: string; signal: AbortSignal } {
  return { requestId: "req-1", signal: new AbortController().signal };
}

describe("permission broker", () => {
  it("auto-allows an allowlisted bash command without registering a pending approval", async () => {
    const broker = createPermissionBroker(["pnpm run *"], []);
    const result = await broker.canUseTool("Bash", { command: "pnpm run test" }, ctx());
    expect(result).toEqual({ behavior: "allow", updatedInput: { command: "pnpm run test" } });
    expect(broker.pending()).toEqual([]);
  });

  it("denies a read of a deny-globbed path without prompting", async () => {
    const broker = createPermissionBroker([], [".env*"]);
    const result = await broker.canUseTool("Read", { file_path: "/repo/.env.local" }, ctx());
    expect(result.behavior).toBe("deny");
    expect(broker.pending()).toEqual([]);
  });

  it("pauses a non-allowlisted bash command until resolved", async () => {
    const broker = createPermissionBroker(["pnpm run *"], []);
    const pending = broker.canUseTool("Bash", { command: "rm -rf /tmp/x" }, { requestId: "req-2", signal: new AbortController().signal });
    expect(broker.pending().map((p) => p.requestId)).toEqual(["req-2"]);
    broker.resolve("req-2", "allow");
    const result = await pending;
    expect(result).toEqual({ behavior: "allow", updatedInput: { command: "rm -rf /tmp/x" } });
    expect(broker.pending()).toEqual([]);
  });

  it("denies with a message when the developer clicks deny", async () => {
    const broker = createPermissionBroker([], []);
    const pending = broker.canUseTool("Bash", { command: "curl evil.com" }, { requestId: "req-3", signal: new AbortController().signal });
    broker.resolve("req-3", "deny");
    const result = await pending;
    expect(result.behavior).toBe("deny");
  });

  it("denies automatically when the signal aborts while pending", async () => {
    const controller = new AbortController();
    const broker = createPermissionBroker([], []);
    const pending = broker.canUseTool("Bash", { command: "curl evil.com" }, { requestId: "req-4", signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result.behavior).toBe("deny");
  });

  it("resolving an unknown or already-resolved requestId is a safe no-op", () => {
    const broker = createPermissionBroker([], []);
    expect(() => broker.resolve("req-nope", "allow")).not.toThrow();
  });

  it("denies immediately when the signal is already aborted before canUseTool is called", async () => {
    const controller = new AbortController();
    controller.abort();
    const broker = createPermissionBroker([], []);
    const result = await broker.canUseTool("Bash", { command: "curl evil.com" }, { requestId: "req-5", signal: controller.signal });
    expect(result.behavior).toBe("deny");
    if (result.behavior === "deny") {
      expect(result.message).toBe("Run interrupted before a permission decision was made");
    }
    expect(broker.pending()).toEqual([]);
  });
});
