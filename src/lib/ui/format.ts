import type { RunView } from "@/lib/run/reducer";

export function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(4)}`;
}

export function summarizeProgress(view: RunView): string {
  if (view.todos.length === 0) return "Waiting for plan";
  const done = view.todos.filter((todo) => todo.status === "completed").length;
  return `${done}/${view.todos.length} steps done`;
}
