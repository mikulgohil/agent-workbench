import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TodoItem, TodoStatus } from "@/lib/forge/types";

const TODO_STATUSES: readonly TodoStatus[] = ["pending", "in_progress", "completed"];

function isTodoStatus(value: unknown): value is TodoStatus {
  return typeof value === "string" && (TODO_STATUSES as readonly string[]).includes(value);
}

/**
 * Tracks TaskCreate/TaskUpdate tool calls into the canonical TodoItem
 * list the Plan & Progress panel renders. Verified parsing gotchas
 * (docs/blueprint/02-agent-sdk-guide.md section 8.1): the task id is NOT
 * in TaskCreate's input, it arrives in the matching tool_result; and the
 * streamed tool_use input is the model's raw emission, so read keys
 * defensively (taskId vs id vs task_id).
 */
export class PlanTracker {
  private readonly items = new Map<string, TodoItem>();
  private readonly pendingCreates = new Map<string, { subject: string }>();

  ingest(message: SDKMessage): boolean {
    let changed = false;

    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type !== "tool_use") continue;
        if (block.name === "TaskCreate") {
          const input = block.input as { subject?: string };
          this.pendingCreates.set(block.id, { subject: input.subject ?? "(untitled)" });
          changed = true;
        } else if (block.name === "TaskUpdate") {
          const input = block.input as { taskId?: string; id?: string; task_id?: string; status?: string; subject?: string };
          const taskId = input.taskId ?? input.id ?? input.task_id;
          const item = taskId ? this.items.get(taskId) : undefined;
          if (!item) continue;
          if (isTodoStatus(input.status)) item.status = input.status;
          if (input.subject) {
            item.content = input.subject;
            item.activeForm = input.subject;
          }
          changed = true;
        }
      }
    }

    if (message.type === "user" && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (typeof block !== "object" || block === null) continue;
        const result = block as { type?: string; tool_use_id?: string };
        if (result.type !== "tool_result" || !result.tool_use_id) continue;
        const pending = this.pendingCreates.get(result.tool_use_id);
        if (!pending) continue;
        const output = message.tool_use_result as { task?: { id?: string } } | undefined;
        const id = output?.task?.id;
        if (!id) continue;
        this.pendingCreates.delete(result.tool_use_id);
        this.items.set(id, { content: pending.subject, activeForm: pending.subject, status: "pending" });
        changed = true;
      }
    }

    return changed;
  }

  todos(): TodoItem[] {
    return [...this.items.values()].map((t) => ({ ...t }));
  }
}
