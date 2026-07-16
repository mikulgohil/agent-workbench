import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CostRecord } from "@/lib/forge/types";

/**
 * Per-step usage (docs/blueprint/02-agent-sdk-guide.md section 1.5):
 * dedupe by message.message.id since parallel tool calls share one id
 * with identical usage. The result frame's total_cost_usd/usage is
 * authoritative and overrides the running per-step estimate once it
 * arrives - prefer it over summing steps ourselves.
 */
export class CostTracker {
  private cumulative: CostRecord = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
  private readonly seenMessageIds = new Set<string>();

  ingest(message: SDKMessage): CostRecord | null {
    if (message.type === "assistant") {
      const id = message.message.id;
      if (this.seenMessageIds.has(id)) return null;
      this.seenMessageIds.add(id);
      const usage = message.message.usage;
      this.cumulative = {
        inputTokens: this.cumulative.inputTokens + usage.input_tokens,
        outputTokens: this.cumulative.outputTokens + usage.output_tokens,
        cacheReadTokens: this.cumulative.cacheReadTokens + (usage.cache_read_input_tokens ?? 0),
        cacheWriteTokens: this.cumulative.cacheWriteTokens + (usage.cache_creation_input_tokens ?? 0),
        costUsd: this.cumulative.costUsd,
      };
      return this.cumulative;
    }

    if (message.type === "result") {
      this.cumulative = {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
        costUsd: message.total_cost_usd,
      };
      return this.cumulative;
    }

    return null;
  }

  total(): CostRecord {
    return this.cumulative;
  }
}
