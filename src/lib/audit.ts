import { join } from "node:path";
import { appendJsonl, readJsonl } from "@/lib/forge/jsonl";
import { forgeDir } from "@/lib/forge/store";
import { APP_VERSION } from "@/lib/version";

export interface AuditEvent {
  at: string;
  user: string;
  ticketId: string | null;
  event: string;
  detail: Record<string, unknown>;
  appVersion: string;
}

function auditFilePath(projectDir: string, yyyymm: string): string {
  return join(forgeDir(projectDir), "audit", `${yyyymm}.jsonl`);
}

function currentYyyyMm(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Append-only, one file per calendar month (spec: .forge/audit/<YYYY-MM>.jsonl). */
export async function appendAuditEvent(
  projectDir: string,
  event: Omit<AuditEvent, "at" | "appVersion">,
): Promise<void> {
  const full: AuditEvent = { ...event, at: new Date().toISOString(), appVersion: APP_VERSION };
  await appendJsonl(auditFilePath(projectDir, currentYyyyMm()), full);
}

export async function readAuditEvents(projectDir: string, yyyymm: string): Promise<AuditEvent[]> {
  return readJsonl<AuditEvent>(auditFilePath(projectDir, yyyymm));
}
