import { createTicket, initForge } from "@/lib/forge/store";
import { buildTicketDraft } from "@/lib/forge/ticket-draft";
import { isTicketType } from "@/lib/forge/types";
import { resolveIdentity } from "@/lib/identity";
import { getProjectDir, getSimDelayMs } from "@/lib/project";
import { startSimulatedRun } from "@/lib/run/manager";

export const dynamic = "force-dynamic";

interface CreateTicketBody {
  prompt?: unknown;
  type?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  const parsed: unknown = await req.json().catch(() => null);
  const body = (typeof parsed === "object" && parsed !== null ? parsed : {}) as CreateTicketBody;
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const type = typeof body.type === "string" && isTicketType(body.type) ? body.type : "generic";
  const draft = buildTicketDraft(prompt, type);
  if (!draft) {
    return Response.json({ error: "prompt must not be empty" }, { status: 400 });
  }

  const projectDir = getProjectDir();
  await initForge(projectDir);
  const ticket = await createTicket(projectDir, draft, await resolveIdentity());
  const handle = startSimulatedRun(projectDir, ticket, { delayMs: getSimDelayMs() });
  return Response.json({ ticketId: ticket.id, runId: handle.run.id }, { status: 201 });
}
