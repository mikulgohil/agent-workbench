import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTicket, initForge, readTicket } from "@/lib/forge/store";
import * as store from "@/lib/forge/store";
import type { ForgeConfig, RunEvent, Ticket } from "@/lib/forge/types";
import { DEFAULT_FORGE_CONFIG } from "@/lib/forge/store";
import { makeScratchDir } from "@/test/helpers";
import { readLastRunState } from "./persist";
import {
  findLatestRunForTicket,
  getRun,
  resetRunRegistry,
  startAgentRun,
  startRun,
  startSimulatedRun,
  subscribe,
} from "./manager";

const DEV = "Test Dev <dev@example.com>";

// Mocked out so `startAgentRun` never touches a real git checkout: the
// worktree lifecycle is exercised on its own in git/worktree.test.ts.
vi.mock("@/lib/git/worktree", () => ({
  createWorktree: vi.fn().mockResolvedValue({ path: "/tmp/mock-worktree", branch: "forge/mock-branch" }),
  removeWorktree: vi.fn().mockResolvedValue(undefined),
  commitAll: vi.fn().mockResolvedValue(undefined),
}));

// Only `startInstall` is stubbed (no real `pnpm install` against a fake
// worktree path); the real `BashGate` is kept since `startAgentRun` still
// calls `bashGate.markReady()` off this promise.
vi.mock("@/lib/prepare", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/prepare")>();
  return { ...actual, startInstall: vi.fn().mockResolvedValue({ ok: true, output: "" }) };
});

// vi.hoisted so this is available inside the (hoisted) vi.mock factory
// below without a TDZ issue. `setNextStream` lets an individual test swap
// in a different fake message stream for its one call to `query()`
// (consumed once, then the default stream applies again), without
// needing to re-import the mocked SDK module inside the test itself (and
// therefore without fighting the real module's strict `Query`-typed
// `query()` signature - every fake stream here is intentionally loosely
// typed, matching this file's existing `as never` fixture convention).
const { setNextStream, defaultQueryImpl } = vi.hoisted(() => {
  type FakeQueryParams = {
    prompt: AsyncIterable<unknown>;
    options: {
      canUseTool: (
        toolName: string,
        input: Record<string, unknown>,
        context: { requestId: string; signal: AbortSignal },
      ) => Promise<unknown>;
      abortController: AbortController;
    };
  };

  let nextStream: ((params: FakeQueryParams) => AsyncGenerator<unknown>) | null = null;

  function setNextStream(factory: (params: FakeQueryParams) => AsyncGenerator<unknown>): void {
    nextStream = factory;
  }

  /**
   * The default fake real-SDK message stream standing in for `query()`.
   * Yields a realistic frame sequence (init, an assistant turn, a result
   * frame, then a couple of post-result teardown-only system frames a
   * real session can still emit), then - critically - does NOT end there.
   * Instead it drains `channel` (the exact `UserMessageChannel` instance
   * `startAgentRun` builds and passes as `prompt`) exactly the way a real
   * streaming-input session would: it keeps the connection open, waiting
   * for the channel to close, rather than ending on its own just because
   * one turn finished. If production code fails to call `channel.close()`
   * upon seeing the result frame, this loop blocks forever waiting for a
   * close that never arrives - reproducing the real hang bug as a fast,
   * bounded-timeout unit test failure instead of a silent stuck ticket.
   */
  async function* defaultStream(channel: AsyncIterable<unknown>): AsyncGenerator<unknown> {
    yield {
      type: "system",
      subtype: "init",
      session_id: "sess-mock",
      uuid: "u1",
      cwd: "/tmp/mock-worktree",
      tools: [],
      model: "claude",
      mcp_servers: [],
      permissionMode: "default",
      slash_commands: [],
      skills: [],
      output_style: "",
      plugins: [],
      apiKeySource: "user",
      claude_code_version: "1.0.0",
    };
    yield {
      type: "assistant",
      message: {
        id: "m1",
        content: [
          { type: "text", text: "Working on it." },
          { type: "tool_use", id: "tu-1", name: "Read", input: { file_path: "a.ts" } },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      parent_tool_use_id: null,
      uuid: "u2",
      session_id: "sess-mock",
    };
    yield {
      type: "result",
      subtype: "success",
      result: "done",
      is_error: false,
      num_turns: 1,
      duration_ms: 100,
      duration_api_ms: 90,
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      modelUsage: {},
      permission_denials: [],
      stop_reason: null,
      uuid: "u3",
      session_id: "sess-mock",
    };
    yield { type: "system", subtype: "hook_response", uuid: "u4", session_id: "sess-mock" };
    yield { type: "system", subtype: "hook_response", uuid: "u5", session_id: "sess-mock" };
    for await (const queuedInput of channel) {
      void queuedInput; // draining only; nothing to do with the content itself
    }
  }

  function defaultQueryImpl(params: FakeQueryParams): AsyncGenerator<unknown> {
    if (nextStream) {
      const factory = nextStream;
      nextStream = null;
      return factory(params);
    }
    return defaultStream(params.prompt);
  }

  return { setNextStream, defaultQueryImpl };
});

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (params: unknown) => defaultQueryImpl(params as Parameters<typeof defaultQueryImpl>[0]),
}));

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

  // Reuses startSimulatedRun since this exercises the persistence wiring
  // (appendRunState calls), not the SDK path - see startAgentRun's
  // equivalent coverage via the channel-lifecycle test below.
  it("persists a terminal run-state line readable via readLastRunState once the run completes", async () => {
    const handle = startSimulatedRun(dir, ticket);
    await handle.done;
    const last = await readLastRunState(dir, ticket.id, handle.run.id);
    expect(last).toMatchObject({ type: "state", state: handle.run.state });
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

describe("startAgentRun channel lifecycle (mocked SDK, no real API calls)", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let ticket: Ticket;

  beforeEach(async () => {
    resetRunRegistry();
    ({ dir, cleanup } = await makeScratchDir());
    await initForge(dir);
    ticket = await createTicket(
      dir,
      { type: "generic", title: "Channel close check", inputs: { prompt: "Channel close check" }, jiraRef: null, source: "manual" },
      DEV,
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  // Calls startAgentRun directly (bypassing the isRealEngineAvailable()
  // gate in startRun) so this test never needs ANTHROPIC_API_KEY or a
  // non-"test" NODE_ENV - the mocked SDK module above is the only thing
  // standing in for the real engine.
  //
  // Regression test for a Critical bug found via real manual verification:
  // channel.close() was only called AFTER the `for await` message loop
  // exited, but a real streaming-input session never exits that loop on
  // its own (it waits indefinitely for the channel to close), so the run
  // hung forever with the ticket stuck in "running". An explicit, short
  // timeout is set below so a regression of this bug fails this test
  // loudly and fast instead of hanging the suite.
  it(
    "closes the input channel as soon as the result frame arrives and resolves done, rather than hanging",
    async () => {
      const config: ForgeConfig = DEFAULT_FORGE_CONFIG;
      const handle = startAgentRun(dir, ticket, config);

      await handle.done;

      expect(handle.run.state).toBe("completed");
      expect(handle.events.at(-1)).toMatchObject({ kind: "phase-change", to: "completed" });

      const ticketAfter = await readTicket(dir, ticket.id);
      expect(ticketAfter?.status).toBe("review");
      expect(ticketAfter?.branchName).toBe("forge/mock-branch");
    },
    3000,
  );
});

describe("startAgentRun permission-request/decision emission (mocked SDK, no real API calls)", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let ticket: Ticket;

  const NON_ALLOWLISTED_COMMAND = "rm -rf /tmp/scratch-permission-test";

  beforeEach(async () => {
    resetRunRegistry();
    ({ dir, cleanup } = await makeScratchDir());
    await initForge(dir);
    ticket = await createTicket(
      dir,
      { type: "generic", title: "Permission prompt check", inputs: { prompt: "Permission prompt check" }, jiraRef: null, source: "manual" },
      DEV,
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  /**
   * A fake stream that yields an assistant turn requesting a Bash command
   * NOT in the allowlist, then - the way a real session actually behaves -
   * calls the `canUseTool` callback it was given directly (nothing else in
   * this mock would ever invoke it) and waits for it to resolve before
   * continuing to the result frame. That resolution only happens once the
   * test calls `handle.control.resolvePermission(...)`, exactly as the
   * real approvals API route does.
   */
  async function* fakePermissionGatedStream(params: {
    options: {
      canUseTool: (
        toolName: string,
        input: Record<string, unknown>,
        context: { requestId: string; signal: AbortSignal },
      ) => Promise<unknown>;
      abortController: AbortController;
    };
  }): AsyncGenerator<unknown> {
    yield {
      type: "system",
      subtype: "init",
      session_id: "sess-perm",
      uuid: "up1",
      cwd: "/tmp/mock-worktree",
      tools: [],
      model: "claude",
      mcp_servers: [],
      permissionMode: "default",
      slash_commands: [],
      skills: [],
      output_style: "",
      plugins: [],
      apiKeySource: "user",
      claude_code_version: "1.0.0",
    };
    yield {
      type: "assistant",
      message: {
        id: "m-perm-1",
        content: [{ type: "tool_use", id: "tu-perm-1", name: "Bash", input: { command: NON_ALLOWLISTED_COMMAND } }],
        usage: { input_tokens: 8, output_tokens: 3 },
      },
      parent_tool_use_id: null,
      uuid: "up2",
      session_id: "sess-perm",
    };

    await params.options.canUseTool(
      "Bash",
      { command: NON_ALLOWLISTED_COMMAND },
      { requestId: "perm-req-1", signal: params.options.abortController.signal },
    );

    yield {
      type: "result",
      subtype: "success",
      result: "done",
      is_error: false,
      num_turns: 1,
      duration_ms: 50,
      duration_api_ms: 40,
      total_cost_usd: 0.005,
      usage: { input_tokens: 20, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      modelUsage: {},
      permission_denials: [],
      stop_reason: null,
      uuid: "up3",
      session_id: "sess-perm",
    };
  }

  it(
    "emits permission-request then permission-decision around a paused Bash approval, and the run still completes",
    async () => {
      setNextStream(fakePermissionGatedStream as never);
      const config: ForgeConfig = DEFAULT_FORGE_CONFIG; // bashAllowlist has no entry matching NON_ALLOWLISTED_COMMAND
      const handle = startAgentRun(dir, ticket, config);

      await vi.waitFor(
        () => {
          expect(handle.events.some((event) => event.kind === "permission-request")).toBe(true);
        },
        { timeout: 2000, interval: 5 },
      );

      const request = handle.events.find(
        (event): event is Extract<RunEvent, { kind: "permission-request" }> => event.kind === "permission-request",
      );
      expect(request).toBeDefined();
      expect(request?.command).toBe(NON_ALLOWLISTED_COMMAND);
      // Before the decision arrives, the reducer's derived view should show
      // this as the pending prompt Task 13's UI reads.
      expect(handle.view.pendingPermission).toEqual({ requestId: request?.requestId, command: NON_ALLOWLISTED_COMMAND });

      // The same mechanism the real approvals API route uses.
      handle.control?.resolvePermission(request!.requestId, "allow");

      await handle.done;

      const decision = handle.events.find(
        (event): event is Extract<RunEvent, { kind: "permission-decision" }> => event.kind === "permission-decision",
      );
      expect(decision).toMatchObject({ requestId: request!.requestId, decision: "approved" });
      expect(handle.view.pendingPermission).toBeNull();
      expect(handle.run.state).toBe("completed");
    },
    3000,
  );
});
