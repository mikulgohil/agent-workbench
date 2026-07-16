import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

type Resolver = (result: IteratorResult<SDKUserMessage, void>) => void;

/**
 * An AsyncIterable the Agent SDK consumes as its streaming-input prompt;
 * our routes push into it to steer a running session. Verified pattern
 * from docs/blueprint/02-agent-sdk-guide.md section 2.
 */
export class UserMessageChannel implements AsyncIterable<SDKUserMessage> {
  private readonly queue: SDKUserMessage[] = [];
  private readonly waiters: Resolver[] = [];
  private closed = false;

  push(content: string): void {
    if (this.closed) return;
    const message: SDKUserMessage = {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
    };
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: message, done: false });
    else this.queue.push(message);
  }

  /** Ends the input stream; the session finishes its current turn and produces a result. */
  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage, void> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage, void>> => {
        const queued = this.queue.shift();
        if (queued) return Promise.resolve({ value: queued, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<SDKUserMessage, void>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}
