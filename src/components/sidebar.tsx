import Link from "next/link";
import type { ReactElement } from "react";
import { listTickets } from "@/lib/forge/store";
import type { Ticket } from "@/lib/forge/types";
import { getProjectDir } from "@/lib/project";
import { SIDEBAR_GROUP_LABELS, SIDEBAR_GROUPS, groupTickets } from "@/lib/ui/group-tickets";

export async function Sidebar(): Promise<ReactElement> {
  let tickets: Ticket[] = [];
  let configError: string | null = null;
  try {
    tickets = await listTickets(getProjectDir());
  } catch (error) {
    configError = error instanceof Error ? error.message : String(error);
  }
  const groups = groupTickets(tickets);

  return (
    <nav
      aria-label="Tasks"
      className="w-72 shrink-0 space-y-6 overflow-y-auto border-r border-zinc-800 p-4"
    >
      <Link href="/" className="block text-sm font-semibold tracking-wide text-zinc-100">
        Agent Workbench
      </Link>
      {configError ? (
        <p className="text-xs text-amber-400">{configError}</p>
      ) : (
        SIDEBAR_GROUPS.map((group) => (
          <section key={group}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-400">
              {SIDEBAR_GROUP_LABELS[group]} ({groups[group].length})
            </h2>
            <ul className="space-y-1">
              {groups[group].map((ticket) => (
                <li key={ticket.id}>
                  <Link
                    href={`/tasks/${ticket.id}`}
                    className="block rounded px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                  >
                    {ticket.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </nav>
  );
}
