import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CostRecord } from "@/lib/forge/types";

const ZERO: CostRecord = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };

function addCost(a: CostRecord, b: CostRecord): CostRecord {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

/**
 * Per-step usage (docs/blueprint/02-agent-sdk-guide.md section 1.5):
 * dedupe by message.message.id since parallel tool calls share one id
 * with identical usage. The result frame's total_cost_usd/usage is
 * authoritative and overrides the running per-step estimate once it
 * arrives - prefer it over summing steps ourselves.
 *
 * Cross-session (gate-feedback loop, resume): each resumed query() session
 * produces its own result with its own total_cost_usd (guide 4.2), so per
 * ticket we accumulate. `current` holds the in-flight session; `committed`
 * holds the sum of every already-sealed session. `total()` and `ingest()`
 * both return committed + current, so a single-session run is unchanged
 * (committed is zero).
 */
export class CostTracker {
  private committed: CostRecord = { ...ZERO };
  private current: CostRecord = { ...ZERO };
  private seenMessageIds = new Set<string>();

  ingest(message: SDKMessage): CostRecord | null {
    if (message.type === "assistant") {
      const id = message.message.id;
      if (this.seenMessageIds.has(id)) return null;
      this.seenMessageIds.add(id);
      const usage = message.message.usage;
      this.current = {
        inputTokens: this.current.inputTokens + usage.input_tokens,
        outputTokens: this.current.outputTokens + usage.output_tokens,
        cacheReadTokens: this.current.cacheReadTokens + (usage.cache_read_input_tokens ?? 0),
        cacheWriteTokens: this.current.cacheWriteTokens + (usage.cache_creation_input_tokens ?? 0),
        costUsd: this.current.costUsd,
      };
      return this.total();
    }

    if (message.type === "result") {
      this.current = {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
        costUsd: message.total_cost_usd,
      };
      return this.total();
    }

    return null;
  }

  /**
   * Folds the finished session's cost into the committed total and resets
   * per-session state so the next resumed session accumulates rather than
   * overwrites. Message-id dedup is per session, so its set is cleared too.
   */
  sealSession(): void {
    this.committed = addCost(this.committed, this.current);
    this.current = { ...ZERO };
    this.seenMessageIds = new Set<string>();
  }

  total(): CostRecord {
    return addCost(this.committed, this.current);
  }
}
