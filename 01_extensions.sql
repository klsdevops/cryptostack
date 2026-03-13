-- ============================================================
-- CryptoStack · Step 5: Seed Data
-- Run AFTER 04_functions.sql
-- OPTIONAL — edit to match your own coins/providers
-- ============================================================

-- ── Default cryptocurrencies ─────────────────────────────────
INSERT INTO public.cs_coins (symbol, name, coingecko_id, icon, is_active) VALUES
  ('BTC',  'Bitcoin',        'bitcoin',          '₿',  true),
  ('ETH',  'Ethereum',       'ethereum',         'Ξ',  true),
  ('SOL',  'Solana',         'solana',           '◎',  true),
  ('ADA',  'Cardano',        'cardano',          '₳',  true),
  ('XRP',  'Ripple',         'ripple',           '✕',  true),
  ('DOT',  'Polkadot',       'polkadot',         '●',  true),
  ('LTC',  'Litecoin',       'litecoin',         'Ł',  true),
  ('LINK', 'Chainlink',      'chainlink',        '⬡',  true),
  ('DOGE', 'Dogecoin',       'dogecoin',         'Ð',  true),
  ('AVAX', 'Avalanche',      'avalanche-2',      '▲',  true),
  ('MATIC','Polygon',        'matic-network',    '⬡',  true),
  ('UNI',  'Uniswap',        'uniswap',          '🦄', true),
  ('ATOM', 'Cosmos',         'cosmos',           '⚛',  true),
  ('XLM',  'Stellar',        'stellar',          '✦',  true),
  ('ALGO', 'Algorand',       'algorand',         '◈',  true),
  ('FIL',  'Filecoin',       'filecoin',         '⬡',  true),
  ('NEAR', 'NEAR Protocol',  'near',             '●',  true),
  ('APT',  'Aptos',          'aptos',            '●',  true),
  ('ARB',  'Arbitrum',       'arbitrum',         '●',  true),
  ('OP',   'Optimism',       'optimism',         '●',  true)
ON CONFLICT (symbol) DO NOTHING;

-- ── Default providers ────────────────────────────────────────
INSERT INTO public.cs_providers (name, type, icon, is_active) VALUES
  ('Kraken',       'EXCHANGE', '⚡', true),
  ('Coinbase',     'EXCHANGE', '⚡', true),
  ('Binance',      'EXCHANGE', '⚡', true),
  ('Newton',       'EXCHANGE', '⚡', true),
  ('Shakepay',     'EXCHANGE', '⚡', true),
  ('Bitbuy',       'EXCHANGE', '⚡', true),
  ('NDAX',         'EXCHANGE', '⚡', true),
  ('Ledger',       'WALLET',   '🔐', true),
  ('Trezor',       'WALLET',   '🔐', true),
  ('MetaMask',     'WALLET',   '🔐', true),
  ('Phantom',      'WALLET',   '🔐', true),
  ('TD Bank',      'BANK',     '🏦', true),
  ('RBC',          'BANK',     '🏦', true),
  ('BMO',          'BANK',     '🏦', true),
  ('Scotiabank',   'BANK',     '🏦', true),
  ('CIBC',         'BANK',     '🏦', true)
ON CONFLICT (name) DO NOTHING;

-- ── Default admin 2FA code ───────────────────────────────────
-- IMPORTANT: Change '123456' to your own code before going live
INSERT INTO public.cs_admin_config (key, value) VALUES
  ('admin_2fa_code', '123456')
ON CONFLICT (key) DO NOTHING;

-- ── Create first admin user ──────────────────────────────────
-- Run this AFTER the functions are created (step 4).
-- Replace the values below with your own credentials.
-- The password must have 8+ chars, 1 uppercase, 1 number.
-- After running this, you MUST call set_user_password() to set the real hash:

-- Step A: Insert the admin user placeholder
INSERT INTO public.cs_users (username, name, password_hash, province, role)
VALUES ('admin', 'Admin User', 'PENDING', 'AB', 'admin')
ON CONFLICT (username) DO NOTHING;

-- Step B: Set the real bcrypt password (replace 'AdminPass1' with your chosen password)
SELECT public.set_user_password(id, 'AdminPass1')
FROM public.cs_users
WHERE username = 'admin' AND password_hash = 'PENDING';
