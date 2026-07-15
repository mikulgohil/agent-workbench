import type { ReactElement } from "react";
import { CreateBox } from "@/components/create-box";

export const dynamic = "force-dynamic";

export default function HomePage(): ReactElement {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">What would you like to work on?</h1>
      <CreateBox />
      <p className="text-sm text-zinc-400">
        Type a prompt and press Start. A generic task is created and a simulated run streams its
        progress live. Pick a task type for template-driven fields in a later phase.
      </p>
    </div>
  );
}
