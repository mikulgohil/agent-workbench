import type { CostRecord, Gate, RunEvent, RunEventBase, TodoItem } from "@/lib/forge/types";

/**
 * The deterministic simulator seam, ported from the Forge reference app.
 *
 * It emits the exact canonical RunEvent protocol (docs/blueprint/
 * 05-data-model.md) that the real Agent SDK adapter will emit in Phase 2,
 * so the reducer, SSE route, Plan & Progress panel, and Playwright e2e all
 * run offline, token-free, and repeatably. With delayMs = 0 the whole
 * script runs instantly (tests); with a positive delay it is paced for
 * watchability (dev server and e2e). Timestamps derive from a fixed epoch
 * plus seq, so two runs of the same script are byte-identical.
 */
export interface SimulatorOptions {
  runId: string;
  delayMs?: number;
}

export const SIMULATED_TODOS: ReadonlyArray<Pick<TodoItem, "content" | "activeForm">> = [
  {
    content: "Read ticket context and .forge knowledge",
    activeForm: "Reading ticket context and .forge knowledge",
  },
  {
    content: "Locate target files and existing patterns",
    activeForm: "Locating target files and existing patterns",
  },
  { content: "Implement the change", activeForm: "Implementing the change" },
  { content: "Add a Storybook story", activeForm: "Adding a Storybook story" },
  { content: "Run quality gates", activeForm: "Running quality gates" },
];

const STEP_TOOLS: ReadonlyArray<ReadonlyArray<{ toolName: string; input: Record<string, unknown> }>> = [
  [
    { toolName: "Read", input: { file_path: ".forge/knowledge/project.md" } },
    { toolName: "Read", input: { file_path: ".forge/knowledge/lessons.md" } },
  ],
  [
    { toolName: "Grep", input: { pattern: "Button", path: "src/components" } },
    { toolName: "Read", input: { file_path: "src/components/ui/input.tsx" } },
  ],
  [
    { toolName: "Write", input: { file_path: "src/components/ui/button.tsx" } },
    { toolName: "Edit", input: { file_path: "src/components/ui/index.ts" } },
  ],
  [{ toolName: "Write", input: { file_path: "src/components/ui/button.stories.tsx" } }],
  [
    { toolName: "Bash", input: { command: "pnpm run typecheck" } },
    { toolName: "Bash", input: { command: "pnpm run lint" } },
    { toolName: "Bash", input: { command: "pnpm run test" } },
  ],
];

const SIMULATED_GATES: Gate[] = [
  {
    name: "typecheck",
    basis: "command",
    status: "passed",
    score: 100,
    explanation: "tsc --noEmit exited 0",
    durationMs: 4200,
  },
  {
    name: "lint",
    basis: "command",
    status: "passed",
    score: 100,
    explanation: "eslint exited 0",
    durationMs: 2100,
  },
  {
    name: "test",
    basis: "command",
    status: "passed",
    score: 100,
    explanation: "12 tests passed",
    durationMs: 6300,
  },
];

/** Fixed epoch so `at` timestamps are deterministic across runs. */
const SIM_EPOCH_MS = Date.parse("2026-01-01T00:00:00.000Z");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function todoSnapshot(completedCount: number, inProgressIndex: number | null): TodoItem[] {
  return SIMULATED_TODOS.map((todo, index) => ({
    content: todo.content,
    activeForm: todo.activeForm,
    status:
      index < completedCount ? "completed" : index === inProgressIndex ? "in_progress" : "pending",
  }));
}

export async function* simulateRun(options: SimulatorOptions): AsyncGenerator<RunEvent> {
  const delayMs = options.delayMs ?? 0;
  let seq = 0;
  const cumulative: CostRecord = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
  const stamp = (): RunEventBase => {
    seq += 1;
    return { seq, at: new Date(SIM_EPOCH_MS + seq * 1000).toISOString() };
  };
  const pace = async (): Promise<void> => {
    if (delayMs > 0) await sleep(delayMs);
  };

  yield {
    ...stamp(),
    kind: "run-started",
    sessionId: `sim-session-${options.runId}`,
    worktreePath: null,
    branchName: null,
  };
  await pace();
  yield { ...stamp(), kind: "phase-change", from: "preparing", to: "planning" };
  await pace();
  yield { ...stamp(), kind: "message", text: "Planning the work for this ticket." };
  await pace();
  yield { ...stamp(), kind: "todo-update", todos: todoSnapshot(0, null) };
  await pace();
  yield { ...stamp(), kind: "phase-change", from: "planning", to: "executing" };

  for (let index = 0; index < SIMULATED_TODOS.length; index++) {
    const isGateStep = index === SIMULATED_TODOS.length - 1;
    await pace();
    yield { ...stamp(), kind: "todo-update", todos: todoSnapshot(index, index) };
    await pace();
    yield { ...stamp(), kind: "message", text: `${SIMULATED_TODOS[index].activeForm}.` };
    for (const [toolIndex, use] of STEP_TOOLS[index].entries()) {
      await pace();
      yield {
        ...stamp(),
        kind: "tool-use",
        toolUseId: `tu-${index + 1}-${toolIndex + 1}`,
        toolName: use.toolName,
        input: use.input,
      };
    }
    if (isGateStep) {
      await pace();
      yield { ...stamp(), kind: "phase-change", from: "executing", to: "gates-running" };
      for (const gate of SIMULATED_GATES) {
        await pace();
        yield { ...stamp(), kind: "gate-result", gate };
      }
    }
    cumulative.inputTokens += 900;
    cumulative.outputTokens += 350;
    cumulative.costUsd =
      Math.round((cumulative.inputTokens * 0.000003 + cumulative.outputTokens * 0.000015) * 1e6) /
      1e6;
    await pace();
    yield { ...stamp(), kind: "cost-update", cumulative: { ...cumulative } };
    await pace();
    yield { ...stamp(), kind: "todo-update", todos: todoSnapshot(index + 1, null) };
  }

  await pace();
  yield { ...stamp(), kind: "phase-change", from: "gates-running", to: "completed" };
}

export async function collectRunEvents(options: SimulatorOptions): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const event of simulateRun(options)) events.push(event);
  return events;
}
