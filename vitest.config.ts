import path from "node:path";
import { defineConfig } from "vitest/config";

// The domain layer is framework-free (pure functions over plain data plus
// node:fs against scratch dirs), so tests run in a plain node environment.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Several suites do real work (node:fs against scratch dirs, real `git`
    // subprocesses in worktree.test.ts). Under full-suite parallel execution
    // these contend for CPU/IO, so timing-based tests that finish in ~150ms
    // in isolation can transiently exceed vitest's 5s default and flake. A
    // generous global ceiling removes that class of false timeout without
    // masking a genuine hang (a real deadlock still trips 20s).
    testTimeout: 20000,
  },
});
