-- ============================================================
-- CryptoStack v1.0 — Local PostgreSQL Schema
-- For use with the Node.js local server (server.js)
-- Password hashing is done by bcrypt in Node.js — NOT pgcrypto
-- Run this in: psql -U postgres -d cryptostack -f schema_local.sql
-- ============================================================

-- ── Tables ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cs_admin_config (
  key        TEXT        NOT NULL,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cs_admin_config_pkey PRIMARY KEY (key)
);

CREATE TABLE IF NOT EXISTS public.cs_coins (
  id           UUID        NOT NULL DEFAULT gen_random_uuid(),
  symbol       TEXT        NOT NULL,
  name         TEXT        NOT NULL,
  coingecko_id TEXT,
  icon         TEXT,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cs_coins_pkey       PRIMARY KEY (id),
  CONSTRAINT cs_coins_symbol_key UNIQUE (symbol)
);

CREATE TABLE IF NOT EXISTS public.cs_providers (
  id         UUID        NOT NULL DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  type       TEXT        NOT NULL,
  icon       TEXT,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cs_providers_pkey       PRIMARY KEY (id),
  CONSTRAINT cs_providers_name_key   UNIQUE (name),
  CONSTRAINT cs_providers_type_check CHECK (type = ANY (ARRAY['EXCHANGE','WALLET','BANK']))
);

-- NOTE: password_hash stores bcrypt hashes (handled by Node.js, not pgcrypto)
CREATE TABLE IF NOT EXISTS public.cs_users (
  id            UUID        NOT NULL DEFAULT gen_random_uuid(),
  username      TEXT        NOT NULL,
  name          TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,
  province      TEXT        NOT NULL DEFAULT 'AB',
  role          TEXT        NOT NULL DEFAULT 'user',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  CONSTRAINT cs_users_pkey         PRIMARY KEY (id),
  CONSTRAINT cs_users_username_key UNIQUE (username),
  CONSTRAINT cs_users_role_check   CHECK (role = ANY (ARRAY['user','admin']))
);

CREATE TABLE IF NOT EXISTS public.cs_sessions (
  id          UUID        NOT NULL DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL,
  token       TEXT        NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  remember_me BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  last_active TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cs_sessions_pkey      PRIMARY KEY (id),
  CONSTRAINT cs_sessions_token_key UNIQUE (token),
  CONSTRAINT cs_sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES cs_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.cs_transactions (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL,
  type                TEXT        NOT NULL,
  coin_id             UUID        NOT NULL,
  quantity            NUMERIC     NOT NULL,
  price_per_unit_cad  NUMERIC     NOT NULL,
  -- Generated columns (auto-computed by Postgres, do NOT insert into these):
  subtotal_cad        NUMERIC     GENERATED ALWAYS AS (quantity * price_per_unit_cad) STORED,
  fees_cad            NUMERIC     NOT NULL DEFAULT 0,
  total_cad           NUMERIC     GENERATED ALWAYS AS ((quantity * price_per_unit_cad) + fees_cad) STORED,
  from_provider_id    UUID,
  to_provider_id      UUID,
  transacted_at       TIMESTAMPTZ NOT NULL,
  acb_per_unit_before NUMERIC,
  acb_per_unit_after  NUMERIC,
  capital_gain_cad    NUMERIC,
  is_taxable          BOOLEAN     NOT NULL DEFAULT false,
  superficial_loss    BOOLEAN     NOT NULL DEFAULT false,
  tx_hash             TEXT,
  notes               TEXT,
  compliance_note     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  transfer_group_id   UUID,
  transfer_role       TEXT,
  fee_treatment       TEXT,
  fee_units           NUMERIC,
  fee_fmv_cad         NUMERIC,
  fee_acb_cad         NUMERIC,
  fee_gain_cad        NUMERIC,
  swap_group_id       UUID,
  swap_role           TEXT,
  external_id         TEXT,
  CONSTRAINT cs_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT cs_transactions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES cs_users(id) ON DELETE CASCADE,
  CONSTRAINT cs_transactions_coin_id_fkey
    FOREIGN KEY (coin_id) REFERENCES cs_coins(id),
  CONSTRAINT cs_transactions_from_provider_id_fkey
    FOREIGN KEY (from_provider_id) REFERENCES cs_providers(id),
  CONSTRAINT cs_transactions_to_provider_id_fkey
    FOREIGN KEY (to_provider_id) REFERENCES cs_providers(id),
  CONSTRAINT cs_transactions_type_check CHECK (
    type = ANY (ARRAY[
      'BUY','SELL','TRANSFER','TRANSFER_OUT','TRANSFER_IN',
      'SWAP_IN','SWAP_OUT','AIRDROP','STAKING'
    ])
  ),
  CONSTRAINT uq_transactions_user_external UNIQUE (user_id, external_id)
);

CREATE TABLE IF NOT EXISTS public.cs_simulations (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL,
  coin_id             UUID        NOT NULL,
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
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cs_simulations_pkey PRIMARY KEY (id),
  CONSTRAINT cs_simulations_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES cs_users(id) ON DELETE CASCADE,
  CONSTRAINT cs_simulations_coin_id_fkey
    FOREIGN KEY (coin_id) REFERENCES cs_coins(id)
);

CREATE TABLE IF NOT EXISTS public.cs_import_logs (
  id            UUID        NOT NULL DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL,
  exchange      TEXT        NOT NULL,
  filename      TEXT,
  rows_parsed   INTEGER     NOT NULL DEFAULT 0,
  rows_imported INTEGER     NOT NULL DEFAULT 0,
  rows_skipped  INTEGER     NOT NULL DEFAULT 0,
  rows_errored  INTEGER     NOT NULL DEFAULT 0,
  status        TEXT        NOT NULL DEFAULT 'complete',
  error_detail  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cs_import_logs_pkey PRIMARY KEY (id),
  CONSTRAINT cs_import_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES cs_users(id) ON DELETE CASCADE
);

-- ── Indexes ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cs_users_username    ON cs_users(username);
CREATE INDEX IF NOT EXISTS idx_cs_sessions_user_id  ON cs_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_cs_sessions_token    ON cs_sessions(token);
CREATE INDEX IF NOT EXISTS idx_cs_sessions_expires  ON cs_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_cs_tx_user_id        ON cs_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_cs_tx_user_coin      ON cs_transactions(user_id, coin_id);
CREATE INDEX IF NOT EXISTS idx_cs_tx_transacted_at  ON cs_transactions(user_id, transacted_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_group       ON cs_transactions(transfer_group_id) WHERE transfer_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_swap_group           ON cs_transactions(swap_group_id)     WHERE swap_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cs_sim_user          ON cs_simulations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_logs_user     ON cs_import_logs(user_id);

-- ── Trigger: auto-update updated_at ──────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE OR REPLACE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON cs_transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Done ─────────────────────────────────────────────────────────────
-- Next steps:
--   1. Run: node server.js  (in the project folder)
--   2. Open: frontend/cryptostack-mobile.html in Firefox
--   3. Sign up, then in psql run:
--        UPDATE cs_users SET role='admin' WHERE username='your_username';
--        INSERT INTO cs_admin_config (key,value) VALUES ('admin_2fa_code','123456');
