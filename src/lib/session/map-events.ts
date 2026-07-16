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
