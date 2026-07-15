import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FIXTURE_PROJECT = join(__dirname, ".fixture-project");

export default async function globalSetup(): Promise<void> {
  await rm(FIXTURE_PROJECT, { recursive: true, force: true });
  await mkdir(FIXTURE_PROJECT, { recursive: true });
  await writeFile(
    join(FIXTURE_PROJECT, "package.json"),
    `${JSON.stringify({ name: "fixture-project", private: true, version: "0.0.0" }, null, 2)}\n`,
    "utf8",
  );
}
