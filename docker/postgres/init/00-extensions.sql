-- Extensions OpenFrontDesk relies on. pg_textsearch must also be in shared_preload_libraries.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_textsearch;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
