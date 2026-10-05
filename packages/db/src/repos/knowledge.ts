import type { KnowledgeSearch } from "@ofd/core";
import { sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { newId } from "../ids.js";
import { knowledgeDocs } from "../schema/index.js";

export type Embed = (text: string) => Promise<number[]>;

type Hit = { id: string; title: string; content: string };

const RRF_K = 60;
const BM25_INDEX = "knowledge_docs_content_bm25";

/**
 * BM25 (pg_textsearch, Spanish config) ranks lexical matches. When an embedder is injected,
 * pgvector cosine similarity ranks semantic matches and both lists are merged with reciprocal
 * rank fusion. Score semantics: with an embedder it is the RRF score; without one it is the
 * negated BM25 score. In both cases higher is better.
 *
 * The BM25 index is global, so the org filter is applied after the index scan. A candidate pool
 * larger than `limit` is fetched to keep results full when other orgs' documents rank first.
 */
export class PgKnowledgeSearch implements KnowledgeSearch {
  constructor(
    private readonly db: Db,
    private readonly embed?: Embed,
  ) {}

  async ingest(
    orgId: string,
    doc: { title: string; content: string; botId?: string | null },
  ): Promise<{ id: string }> {
    const id = newId("kd");
    const embedding = this.embed ? await this.embed(`${doc.title}\n${doc.content}`) : null;
    await this.db.insert(knowledgeDocs).values({
      id,
      orgId,
      botId: doc.botId ?? null,
      title: doc.title,
      content: doc.content,
      embedding,
    });
    return { id };
  }

  async search(orgId: string, query: string, opts: { limit?: number; botId?: string } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 5, 1), 50);
    const pool = Math.max(limit * 5, 25);
    const botFilter = opts.botId ? sql`and (bot_id is null or bot_id = ${opts.botId})` : sql``;

    const bm25 = (await this.db.execute(sql`
      select id, title, content, content <@> to_bm25query(${query}, ${BM25_INDEX}) as score
      from knowledge_docs
      where org_id = ${orgId} ${botFilter}
      order by content <@> to_bm25query(${query}, ${BM25_INDEX})
      limit ${pool}`)) as unknown as Array<Hit & { score: number }>;
    const lexical = bm25.filter((r) => Number(r.score) < 0);

    if (!this.embed) {
      return lexical
        .slice(0, limit)
        .map((r) => ({ id: r.id, title: r.title, content: r.content, score: -Number(r.score) }));
    }

    const vec = JSON.stringify(await this.embed(query));
    const semantic = (await this.db.execute(sql`
      select id, title, content
      from knowledge_docs
      where org_id = ${orgId} and embedding is not null ${botFilter}
      order by embedding <=> ${vec}::vector
      limit ${pool}`)) as unknown as Hit[];

    const fused = new Map<string, Hit & { score: number }>();
    for (const list of [lexical, semantic]) {
      list.forEach((hit, rank) => {
        const prev = fused.get(hit.id);
        const add = 1 / (RRF_K + rank + 1);
        fused.set(hit.id, {
          id: hit.id,
          title: hit.title,
          content: hit.content,
          score: (prev?.score ?? 0) + add,
        });
      });
    }
    return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
