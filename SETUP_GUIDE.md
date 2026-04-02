# CryptoStack — Pure Local Setup Guide
# PostgreSQL + Node.js on Your Laptop (No Cloud, No Docker, No Subscription)

## What this guide sets up

```
Your Laptop
├── PostgreSQL (the database)        ← stores all your data
├── Node.js + server.js (the API)    ← replaces the Supabase Edge Function
└── cryptostack-mobile.html          ← the app (open in browser)
```

No internet required after setup. Everything runs on your machine.
Your data never leaves your laptop.

---

## Files in this package

```
cryptostack-local/
├── server.js                  ← Node.js backend server
├── package.json               ← Node.js dependencies list
├── schema_local.sql           ← PostgreSQL database schema
├── frontend/
│   └── cryptostack-mobile.html ← The app (pre-configured for localhost)
└── SETUP_GUIDE.md             ← This file
```

---

## PART 1 — Install PostgreSQL
=============================

### Windows

1. Go to: https://www.postgresql.org/download/windows/
2. Click "Download the installer" → choose the latest version (16 or 17)
3. Run the installer:
   - Accept all defaults
   - When asked for a password: set it to `postgres` (you can change this later)
   - Port: leave as `5432`
   - Click through to finish
4. When done, open the **Start Menu** → search for **pgAdmin 4** → open it
   (This is the database admin tool, installed with PostgreSQL)

### Mac

**Option A — Postgres.app (easiest):**
1. Go to: https://postgresapp.com
2. Download and drag to Applications
3. Open it → click "Initialize"
4. Click "Open psql" in the app window

**Option B — Homebrew:**
```bash
brew install postgresql@16
brew services start postgresql@16
echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### Linux (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql  # auto-start on boot
```

---

## PART 2 — Create the Database
================================

### Windows (using pgAdmin 4)

1. Open **pgAdmin 4** from the Start Menu
2. In the left panel: expand **Servers** → **PostgreSQL 16**
3. Right-click **Databases** → **Create** → **Database...**
4. Name: `cryptostack` → click **Save**
5. Click on the `cryptostack` database
6. Click **Tools** → **Query Tool**
7. Click the folder icon (or Ctrl+O) → browse to `schema_local.sql` → Open
8. Click the **▶ Run** button (or press F5)
9. You should see: "Query returned successfully"

### Mac / Linux (using the terminal)

```bash
# Create the database
createdb cryptostack

# Apply the schema (run from the folder containing schema_local.sql)
psql -U postgres -d cryptostack -f schema_local.sql

# You should see a list of CREATE TABLE, CREATE INDEX, etc.
# If you get a password prompt, enter: postgres
```

**If `createdb` says "role does not exist":**
```bash
# On Linux, switch to the postgres user first:
sudo -u postgres createdb cryptostack
sudo -u postgres psql -d cryptostack -f /path/to/schema_local.sql

# On Mac with Homebrew, use your Mac username:
createdb -U $(whoami) cryptostack
psql -U $(whoami) -d cryptostack -f schema_local.sql
```

---

## PART 3 — Install Node.js
=============================

Node.js runs the backend server that the app talks to.

### Windows / Mac
1. Go to: https://nodejs.org
2. Download the **LTS** version (e.g. 20.x LTS)
3. Run the installer → accept all defaults
4. Verify: open a new terminal/command prompt and type:
   ```
   node --version
   ```
   Should show: `v20.x.x` (or similar)

### Linux (Ubuntu/Debian)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # should show v20.x.x
```

---

## PART 4 — Configure the Database Connection
=============================================

Open `server.js` in a text editor and find this section near the top:

```javascript
const DB = {
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'cryptostack',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASS     || 'postgres',
};
```

Change the values if yours are different:
- `database`: `cryptostack` (what you named it in Part 2)
- `user`: your PostgreSQL username (usually `postgres`)
- `password`: the password you set during installation

**Alternative: use environment variables (more secure):**
```bash
# Windows (Command Prompt):
set DB_PASS=your_actual_password
node server.js

# Mac/Linux:
DB_PASS=your_actual_password node server.js
```

---

## PART 5 — Install Node.js Dependencies & Start the Server
=============================================================

Open a terminal/command prompt in the `cryptostack-local` folder:

```bash
# Navigate to the folder
# Windows:
cd C:\Users\YourName\Downloads\cryptostack-local

# Mac/Linux:
cd ~/Downloads/cryptostack-local

# Install dependencies (only needed once)
npm install

# Start the server
node server.js
```

You should see:
```
  ┌─────────────────────────────────────────┐
  │  CryptoStack Server v1.0                │
  │  Running on  http://localhost:3000       │
  │  Database:   cryptostack @ localhost:5432│
  └─────────────────────────────────────────┘

  Open frontend/cryptostack-mobile.html in Firefox or Chrome
  Press Ctrl+C to stop
```

**Leave this terminal window open while using the app.**

---

## PART 6 — Open the App
=========================

**Double-click** `frontend/cryptostack-mobile.html`

The app opens at the **Configure Supabase Project** screen.
Enter:
- **Project URL**: `http://localhost:3000`
- **Anon Key**: `local`

Click **Save & Connect** → you're taken to the login screen.

**NOTE:** For the local setup with a PostgreSQL, the above steps is not needed as its not using Supabase as the database. You can skip "**PART 6 — Open the App**" and move to the "**PART 7 — Create Your Admin Account**" step.

### Browser Notes

**Firefox:** Works perfectly out of the box. ✓

**Chrome:** May block connections to localhost from a local file.
If login fails, use one of these:

  Option A — Use Firefox (simplest)

  Option B — Serve with Python (no install on Mac/Linux):
  ```bash
  cd /path/to/cryptostack-local
  python3 -m http.server 8080
  ```
  Then open: `http://localhost:8080/frontend/cryptostack-mobile.html`

  Option C — Disable Chrome's localhost restriction:
  1. Open Chrome → go to: `chrome://flags/#block-insecure-private-network-requests`
  2. Set to **Disabled** → Relaunch

---

## PART 7 — Create Your Admin Account
=======================================

1. On the login screen, click **Sign Up**
2. Enter your username, name, and password
3. You're logged in as a regular user

**Promote to admin** — open a new terminal and run:

### Windows (pgAdmin Query Tool):
```sql
UPDATE cs_users SET role = 'admin' WHERE username = 'your_username';
INSERT INTO cs_admin_config (key, value) VALUES ('admin_2fa_code', '123456');
```

### Mac/Linux (terminal):
```bash
psql -U postgres -d cryptostack -c "UPDATE cs_users SET role='admin' WHERE username='your_username';"
psql -U postgres -d cryptostack -c "INSERT INTO cs_admin_config (key,value) VALUES ('admin_2fa_code','123456');"
```

4. Log out of the app
5. On the login screen, switch to the **Admin** tab
6. Log in with: username + password + 2FA code (`123456`)

---

## PART 8 — Add Coins and Providers
=====================================

As admin in the app:
1. **Admin → Coin Management** → Add coins:
   - BTC (Bitcoin), ETH (Ethereum), SOL (Solana), etc.
2. **Admin → Provider Management** → Add exchanges:
   - Kraken (EXCHANGE), Coinbase (EXCHANGE), Newton (EXCHANGE), etc.

---

## Daily Usage (after initial setup)
======================================

Every time you want to use the app:

**Step 1 — Start the server** (takes 2 seconds):
```bash
# Navigate to your cryptostack-local folder, then:
node server.js
```

**Step 2 — Open the HTML file** in Firefox or Chrome.

**Step 3 — Done!** Your data is waiting exactly as you left it.

To stop: press `Ctrl+C` in the terminal.

---

## Setting Up Auto-Start (Optional)
======================================

### Windows — Start with Windows

1. Press `Win+R` → type `shell:startup` → Enter
2. Create a file `start-cryptostack.bat` with this content:
   ```batch
   @echo off
   cd C:\Users\YourName\Downloads\cryptostack-local
   node server.js
   ```
3. Copy this .bat file into the Startup folder

### Mac — Using launchd

Create `~/Library/LaunchAgents/com.cryptostack.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "...">
<plist version="1.0">
<dict>
  <key>Label</key>         <string>com.cryptostack</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/YourName/cryptostack-local/server.js</string>
  </array>
  <key>RunAtLoad</key>     <true/>
  <key>WorkingDirectory</key>
  <string>/Users/YourName/cryptostack-local</string>
</dict>
</plist>
```
Then: `launchctl load ~/Library/LaunchAgents/com.cryptostack.plist`

### Linux — Using systemd

Create `/etc/systemd/system/cryptostack.service`:
```ini
[Unit]
Description=CryptoStack Local Server
After=postgresql.service

[Service]
Type=simple
User=your_username
WorkingDirectory=/home/your_username/cryptostack-local
ExecStart=/usr/bin/node server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```
Then:
```bash
sudo systemctl enable cryptostack
sudo systemctl start cryptostack
```

---

## Backing Up Your Data
=========================

Your data lives in PostgreSQL. Back it up with:

```bash
# Create a backup file:
pg_dump -U postgres cryptostack > cryptostack_backup_$(date +%Y%m%d).sql

# Restore from backup:
psql -U postgres -d cryptostack < cryptostack_backup_20260328.sql
```

---

## Accessing from Other Devices on Your Network
================================================

To use the app from a phone or another laptop on the same WiFi:

1. Find your laptop's local IP:
   - Windows: `ipconfig` → look for "IPv4 Address" (e.g. 192.168.1.50)
   - Mac: System Settings → Network → look for 192.168.x.x
   - Linux: `ip addr show` or `hostname -I`

2. Edit `server.js` — change the listen line at the bottom:
   ```javascript
   app.listen(PORT, () => {  // change to:
   app.listen(PORT, '0.0.0.0', () => {
   ```

3. Other devices open the HTML file and configure:
   - Project URL: `http://192.168.1.50:3000`  (your laptop's IP)
   - Anon key: `local`

---

## Troubleshooting
===================

| Problem | Fix |
|---------|-----|
| `npm install` fails | Make sure Node.js is installed: `node --version` |
| "password authentication failed" | Edit DB_PASS in server.js to match your PostgreSQL password |
| "database does not exist" | Run the schema again: `psql -U postgres -d cryptostack -f schema_local.sql` |
| "EADDRINUSE port 3000" | Another app uses port 3000. Edit `const PORT = 3000` in server.js to `3001` |
| App says "Cannot reach..." in Chrome | Use Firefox, or serve with `python3 -m http.server 8080` |
| Login works but data doesn't save | Check the server terminal for error messages |
| "gen_random_uuid() does not exist" | Run: `psql -U postgres -d cryptostack -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"` |
