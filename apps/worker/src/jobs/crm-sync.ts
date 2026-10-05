import { z } from "zod";
import type { ContactRepository, CrmConnector, ObligationRepository } from "@ofd/core";
import { CrmSyncService, type SyncResult } from "@ofd/crm";
import { type Log, silentLog } from "../deps.js";

export const CrmSyncJob = z.object({
  orgId: z.string().min(1),
  /** Which connector to pull from, e.g. "hubspot". */
  connectorId: z.string().min(1),
  /** Pull only records changed since this ISO time; omit for a full sync. */
  since: z.string().optional(),
});

export interface CrmSyncDeps {
  contacts: ContactRepository;
  obligations: ObligationRepository;
  /**
   * Resolves the connector (with its credentials) for an org. TODO: per-org connector settings;
   * today the container resolves from environment variables.
   */
  connectorFor(orgId: string, connectorId: string): CrmConnector | null;
  log?: Log;
}

export async function crmSync(deps: CrmSyncDeps, data: unknown): Promise<SyncResult | null> {
  const job = CrmSyncJob.parse(data);
  const log = deps.log ?? silentLog;
  const connector = deps.connectorFor(job.orgId, job.connectorId);
  if (!connector) {
    log.warn({ orgId: job.orgId, connectorId: job.connectorId }, "crm.sync: connector not configured");
    return null;
  }
  const service = new CrmSyncService({ contacts: deps.contacts, obligations: deps.obligations, connector });
  const result = await service.pull(job.orgId, job.since ? new Date(job.since) : null);
  log.info({ orgId: job.orgId, connectorId: job.connectorId, ...result, errors: result.errors.length }, "crm.sync finished");
  // TODO: persist the last successful sync time per connector so the next run is incremental.
  return result;
}
