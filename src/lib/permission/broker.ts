import { isDeniedPath } from "./deny-read";
import { resolveBashCommand } from "./allowlist";

export interface PendingApproval {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  createdAt: string;
}

type CanUseToolResult =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

interface BrokerContext {
  requestId: string;
  signal: AbortSignal;
}

/**
 * Bridges the app's permission model to the Agent SDK's canUseTool
 * contract (docs/blueprint/02-agent-sdk-guide.md section 3). This
 * function NEVER returns null - an accidental null leaves a tool call
 * blocked forever, since permission prompts have no timeout.
 */
export function createPermissionBroker(
  allowlist: string[],
  denyReadGlobs: string[],
): {
  canUseTool: (
    toolName: string,
    input: Record<string, unknown>,
    context: BrokerContext,
  ) => Promise<CanUseToolResult>;
  resolve: (requestId: string, decision: "allow" | "always" | "deny") => void;
  pending: () => PendingApproval[];
} {
  const waiting = new Map<string, { resolve: (result: CanUseToolResult) => void; approval: PendingApproval }>();

  function readTarget(input: Record<string, unknown>): string | null {
    const target = input.file_path ?? input.path;
    return typeof target === "string" ? target : null;
  }

  async function canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    context: BrokerContext,
  ): Promise<CanUseToolResult> {
    if ((toolName === "Read" || toolName === "Grep" || toolName === "Glob") && denyReadGlobs.length > 0) {
      const target = readTarget(input);
      if (target && isDeniedPath(target, denyReadGlobs)) {
        return { behavior: "deny", message: `Reading ${target} is blocked by the project's deny-read list` };
      }
    }

    if (toolName === "Bash") {
      const command = typeof input.command === "string" ? input.command : "";
      if (resolveBashCommand(command, allowlist).kind === "allowlisted") {
        return { behavior: "allow", updatedInput: input };
      }
    }

    return new Promise<CanUseToolResult>((resolve) => {
      const approval: PendingApproval = {
        requestId: context.requestId,
        toolName,
        input,
        createdAt: new Date().toISOString(),
      };
      waiting.set(context.requestId, { resolve, approval });
      context.signal.addEventListener("abort", () => {
        const entry = waiting.get(context.requestId);
        if (!entry) return;
        waiting.delete(context.requestId);
        entry.resolve({ behavior: "deny", message: "Run interrupted before a permission decision was made" });
      });
    });
  }

  function resolve(requestId: string, decision: "allow" | "always" | "deny"): void {
    const entry = waiting.get(requestId);
    if (!entry) return;
    waiting.delete(requestId);
    if (decision === "deny") {
      entry.resolve({ behavior: "deny", message: "Denied by the developer in the Workbench UI" });
      return;
    }
    entry.resolve({ behavior: "allow", updatedInput: entry.approval.input });
  }

  function pending(): PendingApproval[] {
    return [...waiting.values()].map((entry) => entry.approval);
  }

  return { canUseTool, resolve, pending };
}
