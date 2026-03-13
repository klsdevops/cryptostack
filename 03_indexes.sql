-- ============================================================
-- CryptoStack · Step 2: Tables
-- Run AFTER 01_extensions.sql
-- ============================================================

-- ── Admin configuration (key-value store) ───────────────────
CREATE TABLE IF NOT EXISTS public.cs_admin_config (
  key        TEXT        PRIMARY KEY,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Cryptocurrencies ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cs_coins (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol       TEXT        NOT NULL UNIQUE,
  name         TEXT        NOT NULL,
  coingecko_id TEXT,
  icon         TEXT,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Exchanges / Wallets / Banks ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.cs_providers (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL UNIQUE,
  type       TEXT        NOT NULL CHECK (type IN ('EXCHANGE','WALLET','BANK')),
  icon       TEXT,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Users ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cs_users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,
  province      TEXT        NOT NULL DEFAULT 'AB',
  role          TEXT        NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- ── Sessions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cs_sessions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.cs_users(id) ON DELETE CASCADE,
  token       TEXT        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  remember_me BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  last_active TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Transactions ─────────────────────────────────────────────
-- subtotal_cad and total_cad are GENERATED (never write to them)
CREATE TABLE IF NOT EXISTS public.cs_transactions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES public.cs_users(id) ON DELETE CASCADE,
  type                TEXT        NOT NULL CHECK (type IN (
    'BUY','SELL','TRANSFER','TRANSFER_OUT','TRANSFER_IN',
    'SWAP_IN','SWAP_OUT','AIRDROP','STAKING'
  )),
  coin_id             UUID        NOT NULL REFERENCES public.cs_coins(id),
  quantity            NUMERIC     NOT NULL,
  price_per_unit_cad  NUMERIC     NOT NULL,
  subtotal_cad        NUMERIC     GENERATED ALWAYS AS (quantity * price_per_unit_cad) STORED,
  fees_cad            NUMERIC     NOT NULL DEFAULT 0,
  total_cad           NUMERIC     GENERATED ALWAYS AS ((quantity * price_per_unit_cad) + fees_cad) STORED,
  from_provider_id    UUID        REFERENCES public.cs_providers(id),
  to_provider_id      UUID        REFERENCES public.cs_providers(id),
  transacted_at       TIMESTAMPTZ NOT NULL,
  -- ACB / capital gains fields
  acb_per_unit_before NUMERIC,
  acb_per_unit_after  NUMERIC,
  capital_gain_cad    NUMERIC,
  is_taxable          BOOLEAN     NOT NULL DEFAULT false,
  superficial_loss    BOOLEAN     NOT NULL DEFAULT false,
  -- Blockchain / notes
  tx_hash             TEXT,
  notes               TEXT,
  compliance_note     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Internal transfer grouping (TRANSFER_OUT + TRANSFER_IN share same group)
  transfer_group_id   UUID,
  transfer_role       TEXT,
  fee_treatment       TEXT,
  fee_units           NUMERIC,
  fee_fmv_cad         NUMERIC,
  fee_acb_cad         NUMERIC,
  fee_gain_cad        NUMERIC,
  -- Crypto-to-crypto swap grouping (SWAP_OUT + SWAP_IN share same group)
  swap_group_id       UUID,
  swap_role           TEXT,
  -- CSV import deduplication
  external_id         TEXT
);

-- ── Import logs ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cs_import_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES public.cs_users(id) ON DELETE CASCADE,
  exchange      TEXT        NOT NULL,
  filename      TEXT,
  rows_parsed   INTEGER     NOT NULL DEFAULT 0,
  rows_imported INTEGER     NOT NULL DEFAULT 0,
  rows_skipped  INTEGER     NOT NULL DEFAULT 0,
  rows_errored  INTEGER     NOT NULL DEFAULT 0,
  status        TEXT        NOT NULL DEFAULT 'complete',
  error_detail  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Profit simulations ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cs_simulations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES public.cs_users(id) ON DELETE CASCADE,
  coin_id             UUID        NOT NULL REFERENCES public.cs_coins(id),
  quantity            NUMERIC     NOT NULL,
  purchase_price_cad  NUMERIC     NOT NULL,
  fees_cad            NUMERIC     NOT NULL DEFAULT 0,
  forecasted_profit   NUMERIC     NOT NULL,
  required_sell_price NUMERIC     NOT NULL,
  cost_basis_cad      NUMERIC     NOT NULL,
  gross_proceeds_cad  NUMERIC     NOT NULL,
  sell_fees_cad       NUMERIC     NOT NULL,
  gross_profit_cad    NUMERIC     NOT NULL,
  net_profit_cad      NUMERIC     NOT NULL,
  label               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
