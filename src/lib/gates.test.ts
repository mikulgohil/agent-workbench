import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeScratchDir } from "@/test/helpers";
import { runGate } from "./gates";

async function fixtureWithScript(script: string): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const { dir, cleanup } = await makeScratchDir();
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.0.0", scripts: { mygate: script } }, null, 2),
    "utf8",
  );
  return { dir, cleanup };
}

describe("runGate", () => {
  it("passes when the script exits 0", async () => {
    const { dir, cleanup } = await fixtureWithScript("node -e \"process.exit(0)\"");
    const gate = await runGate(dir, "test", "mygate", "npm");
    expect(gate).toMatchObject({ name: "test", basis: "command", status: "passed" });
    await cleanup();
  }, 15_000);

  it("fails when the script exits non-zero, capturing output", async () => {
    const { dir, cleanup } = await fixtureWithScript("node -e \"console.error('boom'); process.exit(1)\"");
    const gate = await runGate(dir, "test", "mygate", "npm");
    expect(gate.status).toBe("failed");
    expect(gate.explanation).toContain("boom");
    await cleanup();
  }, 15_000);

  it("scores warning (never failed) when the script is not configured", async () => {
    const { dir, cleanup } = await makeScratchDir();
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0", scripts: {} }), "utf8");
    const gate = await runGate(dir, "lint", "lint", "npm");
    expect(gate.status).toBe("warning");
    expect(gate.explanation).toMatch(/not configured/);
    await cleanup();
  }, 15_000);

  it("kills the process and fails with a timeout explanation when it exceeds the timeout", async () => {
    const { dir, cleanup } = await fixtureWithScript("node -e \"setTimeout(() => {}, 60000)\"");
    const gate = await runGate(dir, "test", "mygate", "npm", 500);
    expect(gate.status).toBe("failed");
    expect(gate.explanation).toMatch(/timeout/i);
    await cleanup();
  }, 15_000);

  it("truncates very long output keeping the head and tail", async () => {
    const bigOutput = "x".repeat(60_000);
    const { dir, cleanup } = await fixtureWithScript(`node -e "console.error('${bigOutput}'); process.exit(1)"`);
    const gate = await runGate(dir, "test", "mygate", "npm");
    expect(gate.explanation.length).toBeLessThan(bigOutput.length);
    expect(gate.explanation).toContain("truncated");
    await cleanup();
  }, 15_000);
});
