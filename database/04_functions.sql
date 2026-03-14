-- ============================================================
-- CryptoStack · Step 4: Functions & Triggers
-- Run AFTER 03_indexes.sql
--
-- IMPORTANT — Supabase vs raw PostgreSQL:
--   Supabase puts pgcrypto in the 'extensions' schema.
--   Raw PostgreSQL: run CREATE EXTENSION pgcrypto; then
--   replace every  extensions.crypt   →  crypt
--   replace every  extensions.gen_salt →  gen_salt
-- ============================================================

-- ── Trigger: auto-update updated_at on cs_transactions ──────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_updated_at ON public.cs_transactions;
CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON public.cs_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Function: hash a user password with bcrypt ───────────────
CREATE OR REPLACE FUNCTION public.set_user_password(
  p_user_id UUID,
  p_password TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  UPDATE public.cs_users
  SET password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 12))
  WHERE id = p_user_id;
END;
$$;

-- ── Function: verify a user password and return user row ─────
CREATE OR REPLACE FUNCTION public.verify_user_password(
  p_username TEXT,
  p_password TEXT
)
RETURNS TABLE(
  id       UUID,
  username TEXT,
  name     TEXT,
  province TEXT,
  role     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.username,
    u.name,
    u.province,
    u.role
  FROM public.cs_users u
  WHERE u.username = p_username
    AND u.password_hash = extensions.crypt(p_password, u.password_hash);
END;
$$;
