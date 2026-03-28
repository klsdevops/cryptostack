# CryptoStack v1.0 — Production Deployment

## Quick Start (5 minutes)

### 1. Create Supabase project
Go to [supabase.com](https://supabase.com) → New Project  
Note your **Project URL** and **anon key** from Settings → API

### 2. Apply database schema
SQL Editor → New query → paste `database/schema.sql` → Run

### 3. Deploy the Edge Function

**Option A — CLI:**
```bash
npm install -g supabase
supabase login
./scripts/deploy-edge-function.sh YOUR_PROJECT_REF
```

**Option B — Dashboard:**
Edge Functions → New Function → name it `auth` → paste `edge-function/index.ts`  
→ toggle **Verify JWT = OFF** → Deploy

### 4. Open the app
Double-click `frontend/cryptostack-mobile.html` in your browser  
→ tap **⚙ Configure Supabase Project**  
→ enter your Project URL + anon key → Save & Connect

### 5. Create your admin account
1. Sign up for a new account in the app
2. In Supabase SQL Editor, promote it to admin:
```sql
UPDATE cs_users SET role = 'admin' WHERE username = 'your_username';
```
3. Set your admin 2FA code:
```sql
INSERT INTO cs_admin_config (key, value) VALUES ('admin_2fa_code', '123456');
```
4. Log in via the Admin tab using username + password + 2FA code

### 6. Seed reference data
Admin panel → **Coin Management** → add BTC, ETH, SOL, etc.  
Admin panel → **Provider Management** → add Kraken, Coinbase, etc.

---

## Architecture
| Layer | Technology |
|-------|-----------|
| Frontend | Single HTML file — no build step, runs from file:// |
| API | Supabase Edge Function (Deno) — single `auth` function |
| Database | Supabase PostgreSQL — custom bcrypt auth |

## File listing
```
frontend/cryptostack-mobile.html   ← The entire application
database/schema.sql                ← Full DB schema (run once)
edge-function/index.ts             ← Backend API (deploy as 'auth')
scripts/deploy-edge-function.sh    ← CLI deploy helper
```
