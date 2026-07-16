import { describe, expect, it } from "vitest";
import { CostTracker } from "./cost-tracker";

function assistantFrame(id: string, inputTokens: number, outputTokens: number) {
  return {
    type: "assistant",
    message: { id, content: [{ type: "text", text: "..." }], usage: { input_tokens: inputTokens, output_tokens: outputTokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    parent_tool_use_id: null,
    uuid: id,
    session_id: "s1",
  } as never;
}

describe("CostTracker", () => {
  it("accumulates tokens per distinct assistant message id", () => {
    const tracker = new CostTracker();
    const first = tracker.ingest(assistantFrame("m1", 100, 50));
    expect(first?.inputTokens).toBe(100);
    expect(first?.outputTokens).toBe(50);
    const second = tracker.ingest(assistantFrame("m2", 200, 80));
    expect(second?.inputTokens).toBe(300);
    expect(second?.outputTokens).toBe(130);
  });

  it("deduplicates parallel tool calls sharing the same message id", () => {
    const tracker = new CostTracker();
    tracker.ingest(assistantFrame("m1", 100, 50));
    const dup = tracker.ingest(assistantFrame("m1", 100, 50));
    expect(dup).toBeNull();
    expect(tracker.total().inputTokens).toBe(100);
  });

  it("prefers the authoritative result-frame total when one arrives", () => {
    const tracker = new CostTracker();
    tracker.ingest(assistantFrame("m1", 100, 50));
    const result = tracker.ingest({
      type: "result",
      subtype: "success",
      result: "done",
      is_error: false,
      num_turns: 1,
      duration_ms: 1,
      duration_api_ms: 1,
      total_cost_usd: 0.0123,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 },
      modelUsage: {},
      permission_denials: [],
      stop_reason: null,
      uuid: "r1",
      session_id: "s1",
    } as never);
    expect(result?.costUsd).toBe(0.0123);
    expect(tracker.total().costUsd).toBe(0.0123);
  });

  it("starts at zero cost", () => {
    expect(new CostTracker().total()).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 });
  });
});
