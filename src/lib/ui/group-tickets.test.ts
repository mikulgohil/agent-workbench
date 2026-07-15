import { describe, expect, it } from "vitest";
import type { Ticket } from "@/lib/forge/types";
import { SIDEBAR_GROUPS, groupTickets } from "./group-tickets";

function ticket(id: string, status: Ticket["status"]): Ticket {
  return {
    id,
    type: "generic",
    title: id,
    status,
    jiraRef: null,
    inputs: { prompt: id },
    attachments: [],
    checklist: [],
    gates: [],
    planThenApprove: false,
    currentRunId: null,
    branchName: null,
    createdBy: "Test Dev <dev@example.com>",
    createdAt: "2026-07-15T10:00:00.000Z",
    updatedAt: "2026-07-15T10:00:00.000Z",
    source: "manual",
  };
}

describe("groupTickets", () => {
  it("maps all six ticket statuses onto sidebar groups", () => {
    const groups = groupTickets([
      ticket("a", "backlog"),
      ticket("b", "running"),
      ticket("c", "review"),
      ticket("d", "done"),
      ticket("e", "rejected"),
      ticket("f", "failed"),
    ]);
    expect(groups.running.map((t) => t.id)).toEqual(["b"]);
    expect(groups.review.map((t) => t.id)).toEqual(["c"]);
    expect(groups.idle.map((t) => t.id)).toEqual(["a", "d", "e", "f"]);
    expect(groups.needs_attention).toEqual([]);
  });

  it("returns every group even when empty", () => {
    const groups = groupTickets([]);
    for (const group of SIDEBAR_GROUPS) {
      expect(groups[group]).toEqual([]);
    }
  });
});
