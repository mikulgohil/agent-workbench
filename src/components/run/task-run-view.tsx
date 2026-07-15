"use client";

import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { isTerminalState } from "@/lib/forge/types";
import { PlanProgressPanel } from "./plan-progress-panel";
import { RunEventList } from "./run-event-list";
import { useRunStream } from "./use-run-stream";

export function TaskRunView({ runId }: { runId: string }): ReactElement {
  const router = useRouter();
  const { view, events } = useRunStream(runId);
  const refreshed = useRef(false);

  useEffect(() => {
    if (!refreshed.current && isTerminalState(view.state)) {
      refreshed.current = true;
      router.refresh();
    }
  }, [view.state, router]);

  return (
    <div className="flex flex-col gap-6">
      <PlanProgressPanel view={view} />
      <RunEventList events={events} />
    </div>
  );
}
