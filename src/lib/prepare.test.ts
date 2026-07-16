import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeScratchDir } from "@/test/helpers";
import { BashGate, installCommand, startInstall } from "./prepare";

describe("installCommand", () => {
  it("maps each package manager to its install invocation", () => {
    expect(installCommand("pnpm")).toEqual(["pnpm", ["install"]]);
    expect(installCommand("npm")).toEqual(["npm", ["install"]]);
    expect(installCommand("yarn")).toEqual(["yarn", ["install"]]);
  });
});

describe("startInstall", () => {
  it("resolves ok:true when the package manager reports success", async () => {
    const { dir, cleanup } = await makeScratchDir();
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0" }), "utf8");
    const result = await startInstall(dir, "npm");
    expect(result.ok).toBe(true);
    await cleanup();
  }, 30_000);

  it("resolves ok:false (never rejects) when the install fails", async () => {
    const { dir, cleanup } = await makeScratchDir();
    // No package.json at all: npm install exits non-zero but the promise must still resolve.
    const result = await startInstall(dir, "npm");
    expect(result.ok).toBe(false);
    expect(result.output.length).toBeGreaterThan(0);
    await cleanup();
  }, 30_000);
});

describe("BashGate", () => {
  it("lets a caller wait for readiness, then never blocks again", async () => {
    const gate = new BashGate();
    let resolved = false;
    const waiter = gate.waitUntilReady().then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);
    gate.markReady();
    await waiter;
    expect(resolved).toBe(true);
    await gate.waitUntilReady(); // already ready: resolves immediately
  });
});
