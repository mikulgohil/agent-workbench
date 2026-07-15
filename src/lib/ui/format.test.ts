import { describe, expect, it } from "vitest";
import type { TodoItem } from "@/lib/forge/types";
import { initialRunView } from "@/lib/run/reducer";
import { formatCost, summarizeProgress } from "./format";

describe("format helpers", () => {
  it("formats cost in USD with four decimals", () => {
    expect(formatCost(0)).toBe("$0.0000");
    expect(formatCost(0.01234)).toBe("$0.0123");
  });

  it("summarizes todo progress", () => {
    const empty = initialRunView("run-x");
    expect(summarizeProgress(empty)).toBe("Waiting for plan");
    const todos: TodoItem[] = [
      { content: "a", activeForm: "a", status: "completed" },
      { content: "b", activeForm: "b", status: "completed" },
      { content: "c", activeForm: "c", status: "completed" },
      { content: "d", activeForm: "d", status: "in_progress" },
      { content: "e", activeForm: "e", status: "pending" },
    ];
    expect(summarizeProgress({ ...empty, todos })).toBe("3/5 steps done");
  });
});
