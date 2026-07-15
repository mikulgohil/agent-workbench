import { describe, expect, it } from "vitest";
import { buildTicketDraft } from "./ticket-draft";

describe("buildTicketDraft", () => {
  it("rejects empty prompts", () => {
    expect(buildTicketDraft("   ")).toBeNull();
  });

  it("uses the first line as the title and stores the full prompt under inputs.prompt", () => {
    const draft = buildTicketDraft("Fix the header\nIt overlaps the nav on mobile.");
    expect(draft?.title).toBe("Fix the header");
    expect(draft?.inputs.prompt).toContain("It overlaps the nav on mobile.");
    expect(draft?.type).toBe("generic");
    expect(draft?.jiraRef).toBeNull();
    expect(draft?.source).toBe("manual");
  });

  it("truncates long titles to 60 characters with an ellipsis", () => {
    const draft = buildTicketDraft("x".repeat(100));
    expect(draft?.title).toHaveLength(60);
    expect(draft?.title.endsWith("...")).toBe(true);
  });

  it("honors an explicit ticket type", () => {
    expect(buildTicketDraft("Broken build", "bug-fix")?.type).toBe("bug-fix");
  });
});
