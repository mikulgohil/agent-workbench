import { describe, expect, it, vi } from "vitest";
import { makeScratchDir } from "@/test/helpers";
import { appendAuditEvent, readAuditEvents } from "./audit";

describe("audit log", () => {
  it("appends to the current month's file and reads it back", async () => {
    const { dir, cleanup } = await makeScratchDir();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00.000Z"));
    await appendAuditEvent(dir, { user: "Dev <dev@example.com>", ticketId: "tkt-1", event: "bash_approved", detail: { command: "pnpm test" } });
    const events = await readAuditEvents(dir, "2026-07");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ user: "Dev <dev@example.com>", ticketId: "tkt-1", event: "bash_approved" });
    expect(events[0].at).toBe("2026-07-16T12:00:00.000Z");
    expect(typeof events[0].appVersion).toBe("string");
    vi.useRealTimers();
    await cleanup();
  });

  it("returns an empty list for a month with no events", async () => {
    const { dir, cleanup } = await makeScratchDir();
    expect(await readAuditEvents(dir, "2020-01")).toEqual([]);
    await cleanup();
  });
});
