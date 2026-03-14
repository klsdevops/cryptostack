# CryptoStack — Complete Setup Guide

A Canadian crypto tax & portfolio tracking app.  
Single HTML frontend + Supabase backend (PostgreSQL + Deno Edge Functions).

---

## Repository Structure

```
cryptostack/
├── database/
│   ├── 01_extensions.sql   ← Enable pgcrypto
│   ├── 02_tables.sql       ← All 8 tables
│   ├── 03_indexes.sql      ← Performance indexes + unique constraints
│   ├── 04_functions.sql    ← Stored functions + triggers (bcrypt auth)
│   └── 05_seed_data.sql    ← Default coins, providers, admin user
├── edge-function/
│   └── index.ts            ← All API routes (Deno, deploy to Supabase)
├── frontend/
│   └── cryptostack-mobile.html  ← Complete single-file app (open in browser)
└── README.md               ← This file
```

---

## Prerequisites

- A [Supabase](https://supabase.com) account (free tier works)
- [Supabase CLI](https://supabase.com/docs/guides/cli) installed (for edge function deployment)
- A modern browser (Chrome, Firefox, Safari, Edge)

---

## Step-by-Step Setup

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Choose a name (e.g. `cryptostack`), region, and strong database password
3. Wait ~2 minutes for the project to initialize
4. Note your **Project URL** and **anon/public key** from Settings → API

---

### 2. Run the Database Migrations

Go to your Supabase project → **SQL Editor** and run each file IN ORDER:

```
01_extensions.sql   →  Enable pgcrypto
02_tables.sql       →  Create all tables
03_indexes.sql      →  Add indexes and constraints
04_functions.sql    →  Create stored functions and triggers
05_seed_data.sql    →  Insert default coins, providers, admin user
```

> **Tip:** You can paste all 5 files into the SQL Editor one at a time, or concatenate them and run at once.

> **Important:** The `05_seed_data.sql` creates an admin user with password `AdminPass1`.  
> **Change this immediately** after first login via Admin → Security Settings.

---

### 3. Deploy the Edge Function

Install the Supabase CLI if you haven't:
```bash
npm install -g supabase
```

Login and link your project:
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
# Project ref is the ID in your Supabase URL: https://YOUR_PROJECT_REF.supabase.co
```

Deploy the edge function:
```bash
cd edge-function
supabase functions deploy auth --no-verify-jwt
```

The `--no-verify-jwt` flag is required because the function implements its own session-based auth.

> **Alternative (no CLI):** You can paste the contents of `index.ts` directly into the Supabase Dashboard under **Edge Functions → New Function** named `auth`, with JWT verification disabled.

---

### 4. Configure the Frontend

Open `frontend/cryptostack-mobile.html` in a text editor and find these two lines near the top of the `<script>` section:

```javascript
const SUPABASE_URL  = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_ANON = 'YOUR_ANON_KEY_HERE';
```

Replace with your actual values from **Supabase → Settings → API**:
- **Project URL** → `SUPABASE_URL`
- **anon / public key** → `SUPABASE_ANON`

Save the file.

---

### 5. Open the App

Simply **double-click** `cryptostack-mobile.html` to open it in your browser.  
No web server needed — it's a fully self-contained single-file application.

> **Or** host it anywhere:
> - Drag into [Netlify Drop](https://app.netlify.com/drop)
> - Upload to GitHub Pages
> - Copy to any static file host

---

## First Login

Default admin credentials (from `05_seed_data.sql`):
- **Username:** `admin`
- **Password:** `AdminPass1`
- **2FA Code:** `123456`

**Change all three immediately** after first login:
- Admin → Security Settings → Change Password
- Admin → Security Settings → Change 2FA Code

---

## Database Schema Overview

| Table | Purpose |
|---|---|
| `cs_users` | User accounts (bcrypt passwords) |
| `cs_sessions` | Session tokens (cookie-less auth) |
| `cs_coins` | Supported cryptocurrencies |
| `cs_providers` | Exchanges, wallets, banks |
| `cs_transactions` | All trades, transfers, staking |
| `cs_import_logs` | CSV import history |
| `cs_simulations` | Profit simulator saved scenarios |
| `cs_admin_config` | Admin settings (2FA code, etc.) |

### Key Design Decisions

- `subtotal_cad` and `total_cad` on `cs_transactions` are **GENERATED columns** — computed automatically. Never write to them.
- Password hashing uses **bcrypt** via PostgreSQL's `pgcrypto` extension (cost factor 12).
- Sessions use random hex tokens (not JWTs) — stored in `cs_sessions`.
- CSV import deduplication uses a **3-layer fingerprint** system in the edge function.
- Transfer pairs (OUT+IN) share a `transfer_group_id`; swap pairs share a `swap_group_id`.

---

## Edge Function API Actions

The single `auth` edge function handles all API calls via `action` field:

| Action | Description |
|---|---|
| `signup` / `login` / `verify` / `logout` | Auth |
| `get_coins` / `add_coin` / `delete_coin` | Coin management |
| `get_providers` / `add_provider` / `delete_provider` | Provider management |
| `get_users` / `update_user` / `delete_user` | User management (admin) |
| `update_admin_credentials` | Change admin password/2FA |
| `add_transaction` / `add_swap` / `add_transfer` | Add transactions |
| `get_transactions` / `delete_transaction` | Ledger |
| `update_compliance_note` | Add notes to transactions |
| `import_transactions` / `get_import_logs` | CSV import |
| `save_simulation` / `get_simulations` / `delete_simulation` | Profit simulator |

---

## CSV Import Support

Supported exchanges (auto-detected by parser):
- **Kraken** — Ledger export (not Trades); groups by refid; merges partial fills
- **Coinbase** — Transaction history CSV
- **Binance** — Trade History export
- **Newton** — Trade history CSV
- **Shakepay** — Transaction history CSV
- **Generic** — Any CSV with columns: `date, type, symbol, quantity, price_cad, fees_cad, tx_hash`

---

## Raw PostgreSQL Notes (non-Supabase)

If deploying on a raw PostgreSQL instance instead of Supabase:

1. Replace `extensions.crypt(...)` → `crypt(...)` in `04_functions.sql`
2. Replace `extensions.gen_salt(...)` → `gen_salt(...)` in `04_functions.sql`
3. Run `CREATE EXTENSION IF NOT EXISTS pgcrypto;` instead of the extensions file
4. For the edge function: you can rewrite it as a Node.js/Express API using `@supabase/supabase-js` pointing at your own PostgREST instance, or replace with any backend language

---

## Security Notes

- The Supabase **anon key** in the HTML is safe to expose — it has no direct DB access. All data access goes through the authenticated edge function.
- The edge function uses the **service role key** (stored as a Supabase secret, never in the HTML) for DB access.
- All passwords are hashed with **bcrypt cost 12** — never stored in plaintext.
- Sessions expire after 24 hours (or 30 days with "Remember Me").
- Admin login requires a separate 2FA numeric code.
