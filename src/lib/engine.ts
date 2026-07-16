/**
 * The simulator/real-engine seam (docs/blueprint/02-agent-sdk-guide.md
 * section 10.4, ported from the Forge reference app's isAnthropicReady()).
 * Tests and CI always take the deterministic simulator path and never
 * spawn the Agent SDK subprocess; this is the ONLY gate that decides
 * that, so every other module composes on top of it rather than
 * re-checking env vars itself.
 */
export function isRealEngineAvailable(): boolean {
  if (process.env.NODE_ENV === "test") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim().length > 0);
}
