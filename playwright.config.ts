import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const FIXTURE_PROJECT = join(__dirname, "e2e", ".fixture-project");

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3100",
  },
  webServer: {
    command: "pnpm dev --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    env: {
      FORGE_PROJECT_DIR: FIXTURE_PROJECT,
      FORGE_SIM_DELAY_MS: "25",
      // Force the simulator path regardless of the developer's ambient shell
      // env - `next dev` runs with NODE_ENV=development (never "test"), so
      // isRealEngineAvailable() would otherwise pick the real Agent SDK
      // engine whenever ANTHROPIC_API_KEY happens to be set locally.
      ANTHROPIC_API_KEY: "",
    },
  },
});
