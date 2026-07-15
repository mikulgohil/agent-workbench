import { isTerminalEvent } from "@/lib/forge/types";
import type { RunEvent } from "@/lib/forge/types";
import { getRun, subscribe } from "@/lib/run/manager";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events endpoint for a run: replays buffered events, then
 * streams live ones (the Forge live-trace pattern). One frame per RunEvent,
 * named by the event kind so the client can addEventListener per variant.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await params;
  if (!getRun(runId)) return new Response("run not found", { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let unsubscribe: () => void = () => {};
      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        // Deferred so the synchronous replay inside subscribe() can finish
        // before we tear the listener down.
        queueMicrotask(() => unsubscribe());
        try {
          controller.close();
        } catch {
          // The runtime already closed the stream (client disconnect); done.
        }
      };
      const send = (event: RunEvent): void => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`),
        );
        if (isTerminalEvent(event)) close();
      };
      unsubscribe = subscribe(runId, send);
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
