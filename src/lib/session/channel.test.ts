import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { UserMessageChannel } from "./channel";

async function take(iterable: AsyncIterable<SDKUserMessage>, n: number): Promise<string[]> {
  const out: string[] = [];
  for await (const message of iterable) {
    const content = message.message.content;
    const contentStr = typeof content === "string" ? content : "";
    out.push(contentStr);
    if (out.length === n) break;
  }
  return out;
}

describe("UserMessageChannel", () => {
  it("yields a pushed message immediately to an active iterator", async () => {
    const channel = new UserMessageChannel();
    const pending = take(channel, 1);
    channel.push("hello");
    expect(await pending).toEqual(["hello"]);
  });

  it("queues messages pushed before anyone iterates", async () => {
    const channel = new UserMessageChannel();
    channel.push("first");
    channel.push("second");
    expect(await take(channel, 2)).toEqual(["first", "second"]);
  });

  it("ends iteration once closed with no more queued messages", async () => {
    const channel = new UserMessageChannel();
    channel.push("only");
    channel.close();
    const iterator = channel[Symbol.asyncIterator]();
    expect((await iterator.next()).value?.message.content).toBe("only");
    expect((await iterator.next()).done).toBe(true);
  });

  it("ignores a push after close", async () => {
    const channel = new UserMessageChannel();
    channel.close();
    channel.push("too late");
    const iterator = channel[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(true);
  });
});
