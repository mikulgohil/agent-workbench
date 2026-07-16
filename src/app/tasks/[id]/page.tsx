import { notFound } from "next/navigation";
import type { ReactElement } from "react";
import { ApprovalActions } from "@/components/run/approval-actions";
import { TaskRunView } from "@/components/run/task-run-view";
import { readTicket } from "@/lib/forge/store";
import { getProjectDir } from "@/lib/project";
import { findLatestRunForTicket } from "@/lib/run/manager";

export const dynamic = "force-dynamic";

export default async function TaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  const ticket = await readTicket(getProjectDir(), id);
  if (!ticket) notFound();
  const handle = findLatestRunForTicket(ticket.id);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <p className="text-xs uppercase tracking-wider text-zinc-500">{ticket.type}</p>
        <h1 className="text-xl font-semibold">{ticket.title}</h1>
      </header>
      {handle ? (
        <TaskRunView key={handle.run.id} runId={handle.run.id} />
      ) : (
        <p className="text-sm text-zinc-500">No run recorded for this task yet.</p>
      )}
      {ticket.status === "review" ? <ApprovalActions ticketId={ticket.id} /> : null}
    </div>
  );
}
