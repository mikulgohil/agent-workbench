import type { Ticket } from "@/lib/forge/types";

/**
 * Attention-first grouping is the primary navigation (spec: UI interaction
 * model). Per the canonical model, grouping is COMPUTED from TicketStatus
 * (plus the current run's RunState from Phase 2 on) and never persisted.
 * needs_attention exists from day one so the UI shape is final, but Phase 1
 * has nothing that feeds it; Phase 2 moves tasks here on permission
 * prompts, plan approvals, gate failures, and agent questions.
 */
export const SIDEBAR_GROUPS = ["needs_attention", "running", "review", "idle"] as const;
export type SidebarGroup = (typeof SIDEBAR_GROUPS)[number];

export const SIDEBAR_GROUP_LABELS: Record<SidebarGroup, string> = {
  needs_attention: "Needs Attention",
  running: "Running",
  review: "Review",
  idle: "Idle",
};

export function groupTickets(tickets: Ticket[]): Record<SidebarGroup, Ticket[]> {
  const groups: Record<SidebarGroup, Ticket[]> = {
    needs_attention: [],
    running: [],
    review: [],
    idle: [],
  };
  for (const ticket of tickets) {
    if (ticket.status === "running") groups.running.push(ticket);
    else if (ticket.status === "review") groups.review.push(ticket);
    else groups.idle.push(ticket);
  }
  return groups;
}
