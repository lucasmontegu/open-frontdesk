import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { newId } from "../ids.js";
import { evalRuns } from "../schema/index.js";

export interface EvalRunFailure {
  scenario: string;
  reason: string;
}

export interface EvalRunRow {
  id: string;
  orgId: string;
  botVersionId: string;
  passed: boolean;
  /** 0..1 */
  score: number;
  summary: string;
  failures: EvalRunFailure[];
  createdAt: Date;
}

export interface NewEvalRun {
  botVersionId: string;
  passed: boolean;
  score: number;
  summary: string;
  failures: EvalRunFailure[];
}

const toRow = (r: typeof evalRuns.$inferSelect): EvalRunRow => {
  const report = r.report as Partial<Pick<EvalRunRow, "score" | "summary" | "failures">>;
  return {
    id: r.id,
    orgId: r.orgId,
    botVersionId: r.botVersionId,
    passed: r.passed,
    score: report.score ?? (r.passed ? 1 : 0),
    summary: report.summary ?? "",
    failures: report.failures ?? [],
    createdAt: r.createdAt,
  };
};

/** The table keeps `passed` as a column; score, summary and failures live in the `report` JSON. */
export class EvalRunRepository {
  constructor(private readonly db: Db) {}

  async create(orgId: string, input: NewEvalRun): Promise<EvalRunRow> {
    const rows = await this.db
      .insert(evalRuns)
      .values({
        id: newId("ev"),
        orgId,
        botVersionId: input.botVersionId,
        passed: input.passed,
        report: { score: input.score, summary: input.summary, failures: input.failures },
      })
      .returning();
    return toRow(rows[0] as typeof evalRuns.$inferSelect);
  }

  async get(orgId: string, id: string): Promise<EvalRunRow | null> {
    const rows = await this.db.select().from(evalRuns).where(and(eq(evalRuns.orgId, orgId), eq(evalRuns.id, id)));
    return rows[0] ? toRow(rows[0]) : null;
  }

  /** Newest first. */
  async listByVersion(orgId: string, botVersionId: string): Promise<EvalRunRow[]> {
    const rows = await this.db
      .select()
      .from(evalRuns)
      .where(and(eq(evalRuns.orgId, orgId), eq(evalRuns.botVersionId, botVersionId)))
      .orderBy(desc(evalRuns.createdAt));
    return rows.map(toRow);
  }
}
