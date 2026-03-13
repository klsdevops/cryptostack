-- ============================================================
-- CryptoStack · Step 1: Extensions
-- Run this FIRST in Supabase SQL Editor or via psql
-- ============================================================

-- pgcrypto is needed for bcrypt password hashing.
-- In Supabase it lives in the 'extensions' schema by default.
-- On raw PostgreSQL: CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- then change extensions.crypt → crypt everywhere below.

CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;
