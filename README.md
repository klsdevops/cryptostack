# CryptoStackArch — Local Setup Guide

A CRA-compliant crypto portfolio tracker for Canadian investors.  
Stack: **Single HTML file** (frontend) + **Supabase** (database + Edge Function backend)

---

## Project Structure

```
cryptostack/
├── cryptostack-mobile.html     ← The entire frontend app (open in any browser)
├── database/
│   └── schema.sql              ← Full DB schema + seed data (run once)
├── edge-function/
│   └── index.ts                ← Supabase Edge Function (Deno/TypeScript)
└── README.md                   ← This file
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Supabase account | Free tier works | https://supabase.com |
| Supabase CLI | Latest | https://supabase.com/docs/guides/cli |
| Deno | v1.40+ | https://deno.land (only needed for local Edge Function testing) |

---

## Step 1 — Create a Supabase Project

1. Go to https://supabase.com → **New Project**
2. Choose a name (e.g. `cryptostack`), set a strong DB password, pick your region
3. Wait ~2 minutes for the project to initialise
4. Note down your **Project URL** and **Service Role Key** from:
   `Settings → API → Project URL` and `Settings → API → service_role (secret)`

---

## Step 2 — Run the Database Schema

1. In your Supabase dashboard, go to **SQL Editor**
2. Click **New query**
3. Paste the entire contents of `database/schema.sql`
4. Click **Run** (or press Cmd/Ctrl + Enter)

This will create all tables, indexes, functions, triggers, RLS policies, and seed data.

**Tables created:**
- `cs_users` — user accounts (bcrypt passwords)
- `cs_sessions` — session tokens
- `cs_coins` — supported cryptocurrencies
- `cs_providers` — exchanges, wallets, banks
- `cs_transactions` — all transaction types (BUY, SELL, SWAP, TRANSFER, AIRDROP, STAKING)
- `cs_simulations` — profit simulator saved runs

---

## Step 3 — Deploy the Edge Function

### Option A: Via Supabase CLI (recommended)

```bash
# Install CLI
brew install supabase/tap/supabase       # macOS
# or: npm install -g supabase            # cross-platform

# Login
supabase login

# Link to your project (find your project ref in Settings → General)
supabase link --project-ref YOUR_PROJECT_REF

# Deploy the function
supabase functions deploy auth --no-verify-jwt
```

### Option B: Via Supabase Dashboard

1. Go to **Edge Functions** in your dashboard
2. Click **New Function** → name it `auth`
3. Paste the contents of `edge-function/index.ts`
4. Click **Deploy**
5. In function settings, set **Verify JWT** to **OFF**
   (the function uses its own custom session token system)

---

## Step 4 — Configure the Frontend

Open `cryptostack-mobile.html` in a text editor and find this block near the top of the `<script>` tag:

```javascript
const SUPABASE_URL      = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```

Replace the values with your project's URL and anon key from:
`Supabase Dashboard → Settings → API`

The frontend calls the Edge Function at:
```
https://YOUR_PROJECT_REF.supabase.co/functions/v1/auth
```

---

## Step 5 — Open the App

Just open `cryptostack-mobile.html` in any modern browser — no server needed.

```bash
open cryptostack-mobile.html        # macOS
start cryptostack-mobile.html       # Windows
xdg-open cryptostack-mobile.html    # Linux
```

---

## Step 6 — Create Your First Admin User

1. Open the app → tap **Admin** tab on the login screen
2. Sign in with any admin username and the 6-digit 2FA code
3. The default admin 2FA code is set in `edge-function/index.ts`:
   ```typescript
   const ADMIN_2FA = '000000';  // ← change this before going live
   ```

To create an admin user directly in the DB:

```sql
-- In Supabase SQL Editor:
INSERT INTO public.cs_users (username, name, password_hash, role)
VALUES ('admin', 'Admin User', 'PENDING', 'admin');

SELECT set_user_password(id, 'YourSecurePassword1') FROM cs_users WHERE username = 'admin';
```

---

## Environment Variables (Edge Function)

The Edge Function automatically picks up these from Supabase:

| Variable | Source |
|----------|--------|
| `SUPABASE_URL` | Auto-injected by Supabase runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected by Supabase runtime |

No manual env vars needed when deploying to Supabase.

For **local Deno testing** only, create a `.env` file:
```
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

---

## Local Edge Function Testing (Optional)

```bash
supabase start                          # starts local Supabase stack
supabase functions serve auth           # serves function at localhost:54321/functions/v1/auth
```

Update the frontend URL temporarily to `http://localhost:54321` for local testing.

---

## Security Notes

- **Change the admin 2FA code** from `000000` to something secure in `edge-function/index.ts` before going to production
- The **service role key** is only used server-side in the Edge Function — never expose it in the frontend
- The frontend only uses the **anon key** (safe to expose)
- All user passwords are hashed with **bcrypt (cost 12)** via PostgreSQL's `pgcrypto` extension
- Sessions use **random 64-character hex tokens** (256-bit entropy)

---

## Transaction Types Reference

| Type | Description | Taxable |
|------|-------------|---------|
| `BUY` | Purchase crypto | No |
| `SELL` | Dispose of crypto | Yes (capital gain) |
| `SWAP_OUT` | Swap: disposition leg | Yes (capital gain) |
| `SWAP_IN` | Swap: acquisition leg | Yes (ACB established) |
| `TRANSFER_OUT` | Internal transfer: outgoing | No (ACB preserved) |
| `TRANSFER_IN` | Internal transfer: incoming | No (ACB preserved) |
| `AIRDROP` | Received airdrop | Yes (income) |
| `STAKING` | Staking reward | Yes (income) |

---

## Database Schema Notes

### Generated Columns (never write to these)
```sql
-- In cs_transactions:
subtotal_cad  = quantity * price_per_unit_cad        -- auto-computed
total_cad     = quantity * price_per_unit_cad + fees_cad  -- auto-computed
```
Never include `subtotal_cad` or `total_cad` in INSERT or UPDATE statements — Postgres will reject it.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Failed to load transactions" | Check your Supabase URL and anon key in the HTML |
| "Unknown action" error | Redeploy the Edge Function |
| "cannot insert into generated column" | Remove `subtotal_cad`/`total_cad` from the INSERT |
| App shows blank screen | Open browser DevTools console for errors |
| CORS errors | Ensure the Edge Function has `verify_jwt: false` |
