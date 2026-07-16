import { describe, expect, it } from "vitest";
import { mapSdkMessage, mapSdkMessages } from "./map-events";

function counter(start: number): () => number {
  let n = start;
  return () => n++;
}

describe("mapSdkMessage", () => {
  it("maps a system/init frame to run-started", () => {
    const event = mapSdkMessage(
      {
        type: "system",
        subtype: "init",
        session_id: "sess-1",
        uuid: "u1",
        cwd: "/tmp/wt",
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
      } as never,
      1,
    );
    expect(event).toMatchObject({
      kind: "run-started",
      seq: 1,
      sessionId: "sess-1",
      worktreePath: "/tmp/wt",
    });
  });

  it("maps an assistant text block to a message event", () => {
    const event = mapSdkMessage(
      {
        type: "assistant",
        message: { id: "m1", content: [{ type: "text", text: "Working on it." }], usage: { input_tokens: 10, output_tokens: 5 } },
        parent_tool_use_id: null,
        uuid: "u2",
        session_id: "sess-1",
      } as never,
      2,
    );
    expect(event).toMatchObject({ kind: "message", seq: 2, text: "Working on it." });
  });

  it("maps an assistant tool_use block to a tool-use event", () => {
    const event = mapSdkMessage(
      {
        type: "assistant",
        message: {
          id: "m2",
          content: [{ type: "tool_use", id: "tu-1", name: "Bash", input: { command: "pnpm test" } }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
        parent_tool_use_id: null,
        uuid: "u3",
        session_id: "sess-1",
      } as never,
      3,
    );
    expect(event).toMatchObject({ kind: "tool-use", seq: 3, toolUseId: "tu-1", toolName: "Bash" });
  });

  it("maps a result frame to a terminal phase-change to completed on success", () => {
    const event = mapSdkMessage(
      {
        type: "result",
        subtype: "success",
        result: "done",
        is_error: false,
        num_turns: 3,
        duration_ms: 1000,
        duration_api_ms: 900,
        total_cost_usd: 0.05,
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
        stop_reason: null,
        uuid: "u4",
        session_id: "sess-1",
      } as never,
      4,
    );
    expect(event).toMatchObject({ kind: "phase-change", seq: 4, to: "gates-running" });
  });

  it("maps an error-subtype result frame to a terminal failed phase-change", () => {
    const event = mapSdkMessage(
      {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        num_turns: 1,
        duration_ms: 500,
        duration_api_ms: 400,
        total_cost_usd: 0.01,
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
        stop_reason: null,
        errors: ["boom"],
        uuid: "u5",
        session_id: "sess-1",
      } as never,
      5,
    );
    expect(event).toMatchObject({ kind: "phase-change", seq: 5, to: "failed" });
  });

  it("returns null for a frame type with no RunEvent equivalent", () => {
    expect(mapSdkMessage({ type: "stream_event" } as never, 6)).toBeNull();
  });
});

describe("mapSdkMessages", () => {
  it("maps every content block in a multi-block assistant frame, not just the first (Task 11 gap fix)", () => {
    const events = mapSdkMessages(
      {
        type: "assistant",
        message: {
          id: "m10",
          content: [
            { type: "text", text: "Checking two files." },
            { type: "tool_use", id: "tu-10", name: "Read", input: { file_path: "a.ts" } },
            { type: "tool_use", id: "tu-11", name: "Read", input: { file_path: "b.ts" } },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
        parent_tool_use_id: null,
        uuid: "u10",
        session_id: "sess-1",
      } as never,
      counter(10),
    );

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ kind: "message", seq: 10, text: "Checking two files." });
    expect(events[1]).toMatchObject({ kind: "tool-use", seq: 11, toolUseId: "tu-10", toolName: "Read" });
    expect(events[2]).toMatchObject({ kind: "tool-use", seq: 12, toolUseId: "tu-11", toolName: "Read" });
  });

  it("delegates to mapSdkMessage for non-assistant frames, returning a single-element array", () => {
    const events = mapSdkMessages(
      {
        type: "result",
        subtype: "success",
        result: "done",
        is_error: false,
        num_turns: 3,
        duration_ms: 1000,
        duration_api_ms: 900,
        total_cost_usd: 0.05,
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
        stop_reason: null,
        uuid: "u11",
        session_id: "sess-1",
      } as never,
      counter(7),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "phase-change", seq: 7, to: "gates-running" });
  });

  it("returns an empty array for a frame with no RunEvent equivalent", () => {
    expect(mapSdkMessages({ type: "stream_event" } as never, counter(1))).toEqual([]);
  });
});
