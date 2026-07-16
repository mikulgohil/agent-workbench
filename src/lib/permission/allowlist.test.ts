import { describe, expect, it } from "vitest";
import { resolveBashCommand } from "./allowlist";

describe("resolveBashCommand", () => {
  const allowlist = ["pnpm install", "pnpm run *"];

  it("allowlists an exact match", () => {
    expect(resolveBashCommand("pnpm install", allowlist)).toEqual({ kind: "allowlisted" });
  });

  it("allowlists a glob match", () => {
    expect(resolveBashCommand("pnpm run typecheck", allowlist)).toEqual({ kind: "allowlisted" });
  });

  it("prompts for anything not matched", () => {
    expect(resolveBashCommand("rm -rf /", allowlist)).toEqual({ kind: "prompt" });
    expect(resolveBashCommand("curl https://example.com", allowlist)).toEqual({ kind: "prompt" });
  });

  it("prompts when the allowlist is empty", () => {
    expect(resolveBashCommand("pnpm install", [])).toEqual({ kind: "prompt" });
  });
});
