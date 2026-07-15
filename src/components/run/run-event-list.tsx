import type { ReactElement } from "react";
import type { RunEvent } from "@/lib/forge/types";
import { describeEvent } from "@/lib/ui/describe-event";

export function RunEventList({ events }: { events: RunEvent[] }): ReactElement {
  return (
    <section aria-label="Run stream" className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
        Run stream
      </h2>
      <ol className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs text-zinc-400">
        {events.map((event) => (
          <li key={event.seq}>{describeEvent(event)}</li>
        ))}
      </ol>
    </section>
  );
}
