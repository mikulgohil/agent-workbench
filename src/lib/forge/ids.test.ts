import { describe, expect, it } from "vitest";
import { newId, nowIso } from "./ids";

describe("ids", () => {
  it("prefixes ids and keeps them unique", () => {
    const a = newId("tkt");
    const b = newId("tkt");
    expect(a).toMatch(/^tkt-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });

  it("returns ISO-8601 timestamps", () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
