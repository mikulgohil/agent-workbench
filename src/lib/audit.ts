import { join } from "node:path";
import type { AuditEvent } from "@/lib/forge/types";
import { appendJsonl, readJsonl } from "@/lib/forge/jsonl";
import { forgeDir } from "@/lib/forge/store";
import { APP_VERSION } from "@/lib/version";

/** Distributive Omit for discriminated unions: ensures Omit distributes over union members. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

function auditFilePath(projectDir: string, yyyymm: string): string {
  return join(forgeDir(projectDir), "audit", `${yyyymm}.jsonl`);
}

function currentYyyyMm(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Append-only, one file per calendar month (spec: .forge/audit/<YYYY-MM>.jsonl). */
export async function appendAuditEvent(
  projectDir: string,
  event: DistributiveOmit<AuditEvent, "at" | "appVersion">,
): Promise<void> {
  const full: AuditEvent = { ...event, at: new Date().toISOString(), appVersion: APP_VERSION };
  await appendJsonl(auditFilePath(projectDir, currentYyyyMm()), full);
}

export async function readAuditEvents(projectDir: string, yyyymm: string): Promise<AuditEvent[]> {
  return readJsonl<AuditEvent>(auditFilePath(projectDir, yyyymm));
}
