import type { ReactElement } from "react";
import type { RunState, TodoStatus } from "@/lib/forge/types";
import type { RunView } from "@/lib/run/reducer";
import { formatCost, summarizeProgress } from "@/lib/ui/format";

const TODO_ICONS: Record<TodoStatus, string> = {
  pending: "○",
  in_progress: "●",
  completed: "✓",
};

function headline(state: RunState): string {
  switch (state) {
    case "preparing":
      return "Preparing run";
    case "planning":
      return "Agent planning";
    case "awaiting-plan-approval":
      return "Waiting for plan approval";
    case "executing":
      return "Agent working";
    case "awaiting-permission":
      return "Waiting for permission";
    case "queued":
      return "Waiting for a free run slot";
    case "gates-running":
      return "Running quality gates";
    case "awaiting-iteration-approval":
      return "Waiting for retry-cost approval";
    case "awaiting-approval":
      return "Waiting for review";
    case "completed":
      return "Run complete";
    case "rejected":
      return "Run rejected";
    case "interrupted":
      return "Run interrupted";
    case "failed":
      return "Run failed";
  }
}

export function PlanProgressPanel({ view }: { view: RunView }): ReactElement {
  return (
    <section
      aria-label="Plan and progress"
      className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
    >
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="font-medium">{headline(view.state)}</span>
        <span className="text-zinc-400">
          {summarizeProgress(view)} - {formatCost(view.cost.costUsd)}
        </span>
      </div>
      <ol className="space-y-1.5">
        {view.todos.map((todo) => {
          const tone =
            todo.status === "completed"
              ? "text-zinc-500 line-through"
              : todo.status === "in_progress"
                ? "text-zinc-100"
                : "text-zinc-400";
          return (
            <li key={todo.content} className={`flex items-center gap-2 text-sm ${tone}`}>
              <span aria-hidden>{TODO_ICONS[todo.status]}</span>
              {todo.content}
            </li>
          );
        })}
      </ol>
      {view.lastMessage ? <p className="mt-3 text-sm text-zinc-400">{view.lastMessage}</p> : null}
      {view.gates.length > 0 ? (
        <ul className="mt-3 flex gap-2">
          {view.gates.map((gate) => {
            const tone =
              gate.status === "passed"
                ? "bg-emerald-950 text-emerald-300"
                : gate.status === "warning"
                  ? "bg-amber-950 text-amber-300"
                  : "bg-red-950 text-red-300";
            return (
              <li key={gate.name} className={`rounded-full px-2 py-0.5 text-xs ${tone}`}>
                {gate.name}: {gate.status}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
