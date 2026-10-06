import type { ContactWindow } from "@ofd/core";
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** One row per organization that changed a setting. Missing row or null column = deployment default. */
export const orgSettings = pgTable("org_settings", {
  orgId: text("org_id").primaryKey(),
  contactWindow: jsonb("contact_window").$type<ContactWindow>(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
