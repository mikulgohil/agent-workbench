"use client";

import { useEffect, useState } from "react";
import { RUN_EVENT_KINDS, isTerminalEvent } from "@/lib/forge/types";
import type { RunEvent } from "@/lib/forge/types";
import { initialRunView, reduceRun } from "@/lib/run/reducer";
import type { RunView } from "@/lib/run/reducer";

export interface RunStreamState {
  view: RunView;
  events: RunEvent[];
}

/**
 * Subscribes to the run's SSE endpoint and folds events through the shared
 * reducer. The server closes the stream after the terminal phase-change;
 * if the connection drops mid-run we close instead of retry-looping
 * (Phase 2 adds resume, which is the correct recovery for a dropped run).
 */
export function useRunStream(runId: string): RunStreamState {
  const [state, setState] = useState<RunStreamState>({
    view: initialRunView(runId),
    events: [],
  });

  useEffect(() => {
    const source = new EventSource(`/api/runs/${runId}/stream`);
    const onEvent = (message: MessageEvent<string>): void => {
      const event = JSON.parse(message.data) as RunEvent;
      setState((current) => ({
        view: reduceRun(current.view, event),
        events: [...current.events, event],
      }));
      if (isTerminalEvent(event)) source.close();
    };
    for (const kind of RUN_EVENT_KINDS) source.addEventListener(kind, onEvent);
    source.onerror = (): void => source.close();
    return (): void => source.close();
  }, [runId]);

  return state;
}
