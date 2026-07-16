import { describe, expect, it } from "vitest";
import { isDeniedPath, toSdkDenyRules } from "./deny-read";

describe("isDeniedPath", () => {
  const globs = [".env*", "*.pem", "*secret*"];

  it("matches files against each configured glob", () => {
    expect(isDeniedPath("/repo/.env.local", globs)).toBe(true);
    expect(isDeniedPath("/repo/keys/server.pem", globs)).toBe(true);
    expect(isDeniedPath("/repo/config/secrets.json", globs)).toBe(true);
    expect(isDeniedPath("/repo/src/index.ts", globs)).toBe(false);
  });

  it("returns false for an empty glob list", () => {
    expect(isDeniedPath("/repo/.env", [])).toBe(false);
  });
});

describe("toSdkDenyRules", () => {
  it("wraps each glob as an absolute-anchored Read() deny rule", () => {
    expect(toSdkDenyRules([".env*", "*.pem"])).toEqual(["Read(//**/.env*)", "Read(//**/*.pem)"]);
  });
});
