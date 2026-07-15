import { describe, expect, it } from "vitest";
import { resolveIdentity } from "./identity";

describe("resolveIdentity", () => {
  it("returns a git-identity string, from git config or the fallback", async () => {
    const identity = await resolveIdentity(process.cwd());
    expect(identity).toMatch(/^.+ <.+@.+>$/);
  });
});
