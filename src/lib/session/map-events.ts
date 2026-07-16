import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RunEvent } from "@/lib/forge/types";

/**
 * Maps one real Agent SDK message frame to the app's canonical RunEvent
 * protocol (the same protocol the Phase 1 simulator emits), so the
 * reducer, SSE route, and Plan & Progress panel need no changes for
 * Phase 2 (docs/blueprint/02-agent-sdk-guide.md: "spec feature to SDK
 * mechanism map" table). Returns null for frames with no RunEvent
 * equivalent (e.g. stream_event without includePartialMessages, or a
 * system/status frame we do not surface); the caller skips null results.
 */
export function mapSdkMessage(message: SDKMessage, seq: number): RunEvent | null {
  const at = new Date().toISOString();

  if (message.type === "system" && message.subtype === "init") {
    return { kind: "run-started", seq, at, sessionId: message.session_id, worktreePath: message.cwd, branchName: null };
  }

  if (message.type === "assistant") {
    for (const block of message.message.content) {
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
    }
    return null;
  }

  if (message.type === "result") {
    const to = message.subtype === "success" ? "gates-running" : "failed";
    return { kind: "phase-change", seq, at, from: "executing", to };
  }

  return null;
}

/**
 * Maps ALL content blocks in one SDK frame to RunEvents. `mapSdkMessage`
 * above only returns the FIRST matching block, silently dropping every
 * later block in a multi-block assistant frame - e.g. text followed by
 * one or more parallel tool_use calls, which real Claude sessions produce
 * routinely. Non-assistant frames still produce at most one event (via
 * `mapSdkMessage` itself), so behavior for those frame types is
 * unchanged. Takes a `nextSeq` callback rather than a fixed seq because a
 * single frame may need to consume more than one sequence number.
 */
export function mapSdkMessages(message: SDKMessage, nextSeq: () => number): RunEvent[] {
  if (message.type !== "assistant") {
    const event = mapSdkMessage(message, nextSeq());
    return event ? [event] : [];
  }

  const at = new Date().toISOString();
  const events: RunEvent[] = [];
  for (const block of message.message.content) {
    if (block.type === "text") {
      events.push({ kind: "message", seq: nextSeq(), at, text: block.text });
    } else if (block.type === "tool_use") {
      events.push({
        kind: "tool-use",
        seq: nextSeq(),
        at,
        toolUseId: block.id,
        toolName: block.name,
        input: block.input as Record<string, unknown>,
      });
    }
  }
  return events;
}
