-- BM25 full-text index for knowledge search (pg_textsearch). Spanish text config.
CREATE INDEX "knowledge_docs_content_bm25" ON "knowledge_docs" USING bm25 ("content") WITH (text_config = 'spanish');--> statement-breakpoint
-- Vector similarity index for the optional semantic half of hybrid search.
CREATE INDEX "knowledge_docs_embedding_hnsw" ON "knowledge_docs" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
-- The event log is the record: events can never be changed or removed.
CREATE FUNCTION "events_reject_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'events is append-only (% rejected)', TG_OP;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "events_append_only" BEFORE UPDATE OR DELETE ON "events"
  FOR EACH ROW EXECUTE FUNCTION "events_reject_mutation"();
