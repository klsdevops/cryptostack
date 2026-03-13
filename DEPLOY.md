-- ============================================================
-- CryptoStack · Step 3: Indexes & Constraints
-- Run AFTER 02_tables.sql
-- ============================================================

-- cs_users
CREATE INDEX IF NOT EXISTS idx_cs_users_username
  ON public.cs_users USING btree (username);

-- cs_sessions
CREATE INDEX IF NOT EXISTS idx_cs_sessions_user_id
  ON public.cs_sessions USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_cs_sessions_token
  ON public.cs_sessions USING btree (token);
CREATE INDEX IF NOT EXISTS idx_cs_sessions_expires
  ON public.cs_sessions USING btree (expires_at);

-- cs_transactions — performance indexes
CREATE INDEX IF NOT EXISTS idx_cs_tx_user_id
  ON public.cs_transactions USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_cs_tx_user_coin
  ON public.cs_transactions USING btree (user_id, coin_id);
CREATE INDEX IF NOT EXISTS idx_cs_tx_transacted_at
  ON public.cs_transactions USING btree (user_id, transacted_at DESC);

-- cs_transactions — partial indexes for paired records
CREATE INDEX IF NOT EXISTS idx_transfer_group
  ON public.cs_transactions USING btree (transfer_group_id)
  WHERE transfer_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_swap_group
  ON public.cs_transactions USING btree (swap_group_id)
  WHERE swap_group_id IS NOT NULL;

-- cs_transactions — unique constraint for CSV import deduplication
-- NULLs are always distinct in Postgres, so multiple NULL external_ids are allowed.
ALTER TABLE public.cs_transactions
  ADD CONSTRAINT uq_transactions_user_external UNIQUE (user_id, external_id);

-- cs_simulations
CREATE INDEX IF NOT EXISTS idx_cs_sim_user
  ON public.cs_simulations USING btree (user_id, created_at DESC);

-- cs_import_logs
CREATE INDEX IF NOT EXISTS idx_import_logs_user
  ON public.cs_import_logs USING btree (user_id);
