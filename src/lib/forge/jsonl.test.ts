import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeScratchDir } from "@/test/helpers";
import { appendJsonl, readJsonl } from "./jsonl";

interface Entry {
  n: number;
  label: string;
}

describe("jsonl", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await makeScratchDir());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns [] for a missing file", async () => {
    expect(await readJsonl<Entry>(join(dir, "missing.jsonl"))).toEqual([]);
  });

  it("appends records one per line and reads them back in order", async () => {
    const file = join(dir, "nested", "log.jsonl");
    await appendJsonl(file, { n: 1, label: "first" });
    await appendJsonl(file, { n: 2, label: "second" });
    expect(await readJsonl<Entry>(file)).toEqual([
      { n: 1, label: "first" },
      { n: 2, label: "second" },
    ]);
  });

  it("ignores blank lines when reading", async () => {
    const file = join(dir, "log.jsonl");
    await appendJsonl(file, { n: 1, label: "only" });
    const { appendFile } = await import("node:fs/promises");
    await appendFile(file, "\n\n", "utf8");
    expect(await readJsonl<Entry>(file)).toEqual([{ n: 1, label: "only" }]);
  });
});
