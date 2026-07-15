import { isAbsolute } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProjectDir, getSimDelayMs } from "./project";

describe("project env resolution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws a helpful error when FORGE_PROJECT_DIR is missing", () => {
    vi.stubEnv("FORGE_PROJECT_DIR", "");
    expect(() => getProjectDir()).toThrow(/FORGE_PROJECT_DIR/);
  });

  it("resolves the project dir to an absolute path", () => {
    vi.stubEnv("FORGE_PROJECT_DIR", ".");
    expect(isAbsolute(getProjectDir())).toBe(true);
  });

  it("defaults the sim delay to 250ms and accepts overrides including 0", () => {
    vi.stubEnv("FORGE_SIM_DELAY_MS", "");
    expect(getSimDelayMs()).toBe(250);
    vi.stubEnv("FORGE_SIM_DELAY_MS", "0");
    expect(getSimDelayMs()).toBe(0);
    vi.stubEnv("FORGE_SIM_DELAY_MS", "not-a-number");
    expect(getSimDelayMs()).toBe(250);
  });
});
