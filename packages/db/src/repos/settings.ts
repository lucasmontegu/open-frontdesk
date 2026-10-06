import type { ContactWindow, OrgSettingsRepository } from "@ofd/core";
import { eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { orgSettings } from "../schema/index.js";

export class PgOrgSettingsRepository implements OrgSettingsRepository {
  constructor(private readonly db: Db) {}

  async getContactWindow(orgId: string): Promise<ContactWindow | null> {
    const [row] = await this.db
      .select({ contactWindow: orgSettings.contactWindow })
      .from(orgSettings)
      .where(eq(orgSettings.orgId, orgId));
    return row?.contactWindow ?? null;
  }

  async setContactWindow(orgId: string, window: ContactWindow | null): Promise<void> {
    await this.db
      .insert(orgSettings)
      .values({ orgId, contactWindow: window })
      .onConflictDoUpdate({
        target: orgSettings.orgId,
        set: { contactWindow: window, updatedAt: new Date() },
      });
  }
}
