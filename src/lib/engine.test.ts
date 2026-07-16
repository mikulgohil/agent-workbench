import { afterEach, describe, expect, it, vi } from "vitest";
import { isRealEngineAvailable } from "./engine";

describe("isRealEngineAvailable", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is false under NODE_ENV=test even with a key present", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-fake");
    expect(isRealEngineAvailable()).toBe(false);
  });

  it("is false outside test env when no key is set", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(isRealEngineAvailable()).toBe(false);
  });

  it("is true outside test env with a key present", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-fake");
    expect(isRealEngineAvailable()).toBe(true);
  });
});
