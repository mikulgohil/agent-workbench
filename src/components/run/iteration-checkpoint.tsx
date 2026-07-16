"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import { formatCost } from "@/lib/ui/format";

const DECISIONS = ["continue", "stop"] as const;
type Decision = (typeof DECISIONS)[number];

const DECISION_LABEL: Record<Decision, string> = {
  continue: "Continue",
  stop: "Stop here",
};

export function IterationCheckpoint({
  runId,
  iteration,
  projectedCostUsd,
}: {
  runId: string;
  iteration: number;
  projectedCostUsd: number;
}): ReactElement {
  const [sending, setSending] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: Decision): Promise<void> {
    if (sending) return;
    setSending(decision);
    setError(null);
    const res = await fetch(`/api/runs/${runId}/iteration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `request failed (${res.status})`);
    }
    // No manual refresh: the SSE stream emits the run's next phase-change
    // once the checkpoint resolves, folding pendingIteration back to null.
    setSending(null);
  }

  return (
    <div className="mt-3 rounded-lg border border-amber-900 bg-amber-950/40 p-3 text-sm">
      <p className="text-amber-200">
        Gates still failing. Run fix iteration {iteration}? Projected added cost:{" "}
        <span className="text-amber-100">{formatCost(projectedCostUsd)}</span>
      </p>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-400">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex gap-2">
        {DECISIONS.map((decision) => (
          <button
            key={decision}
            type="button"
            disabled={sending !== null}
            onClick={() => void decide(decision)}
            className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 disabled:opacity-50"
          >
            {sending === decision ? "Sending..." : DECISION_LABEL[decision]}
          </button>
        ))}
      </div>
    </div>
  );
}
