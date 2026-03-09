-- ============================================================
-- CryptoStackArch — Complete Database Schema
-- Compatible with: Supabase (PostgreSQL 15+)
-- Run this entire script in Supabase SQL Editor or psql
-- ============================================================

-- ── Enable required extensions ────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- crypt(), gen_salt()
CREATE EXTENSION IF NOT EXISTS "pg_net";     -- (optional, for webhooks)

-- ============================================================
-- TABLE: cs_users
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cs_users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,
  province      TEXT        NOT NULL DEFAULT 'AB',
  role          TEXT        NOT NULL DEFAULT 'user',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,

  CONSTRAINT cs_users_role_check CHECK (role = ANY (ARRAY['user','admin']))
);

-- ============================================================
-- TABLE: cs_sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cs_sessions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.cs_users(id) ON DELETE CASCADE,
  token       TEXT        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  remember_me BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  last_active TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLE: cs_coins
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cs_coins (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol        TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL,
  coingecko_id  TEXT,
  icon          TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLE: cs_providers
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cs_providers (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT    NOT NULL UNIQUE,
  type       TEXT    NOT NULL,
  icon       TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT cs_providers_type_check CHECK (type = ANY (ARRAY['EXCHANGE','WALLET','BANK']))
);

-- ============================================================
-- TABLE: cs_transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cs_transactions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES public.cs_users(id) ON DELETE CASCADE,
  type               TEXT        NOT NULL,
  coin_id            UUID        NOT NULL REFERENCES public.cs_coins(id),
  quantity           NUMERIC     NOT NULL,
  price_per_unit_cad NUMERIC     NOT NULL,

  -- ⚠ GENERATED ALWAYS columns — NEVER include in INSERT or UPDATE
  subtotal_cad       NUMERIC     GENERATED ALWAYS AS (quantity * price_per_unit_cad) STORED,
  fees_cad           NUMERIC     NOT NULL DEFAULT 0,
  total_cad          NUMERIC     GENERATED ALWAYS AS ((quantity * price_per_unit_cad) + fees_cad) STORED,

  from_provider_id   UUID        REFERENCES public.cs_providers(id),
  to_provider_id     UUID        REFERENCES public.cs_providers(id),
  transacted_at      TIMESTAMPTZ NOT NULL,
  acb_per_unit_before NUMERIC,
  acb_per_unit_after  NUMERIC,
  capital_gain_cad   NUMERIC,
  is_taxable         BOOLEAN     NOT NULL DEFAULT false,
  superficial_loss   BOOLEAN     NOT NULL DEFAULT false,
  tx_hash            TEXT,
  notes              TEXT,
  compliance_note    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Transfer pair columns
  transfer_group_id  UUID,
  transfer_role      TEXT,
  fee_treatment      TEXT,
  fee_units          NUMERIC,
  fee_fmv_cad        NUMERIC,
  fee_acb_cad        NUMERIC,
  fee_gain_cad       NUMERIC,

  -- Swap pair columns
  swap_group_id      UUID,
  swap_role          TEXT,

  CONSTRAINT cs_transactions_type_check CHECK (
    type = ANY (ARRAY[
      'BUY','SELL','TRANSFER',
      'TRANSFER_OUT','TRANSFER_IN',
      'SWAP_IN','SWAP_OUT',
      'AIRDROP','STAKING'
    ])
  )
);

-- ============================================================
-- TABLE: cs_simulations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cs_simulations (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID    NOT NULL REFERENCES public.cs_users(id) ON DELETE CASCADE,
  coin_id             UUID    NOT NULL REFERENCES public.cs_coins(id),
  quantity            NUMERIC NOT NULL,
  purchase_price_cad  NUMERIC NOT NULL,
  fees_cad            NUMERIC NOT NULL DEFAULT 0,
  forecasted_profit   NUMERIC NOT NULL,
  required_sell_price NUMERIC NOT NULL,
  cost_basis_cad      NUMERIC NOT NULL,
  gross_proceeds_cad  NUMERIC NOT NULL,
  sell_fees_cad       NUMERIC NOT NULL,
  gross_profit_cad    NUMERIC NOT NULL,
  net_profit_cad      NUMERIC NOT NULL,
  label               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES (performance)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sessions_token       ON public.cs_sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id     ON public.cs_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.cs_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_coin_id ON public.cs_transactions(coin_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type    ON public.cs_transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_at      ON public.cs_transactions(transacted_at DESC);
CREATE INDEX IF NOT EXISTS idx_simulations_user_id  ON public.cs_simulations(user_id);

-- ============================================================
-- FUNCTION: set_user_password
-- Uses bcrypt (cost 12) via pgcrypto
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_user_password(
  p_user_id UUID,
  p_password TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.cs_users
  SET password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 12))
  WHERE id = p_user_id;
END;
$$;

-- ============================================================
-- FUNCTION: verify_user_password
-- Returns user row if credentials match
-- ============================================================
CREATE OR REPLACE FUNCTION public.verify_user_password(
  p_username TEXT,
  p_password TEXT
) RETURNS TABLE(id UUID, username TEXT, name TEXT, province TEXT, role TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.username, u.name, u.province, u.role
  FROM public.cs_users u
  WHERE u.username = p_username
    AND u.password_hash = extensions.crypt(p_password, u.password_hash);
END;
$$;

-- ============================================================
-- FUNCTION + TRIGGER: auto-update updated_at on cs_transactions
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_updated_at ON public.cs_transactions;
CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON public.cs_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- The Edge Function uses the service role key (bypasses RLS),
-- so RLS is defined here as a security best-practice baseline
-- but the app itself uses service role for all operations.
-- ============================================================
ALTER TABLE public.cs_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_simulations  ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (Edge Function uses this)
CREATE POLICY "service_role_all" ON public.cs_users
  USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.cs_sessions
  USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.cs_transactions
  USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.cs_simulations
  USING (true) WITH CHECK (true);

-- ============================================================
-- SEED DATA — Default Coins
-- ============================================================
INSERT INTO public.cs_coins (symbol, name, coingecko_id, icon) VALUES
  ('BTC',  'Bitcoin',   'bitcoin',         '₿'),
  ('ETH',  'Ethereum',  'ethereum',        'Ξ'),
  ('SOL',  'Solana',    'solana',          '◎'),
  ('XRP',  'XRP',       'ripple',          '✕'),
  ('ADA',  'Cardano',   'cardano',         '◆'),
  ('DOT',  'Polkadot',  'polkadot',        '●'),
  ('AVAX', 'Avalanche', 'avalanche-2',     '▲'),
  ('MATIC','Polygon',   'matic-network',   '⬡'),
  ('LINK', 'Chainlink', 'chainlink',       '⬡'),
  ('DOGE', 'Dogecoin',  'dogecoin',        'Ð'),
  ('LTC',  'Litecoin',  'litecoin',        'Ł'),
  ('UNI',  'Uniswap',   'uniswap',         '🦄')
ON CONFLICT (symbol) DO NOTHING;

-- ============================================================
-- SEED DATA — Default Providers
-- ============================================================
INSERT INTO public.cs_providers (name, type, icon) VALUES
  ('Binance',       'EXCHANGE', '⚡'),
  ('Coinbase',      'EXCHANGE', '⚡'),
  ('Kraken',        'EXCHANGE', '⚡'),
  ('Newton',        'EXCHANGE', '⚡'),
  ('Shakepay',      'EXCHANGE', '⚡'),
  ('MetaMask',      'WALLET',   '🔐'),
  ('Ledger',        'WALLET',   '🔐'),
  ('Trust Wallet',  'WALLET',   '🔐'),
  ('TD Bank',       'BANK',     '🏦'),
  ('RBC',           'BANK',     '🏦'),
  ('Scotiabank',    'BANK',     '🏦')
ON CONFLICT (name) DO NOTHING;
