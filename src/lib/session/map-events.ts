import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RunEvent } from "@/lib/forge/types";

/** The union of content-block shapes an `assistant` SDKMessage carries. */
type AssistantContentBlock = Extract<SDKMessage, { type: "assistant" }>["message"]["content"][number];

/**
 * The one and only parser for a single assistant content block, shared by
 * both `mapSdkMessage` and `mapSdkMessages` below so there is never a
 * second copy of this mapping to drift out of sync (text -> message,
 * tool_use -> tool-use; any other block type has no RunEvent equivalent).
 */
function mapAssistantBlock(block: AssistantContentBlock, seq: number, at: string): RunEvent | null {
  if (block.type === "text") {
    return { kind: "message", seq, at, text: block.text };
  }
  if (block.type === "tool_use") {
    return {
      kind: "tool-use",
      seq,
      at,
      toolUseId: block.id,
      toolName: block.name,
      input: block.input as Record<string, unknown>,
    };
  }
  return null;
}

/** The one and only parser for non-assistant frames, shared by both functions below. */
function mapNonAssistantFrame(message: Exclude<SDKMessage, { type: "assistant" }>, seq: number, at: string): RunEvent | null {
  if (message.type === "system" && message.subtype === "init") {
    return { kind: "run-started", seq, at, sessionId: message.session_id, worktreePath: message.cwd, branchName: null };
  }
  if (message.type === "result") {
    const to = message.subtype === "success" ? "gates-running" : "failed";
    return { kind: "phase-change", seq, at, from: "executing", to };
  }
  return null;
}

/**
 * Maps one real Agent SDK message frame to the app's canonical RunEvent
 * protocol (the same protocol the Phase 1 simulator emits), so the
 * reducer, SSE route, and Plan & Progress panel need no changes for
 * Phase 2 (docs/blueprint/02-agent-sdk-guide.md: "spec feature to SDK
 * mechanism map" table). Returns null for frames with no RunEvent
 * equivalent (e.g. stream_event without includePartialMessages, or a
 * system/status frame we do not surface); the caller skips null results.
 *
 * For an assistant frame with multiple content blocks, this returns only
 * the FIRST matching block - production code should use `mapSdkMessages`
 * instead, which returns every block's event. This function is kept for
 * its existing single-event contract and tests.
 */
export function mapSdkMessage(message: SDKMessage, seq: number): RunEvent | null {
  const at = new Date().toISOString();

  if (message.type === "assistant") {
    for (const block of message.message.content) {
      const event = mapAssistantBlock(block, seq, at);
      if (event) return event;
    }
    return null;
  }

  return mapNonAssistantFrame(message, seq, at);
}

/**
 * Maps ALL content blocks in one SDK frame to RunEvents. `mapSdkMessage`
 * above only returns the FIRST matching block, silently dropping every
 * later block in a multi-block assistant frame - e.g. text followed by
 * one or more parallel tool_use calls, which real Claude sessions produce
 * routinely. Non-assistant frames still produce at most one event, via
 * the same `mapNonAssistantFrame` helper `mapSdkMessage` uses, so behavior
 * for those frame types is unchanged. Takes a `nextSeq` callback rather
 * than a fixed seq because a single frame may need to consume more than
 * one sequence number.
 */
export function mapSdkMessages(message: SDKMessage, nextSeq: () => number): RunEvent[] {
  if (message.type !== "assistant") {
    const event = mapNonAssistantFrame(message, nextSeq(), new Date().toISOString());
    return event ? [event] : [];
  }

  const at = new Date().toISOString();
  const events: RunEvent[] = [];
  for (const block of message.message.content) {
    const event = mapAssistantBlock(block, nextSeq(), at);
    if (event) events.push(event);
  }
  return events;
}
