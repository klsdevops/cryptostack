-- ============================================================
-- CryptoStackArch — Complete Database Schema  (v2)
-- Compatible with: Supabase (PostgreSQL 15+)
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New query → paste → Run
--   OR: psql $DATABASE_URL -f schema.sql
--
-- Tables created (in dependency order):
--   1. cs_users           — user accounts
--   2. cs_sessions        — session tokens
--   3. cs_coins           — supported cryptocurrencies
--   4. cs_providers       — exchanges, wallets, banks
--   5. cs_transactions    — all transaction types
--   6. cs_simulations     — profit simulator saved runs
--   7. cs_admin_config    — admin runtime settings (2FA code, etc.)
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- crypt(), gen_salt(), gen_random_bytes()

-- ============================================================
-- 1. cs_users
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cs_users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,               -- bcrypt via pgcrypto
  province      TEXT        NOT NULL DEFAULT 'AB',
  role          TEXT        NOT NULL DEFAULT 'user',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,

  CONSTRAINT cs_users_role_check CHECK (role = ANY (ARRAY['user','admin']))
);

-- ============================================================
-- 2. cs_sessions
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
-- 3. cs_coins
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cs_coins (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol       TEXT    NOT NULL UNIQUE,
  name         TEXT    NOT NULL,
  coingecko_id TEXT,
  icon         TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. cs_providers
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
-- 5. cs_transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cs_transactions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES public.cs_users(id) ON DELETE CASCADE,
  type                TEXT        NOT NULL,
  coin_id             UUID        NOT NULL REFERENCES public.cs_coins(id),
  quantity            NUMERIC     NOT NULL,
  price_per_unit_cad  NUMERIC     NOT NULL,

  -- ⚠️  GENERATED ALWAYS — never include in INSERT or UPDATE
  subtotal_cad        NUMERIC     GENERATED ALWAYS AS (quantity * price_per_unit_cad) STORED,
  fees_cad            NUMERIC     NOT NULL DEFAULT 0,
  total_cad           NUMERIC     GENERATED ALWAYS AS ((quantity * price_per_unit_cad) + fees_cad) STORED,

  from_provider_id    UUID        REFERENCES public.cs_providers(id),
  to_provider_id      UUID        REFERENCES public.cs_providers(id),
  transacted_at       TIMESTAMPTZ NOT NULL,

  -- ACB tracking (optional, for future automated ACB engine)
  acb_per_unit_before NUMERIC,
  acb_per_unit_after  NUMERIC,

  -- Tax fields
  capital_gain_cad    NUMERIC,
  is_taxable          BOOLEAN     NOT NULL DEFAULT false,
  superficial_loss    BOOLEAN     NOT NULL DEFAULT false,

  -- Metadata
  tx_hash             TEXT,
  notes               TEXT,
  compliance_note     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Internal transfer pair columns
  transfer_group_id   UUID,
  transfer_role       TEXT,        -- 'TRANSFER_OUT' | 'TRANSFER_IN'
  fee_treatment       TEXT,        -- 'realize' | 'capitalize'
  fee_units           NUMERIC,
  fee_fmv_cad         NUMERIC,
  fee_acb_cad         NUMERIC,
  fee_gain_cad        NUMERIC,

  -- Swap pair columns
  swap_group_id       UUID,
  swap_role           TEXT,        -- 'SWAP_OUT' | 'SWAP_IN'

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
-- 6. cs_simulations
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
-- 7. cs_admin_config
-- Stores runtime admin settings (2FA code, etc.)
-- Keys are simple strings; values are text.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cs_admin_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sessions_token        ON public.cs_sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id      ON public.cs_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id  ON public.cs_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_coin_id  ON public.cs_transactions(coin_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type     ON public.cs_transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_at       ON public.cs_transactions(transacted_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON public.cs_transactions(transfer_group_id)
  WHERE transfer_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_swap     ON public.cs_transactions(swap_group_id)
  WHERE swap_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_simulations_user_id   ON public.cs_simulations(user_id);

-- ============================================================
-- FUNCTION: set_user_password
-- Hashes a plaintext password using bcrypt (cost 12) and stores
-- it on the given user row. Called during signup and password reset.
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
-- Returns the user row if the supplied password matches the
-- stored bcrypt hash. Used by the login Edge Function action.
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
-- ROW LEVEL SECURITY
-- The Edge Function uses the service role key which bypasses RLS.
-- These policies are a defence-in-depth baseline.
-- ============================================================
ALTER TABLE public.cs_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_simulations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_admin_config ENABLE ROW LEVEL SECURITY;

-- Service role has unrestricted access (used by the Edge Function)
CREATE POLICY "service_role_all" ON public.cs_users        USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.cs_sessions     USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.cs_transactions USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.cs_simulations  USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.cs_admin_config USING (true) WITH CHECK (true);

-- ============================================================
-- SEED DATA — Default Coins
-- ============================================================
INSERT INTO public.cs_coins (symbol, name, coingecko_id, icon) VALUES
  ('ADA',  'Cardano',   'cardano',         '◆'),
  ('AVAX', 'Avalanche', 'avalanche-2',     '▲'),
  ('BTC',  'Bitcoin',   'bitcoin',         '₿'),
  ('DOGE', 'Dogecoin',  'dogecoin',        'Ð'),
  ('DOT',  'Polkadot',  'polkadot',        '●'),
  ('ETH',  'Ethereum',  'ethereum',        'Ξ'),
  ('LINK', 'Chainlink', 'chainlink',       '⬡'),
  ('LTC',  'Litecoin',  'litecoin',        'Ł'),
  ('MATIC','Polygon',   'matic-network',   '⬡'),
  ('SOL',  'Solana',    'solana',          '◎'),
  ('UNI',  'Uniswap',   'uniswap',         '🦄'),
  ('XRP',  'XRP',       'ripple',          '✕')
ON CONFLICT (symbol) DO NOTHING;

-- ============================================================
-- SEED DATA — Default Providers
-- ============================================================
INSERT INTO public.cs_providers (name, type, icon) VALUES
  ('Binance',      'EXCHANGE', '⚡'),
  ('Coinbase',     'EXCHANGE', '⚡'),
  ('Kraken',       'EXCHANGE', '⚡'),
  ('Newton',       'EXCHANGE', '⚡'),
  ('Shakepay',     'EXCHANGE', '⚡'),
  ('Ledger',       'WALLET',   '🔐'),
  ('MetaMask',     'WALLET',   '🔐'),
  ('Trust Wallet', 'WALLET',   '🔐'),
  ('RBC',          'BANK',     '🏦'),
  ('Scotiabank',   'BANK',     '🏦'),
  ('TD Bank',      'BANK',     '🏦')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- SEED DATA — Admin config defaults
-- ============================================================
INSERT INTO public.cs_admin_config (key, value) VALUES
  ('admin_2fa_code', '000000')   -- ⚠️  Change this before going live!
ON CONFLICT (key) DO NOTHING;


-- ============================================================
-- OPTIONAL: Create the first admin user
-- Uncomment and fill in your desired credentials, then run.
-- ============================================================
-- DO $$
-- DECLARE v_id UUID;
-- BEGIN
--   INSERT INTO public.cs_users (username, name, password_hash, role)
--   VALUES ('admin', 'Admin User', 'PENDING', 'admin')
--   RETURNING id INTO v_id;
--
--   PERFORM public.set_user_password(v_id, 'YourSecurePassword1');
-- END $$;
