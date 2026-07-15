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
  },
});
