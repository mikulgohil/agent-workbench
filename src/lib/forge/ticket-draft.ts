import type { TicketDraft } from "./store";
import type { TicketType } from "./types";

const MAX_TITLE_LENGTH = 60;

/**
 * Prompt-first creation (spec: UI interaction model): the prompt is the only
 * required input, the title derives from its first line, and the full
 * prompt is stored under the canonical Ticket.inputs["prompt"] key.
 */
export function buildTicketDraft(prompt: string, type: TicketType = "generic"): TicketDraft | null {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return null;
  const firstLine = trimmed.split("\n", 1)[0].trim();
  const title =
    firstLine.length <= MAX_TITLE_LENGTH
      ? firstLine
      : `${firstLine.slice(0, MAX_TITLE_LENGTH - 3)}...`;
  return { type, title, inputs: { prompt: trimmed }, jiraRef: null, source: "manual" };
}
