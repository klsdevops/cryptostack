# CryptoStackArch — Setup Guide

A CRA-compliant crypto portfolio tracker for Canadian investors.
**Stack:** Single HTML file (frontend) + Supabase (PostgreSQL + Edge Function backend)

---

## Files

```
cryptostack/
├── cryptostack-mobile.html     ← Entire frontend — open in any browser, no build step
├── database/
│   └── schema.sql              ← Full DB schema + seed data — run once in Supabase
├── edge-function/
│   └── index.ts                ← Backend API — deploy as Supabase Edge Function (Deno)
└── README.md
```

---

## Quick Start (5 steps)

### 1 — Create a Supabase project
- Go to https://supabase.com → New Project
- Note your **Project URL** and **anon key** from Settings → API
- Note your **Service Role key** (secret) — needed for the Edge Function

### 2 — Run the database schema
- Supabase Dashboard → SQL Editor → New query
- Paste the full contents of `database/schema.sql` → Run
- This creates all 7 tables, indexes, functions, RLS policies, and seeds default coins/providers

### 3 — Deploy the Edge Function
**Via Supabase CLI (recommended):**
```bash
npm install -g supabase          # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy auth --no-verify-jwt
```

**Via Dashboard:**
- Edge Functions → New Function → name it `auth`
- Paste contents of `edge-function/index.ts` → Deploy
- In function settings → set **Verify JWT = OFF**

### 4 — Configure the frontend
Open `cryptostack-mobile.html` in a text editor and find near the top of the `<script>` tag:
```javascript
const SUPABASE_URL      = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```
Replace with your values from Supabase → Settings → API.

### 5 — Open the app
```bash
open cryptostack-mobile.html      # macOS
start cryptostack-mobile.html     # Windows
xdg-open cryptostack-mobile.html  # Linux
```
No server, no npm install, no build — just open the file.

---

## Create the first Admin user

**Option A — SQL Editor:**
```sql
DO $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.cs_users (username, name, password_hash, role)
  VALUES ('admin', 'Admin User', 'PENDING', 'admin')
  RETURNING id INTO v_id;
  PERFORM public.set_user_password(v_id, 'YourSecurePassword1');
END $$;
```

**Option B — App UI:**
- Open the app → Login screen → Admin tab
- Sign up with any username, then update role to 'admin' via the SQL editor above
- Default 2FA code is `000000` — change it in Admin → Admin Security after first login

---

## Security checklist before going live

| Item | Where |
|------|-------|
| Change default 2FA code (`000000`) | Admin panel → Admin Security |
| Change admin password | Admin panel → Admin Security |
| Never expose Service Role key in frontend | The HTML only uses the anon key ✓ |
| Review RLS policies | Supabase → Auth → Policies |

---

## Edge Function — All Actions

| Action | Auth required | Role |
|--------|--------------|------|
| `signup` | No | — |
| `login` | No | — |
| `verify` | Token | any |
| `logout` | Token | any |
| `get_coins` | No | — |
| `add_coin` | Token | admin |
| `delete_coin` | Token | admin |
| `get_providers` | No | — |
| `add_provider` | Token | admin |
| `delete_provider` | Token | admin |
| `get_users` | Token | admin |
| `update_user` | Token | admin |
| `delete_user` | Token | admin |
| `update_admin_credentials` | Token | admin |
| `add_transaction` | Token | any |
| `add_swap` | Token | any |
| `add_transfer` | Token | any |
| `get_transactions` | Token | any |
| `delete_transaction` | Token | any |
| `update_compliance_note` | Token | any |
| `save_simulation` | Token | any |
| `get_simulations` | Token | any |
| `delete_simulation` | Token | any |

---

## Transaction Types

| Type | Description | Taxable (CRA) |
|------|-------------|--------------|
| `BUY` | Purchase crypto | No |
| `SELL` | Dispose of crypto | Yes — capital gain |
| `SWAP_OUT` | Crypto-to-crypto swap: disposition leg | Yes — capital gain |
| `SWAP_IN` | Crypto-to-crypto swap: acquisition leg | Yes — ACB established |
| `TRANSFER_OUT` | Internal transfer: outgoing leg | No (ACB preserved) |
| `TRANSFER_IN` | Internal transfer: incoming leg | No (ACB preserved) |
| `AIRDROP` | Free tokens received | Yes — income |
| `STAKING` | Staking reward | Yes — income |

---

## Important: Generated Columns

`cs_transactions` has two **GENERATED ALWAYS** columns. **Never include them in INSERT or UPDATE:**
```sql
subtotal_cad  = quantity * price_per_unit_cad        -- auto-computed
total_cad     = subtotal_cad + fees_cad              -- auto-computed
```
Postgres will throw an error if you try to write to them.

---

## Local development with Supabase CLI

```bash
supabase start                    # spins up local Postgres + Edge runtime
supabase functions serve auth     # hot-reloads function at localhost:54321/functions/v1/auth
```
Temporarily update the URL in the HTML to `http://localhost:54321` for local testing.
