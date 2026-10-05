# Postgres 17 with pgvector and pg_textsearch (BM25).
# timescaledb-ha ships both extensions prebuilt, so nothing is compiled here.
FROM timescale/timescaledb-ha:pg17

COPY init/ /docker-entrypoint-initdb.d/
