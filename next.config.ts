import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pins the workspace root to this repo so Next.js stops guessing between
  // this project's pnpm-workspace.yaml and an unrelated lockfile elsewhere
  // on the machine (~/pnpm-lock.yaml), which otherwise prints a warning on
  // every dev/build/e2e run.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
