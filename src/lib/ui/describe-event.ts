import type { RunEvent } from "@/lib/forge/types";

/** One log line per event for the raw run stream view. */
export function describeEvent(event: RunEvent): string {
  switch (event.kind) {
    case "run-started":
      return `Run session ${event.sessionId} started`;
    case "plan-proposed":
      return "Plan proposed for approval";
    case "plan-decision":
      return `Plan ${event.decision}`;
    case "todo-update": {
      const done = event.todos.filter((todo) => todo.status === "completed").length;
      return `Todos updated (${done}/${event.todos.length} done)`;
    }
    case "message":
      return event.text;
    case "steer-message":
      return `Steer from ${event.from}: ${event.text}`;
    case "tool-use":
      return `${event.toolName} ${JSON.stringify(event.input)}`;
    case "tool-result":
      return `Tool ${event.toolUseId} ${event.isError ? "failed" : "finished"}`;
    case "permission-request":
      return `Permission requested: ${event.command}`;
    case "permission-decision":
      return `Permission ${event.decision}`;
    case "bash-command":
      return `$ ${event.command} (exit ${event.exitCode})`;
    case "gate-result":
      return `Gate ${event.gate.name}: ${event.gate.status} (${event.gate.explanation})`;
    case "gate-retry-projection":
      return `Gate retry ${event.iteration} projected at $${event.projectedCostUsd.toFixed(4)}`;
    case "cost-update":
      return `Cost so far: $${event.cumulative.costUsd.toFixed(4)}`;
    case "phase-change":
      return `Phase: ${event.from} -> ${event.to}`;
    case "error":
      return `Error: ${event.message}`;
  }
}
