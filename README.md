# CryptoStack — Local Setup & Deployment Guide

## What's in this package

```
cryptostack-deploy/
├── database/
│   └── schema.sql          ← Complete DB schema (tables, indexes, functions, triggers)
├── edge-function/
│   └── index.ts            ← Supabase Edge Function (Deno / TypeScript)
├── frontend/
│   └── cryptostack-mobile.html  ← The entire app (single HTML file)
├── scripts/
│   └── deploy-edge-function.sh  ← Helper script to deploy the edge function
└── README.md               ← This file
```

---

## Prerequisites

- [Supabase account](https://supabase.com) (free tier works)
- [Supabase CLI](https://supabase.com/docs/guides/cli) installed  
  `npm install -g supabase`  
  OR  `brew install supabase/tap/supabase`
- A modern browser (Chrome, Firefox, Safari, Edge)

---

## Step 1 — Create a new Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Choose a name (e.g. `cryptostack`), a strong DB password, and your nearest region
3. Wait ~2 minutes for the project to initialise
4. Note your:
   - **Project URL** → looks like `https://xxxxxxxxxxxx.supabase.co`
   - **Anon / public key** → Settings → API → `anon` `public`
   - **Service role key** → Settings → API → `service_role` *(keep secret!)*

---

## Step 2 — Apply the database schema

1. In the Supabase dashboard, go to **SQL Editor**
2. Click **New query**
3. Paste the entire contents of `database/schema.sql`
4. Click **Run**

You should see all tables created with no errors.

---

## Step 3 — Deploy the Edge Function

### Option A — Supabase CLI (recommended)

```bash
# Login
supabase login

# Link to your project (get project-ref from the URL: xxxxxxxxxxxx.supabase.co)
supabase link --project-ref YOUR_PROJECT_REF

# Deploy
supabase functions deploy auth --no-verify-jwt \
  --project-ref YOUR_PROJECT_REF \
  < edge-function/index.ts
```

### Option B — Manual via Dashboard

1. In the Supabase dashboard → **Edge Functions** → **New Function**
2. Name it exactly `auth`
3. Paste the contents of `edge-function/index.ts`
4. Toggle **"Verify JWT"** to **OFF** (the function has its own auth)
5. Click **Deploy**

---

## Step 4 — Configure the frontend

Open `frontend/cryptostack-mobile.html` in any text editor and update these two lines near the top of the `<script>` block:

```javascript
const SUPABASE_URL  = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_ANON = 'YOUR_ANON_PUBLIC_KEY';
```

Replace with your actual values from Step 1.

---

## Step 5 — Create your admin account

1. Open `frontend/cryptostack-mobile.html` directly in your browser (just double-click it — no server needed)
2. Click **Sign Up** and create your first account
3. In the Supabase SQL Editor, promote it to admin:

```sql
UPDATE public.cs_users
SET role = 'admin'
WHERE username = 'your_username_here';
```

4. Set an admin 2FA code (required for admin login):

```sql
INSERT INTO public.cs_admin_config (key, value)
VALUES ('admin_2fa_code', '123456')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

5. Log in using your admin username, password, and the 2FA code

---

## Step 6 — Seed coins and providers (via Admin panel)

Once logged in as admin:

1. Go to **Admin → Coin Management** → Add your coins (BTC, ETH, SOL, etc.)
2. Go to **Admin → Provider Management** → Add your exchanges/wallets (Kraken, Coinbase, etc.)

---

## Architecture notes

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Single HTML file | Vanilla JS, no build step, runs from file:// |
| Backend API | Supabase Edge Function (Deno) | Single `auth` function, routes by `action` field |
| Database | Supabase PostgreSQL | Custom auth (not Supabase Auth), bcrypt passwords |
| Auth | Custom session tokens | `cs_sessions` table, no JWT |

### Key design decisions

- **No Supabase Auth** — custom username/password with bcrypt via `pgcrypto`
- **No build system** — the entire frontend is one self-contained HTML file
- **No ON CONFLICT upserts** — all deduplication is done in-memory in the Edge Function
- **Generated columns** — `subtotal_cad` and `total_cad` are computed by Postgres, never written directly

### Transaction types

| Type | Description |
|------|-------------|
| `BUY` | Purchase of crypto with fiat |
| `SELL` | Sale of crypto for fiat |
| `SWAP_IN` | Crypto received in a crypto-to-crypto swap |
| `SWAP_OUT` | Crypto given in a crypto-to-crypto swap |
| `TRANSFER_IN` | Crypto received from external wallet |
| `TRANSFER_OUT` | Crypto sent to external wallet |
| `STAKING` | Staking reward received |
| `AIRDROP` | Airdrop received |

---

## Moving to a different Supabase project

Just repeat Steps 2–4 with the new project's URL and keys. No data migration needed — the schema is clean.

---

## Troubleshooting

**"Cannot reach Supabase from this preview"**  
→ Open the HTML file directly in your browser (file://), not from an iframe or code editor preview.

**"Session expired or invalid"**  
→ Your session token has expired. Log in again.

**Edge Function returning 400 on import**  
→ Make sure the `auth` function is deployed with `--no-verify-jwt` (JWT verification OFF).

**Coins not showing in import dropdown**  
→ Add them via Admin → Coin Management first, then re-import.
