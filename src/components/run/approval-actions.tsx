"use client";

import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
import { useState } from "react";

const ACTIONS = ["approve", "reject"] as const;
type Action = (typeof ACTIONS)[number];

const ACTION_LABEL: Record<Action, string> = {
  approve: "Approve",
  reject: "Reject",
};

export function ApprovalActions({ ticketId }: { ticketId: string }): ReactElement {
  const router = useRouter();
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: Action): Promise<void> {
    if (pending) return;
    setPending(action);
    setError(null);
    const res = await fetch(`/api/tickets/${ticketId}/${action}`, { method: "POST" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `request failed (${res.status})`);
      setPending(null);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        {ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            disabled={pending !== null}
            onClick={() => void decide(action)}
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50"
          >
            {pending === action ? "Sending..." : ACTION_LABEL[action]}
          </button>
        ))}
      </div>
    </div>
  );
}
