// CryptoStack — Local Node.js Backend Server
// Replaces the Supabase Edge Function for fully local deployment
// Run with: node server.js
// Requires: npm install express pg bcrypt cors

'use strict';
const express = require('express');
const { Pool } = require('pg');
const bcrypt  = require('bcrypt');
const cors    = require('cors');
const crypto  = require('crypto');

// ── Configuration ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const DB   = {
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'cryptostack',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASS     || 'postgres',
};

const pool = new Pool(DB);
const app  = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Helpers ───────────────────────────────────────────────────────────────────
const ok   = (res, data, status = 200) => res.status(status).json(data);
const fail = (res, msg,  status = 400) => res.status(status).json({ ok: false, error: msg });

async function query(sql, params = []) {
  const client = await pool.connect();
  try   { return await client.query(sql, params); }
  finally { client.release(); }
}

async function resolveUser(token) {
  if (!token) return null;
  const r = await query(
    `SELECT s.user_id, u.id, u.username, u.name, u.province, u.role
     FROM cs_sessions s
     JOIN cs_users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > NOW()`,
    [token]
  );
  return r.rows[0] || null;
}

function extractToken(req, body) {
  const auth = req.headers.authorization || '';
  return body.token || (auth.startsWith('Bearer ') ? auth.slice(7) : null);
}

// ── Auth Handlers ─────────────────────────────────────────────────────────────

async function handleSignup(res, b) {
  const { username, name, password, province } = b;
  if (!username || username.length < 3)        return fail(res, 'Username must be at least 3 characters');
  if (!/^[a-zA-Z0-9_]+$/.test(username))       return fail(res, 'Username: letters, numbers and _ only');
  if (!name || name.trim().length < 2)          return fail(res, 'Please enter your full name');
  if (!password || password.length < 8)         return fail(res, 'Password must be at least 8 characters');
  if (!/[A-Z]/.test(password))                  return fail(res, 'Password needs at least one uppercase letter');
  if (!/[0-9]/.test(password))                  return fail(res, 'Password needs at least one number');

  const ex = await query('SELECT id FROM cs_users WHERE username=$1', [username.toLowerCase()]);
  if (ex.rows.length) return fail(res, 'Username is already taken');

  const hash = await bcrypt.hash(password, 12);
  const ins  = await query(
    `INSERT INTO cs_users (username,name,password_hash,province,role)
     VALUES ($1,$2,$3,$4,'user') RETURNING id,username,name,province,role`,
    [username.toLowerCase(), name.trim(), hash, province || 'AB']
  );
  const user = ins.rows[0];

  const sess = await query(
    `INSERT INTO cs_sessions (user_id,remember_me) VALUES ($1,false) RETURNING token,expires_at`,
    [user.id]
  );
  return ok(res, { ok: true, action: 'signup', user, session: { token: sess.rows[0].token, expiresAt: sess.rows[0].expires_at } });
}

async function handleLogin(res, b) {
  const { username, password, remember_me, twofa } = b;
  if (!username) return fail(res, 'Username is required');
  if (!password) return fail(res, 'Password is required');

  const r = await query('SELECT * FROM cs_users WHERE username=$1', [username.toLowerCase()]);
  if (!r.rows.length) return fail(res, 'Invalid username or password');
  const user = r.rows[0];

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return fail(res, 'Invalid username or password');

  if (user.role === 'admin') {
    const cfg = await query("SELECT value FROM cs_admin_config WHERE key='admin_2fa_code'");
    const code = cfg.rows[0]?.value || '000000';
    if (!twofa)       return fail(res, '2FA code is required for admin login');
    if (twofa !== code) return fail(res, 'Invalid 2FA code');
  }

  await query('UPDATE cs_users SET last_login_at=NOW() WHERE id=$1', [user.id]);
  const remMe = remember_me === 'true' || remember_me === true;
  const exp   = remMe
    ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const sess = await query(
    'INSERT INTO cs_sessions (user_id,remember_me,expires_at) VALUES ($1,$2,$3) RETURNING token,expires_at',
    [user.id, remMe, exp]
  );
  return ok(res, { ok: true, action: 'login',
    user: { id: user.id, username: user.username, name: user.name, province: user.province, role: user.role },
    session: { token: sess.rows[0].token, expiresAt: sess.rows[0].expires_at }
  });
}

async function handleVerify(res, b) {
  const { token } = b;
  if (!token) return fail(res, 'Token required', 401);
  const r = await query(
    `SELECT s.id, s.token, s.expires_at, s.remember_me,
            u.id as uid, u.username, u.name, u.province, u.role
     FROM cs_sessions s JOIN cs_users u ON u.id=s.user_id
     WHERE s.token=$1 AND s.expires_at>NOW()`, [token]
  );
  if (!r.rows.length) return fail(res, 'Session expired or invalid', 401);
  const d = r.rows[0];
  await query('UPDATE cs_sessions SET last_active=NOW() WHERE id=$1', [d.id]);
  return ok(res, { ok: true, action: 'verify',
    user: { id: d.uid, username: d.username, name: d.name, province: d.province, role: d.role },
    session: { token: d.token, expiresAt: d.expires_at, rememberMe: d.remember_me }
  });
}

async function handleLogout(res, b) {
  if (b.token) await query('DELETE FROM cs_sessions WHERE token=$1', [b.token]);
  return ok(res, { ok: true, action: 'logout' });
}

// ── Coin & Provider Handlers ──────────────────────────────────────────────────

async function handleGetCoins(res) {
  const r = await query('SELECT id,symbol,name,icon,coingecko_id FROM cs_coins WHERE is_active=true ORDER BY symbol');
  return ok(res, { ok: true, coins: r.rows });
}

async function handleAddCoin(res, b, user) {
  if (user.role !== 'admin') return fail(res, 'Admin access required', 403);
  const symbol = (b.symbol || '').trim().toUpperCase();
  const name   = (b.name   || '').trim();
  const icon   = (b.icon   || '').trim() || '●';
  const coingecko_id = (b.coingecko_id || '').trim().toLowerCase() || null;
  if (!symbol) return fail(res, 'Symbol is required');
  if (!name)   return fail(res, 'Name is required');
  if (!/^[A-Z0-9]+$/.test(symbol)) return fail(res, 'Symbol must be letters and numbers only');
  const ex = await query('SELECT id FROM cs_coins WHERE UPPER(symbol)=$1', [symbol]);
  if (ex.rows.length) return fail(res, `A coin with symbol "${symbol}" already exists`);
  const r = await query(
    'INSERT INTO cs_coins (symbol,name,coingecko_id,icon,is_active) VALUES ($1,$2,$3,$4,true) RETURNING *',
    [symbol, name, coingecko_id, icon]
  );
  return ok(res, { ok: true, action: 'add_coin', coin: r.rows[0] });
}

async function handleDeleteCoin(res, b, user) {
  if (user.role !== 'admin') return fail(res, 'Admin access required', 403);
  if (!b.coin_id) return fail(res, 'coin_id is required');
  await query('UPDATE cs_coins SET is_active=false WHERE id=$1', [b.coin_id]);
  return ok(res, { ok: true, action: 'delete_coin', coin_id: b.coin_id });
}

async function handleGetProviders(res) {
  const r = await query("SELECT id,name,type,icon FROM cs_providers WHERE is_active=true ORDER BY name");
  return ok(res, { ok: true, providers: r.rows });
}

async function handleAddProvider(res, b, user) {
  if (user.role !== 'admin') return fail(res, 'Admin access required', 403);
  const name = (b.name || '').trim(), type = (b.type || '').trim();
  if (!name) return fail(res, 'Provider name is required');
  if (!['EXCHANGE','WALLET','BANK'].includes(type)) return fail(res, 'Type must be EXCHANGE, WALLET, or BANK');
  const icon = type === 'EXCHANGE' ? '⚡' : type === 'WALLET' ? '🔐' : '🏦';
  const ex = await query('SELECT id FROM cs_providers WHERE LOWER(name)=LOWER($1)', [name]);
  if (ex.rows.length) return fail(res, `A provider named "${name}" already exists`);
  const r = await query(
    'INSERT INTO cs_providers (name,type,icon,is_active) VALUES ($1,$2,$3,true) RETURNING *',
    [name, type, icon]
  );
  return ok(res, { ok: true, action: 'add_provider', provider: r.rows[0] });
}

async function handleDeleteProvider(res, b, user) {
  if (user.role !== 'admin') return fail(res, 'Admin access required', 403);
  if (!b.provider_id) return fail(res, 'provider_id is required');
  await query('UPDATE cs_providers SET is_active=false WHERE id=$1', [b.provider_id]);
  return ok(res, { ok: true, action: 'delete_provider', provider_id: b.provider_id });
}

// ── User Management Handlers ──────────────────────────────────────────────────

async function handleGetUsers(res, user) {
  if (user.role !== 'admin') return fail(res, 'Admin access required', 403);
  const users  = await query('SELECT id,username,name,province,role,created_at,last_login_at FROM cs_users ORDER BY created_at DESC');
  const ids    = users.rows.map(u => u.id);
  if (!ids.length) return ok(res, { ok: true, action: 'get_users', users: [], total: 0 });

  const [txC, simC, sesC] = await Promise.all([
    query('SELECT user_id FROM cs_transactions WHERE user_id=ANY($1)', [ids]),
    query('SELECT user_id FROM cs_simulations  WHERE user_id=ANY($1)', [ids]),
    query('SELECT user_id FROM cs_sessions     WHERE user_id=ANY($1) AND expires_at>NOW()', [ids]),
  ]);
  const txM = {}, simM = {}, sesM = {};
  txC.rows.forEach(r  => { txM[r.user_id]  = (txM[r.user_id]  || 0) + 1; });
  simC.rows.forEach(r => { simM[r.user_id] = (simM[r.user_id] || 0) + 1; });
  sesC.rows.forEach(r => { sesM[r.user_id] = (sesM[r.user_id] || 0) + 1; });
  const enriched = users.rows.map(u => ({ ...u, tx_count: txM[u.id] || 0, sim_count: simM[u.id] || 0, active_sessions: sesM[u.id] || 0 }));
  return ok(res, { ok: true, action: 'get_users', users: enriched, total: enriched.length });
}

async function handleUpdateUser(res, b, user) {
  if (user.role !== 'admin') return fail(res, 'Admin access required', 403);
  const { target_user_id, role, new_password, name } = b;
  if (!target_user_id) return fail(res, 'target_user_id is required');
  const t = await query('SELECT id FROM cs_users WHERE id=$1', [target_user_id]);
  if (!t.rows.length) return fail(res, 'User not found', 404);
  if (role   && ['user','admin'].includes(role)) await query('UPDATE cs_users SET role=$1 WHERE id=$2',   [role, target_user_id]);
  if (name   && name.trim().length >= 2)          await query('UPDATE cs_users SET name=$1 WHERE id=$2',   [name.trim(), target_user_id]);
  if (new_password) {
    if (new_password.length < 8)   return fail(res, 'Password must be at least 8 characters');
    if (!/[A-Z]/.test(new_password)) return fail(res, 'Password needs at least one uppercase letter');
    if (!/[0-9]/.test(new_password)) return fail(res, 'Password needs at least one number');
    const hash = await bcrypt.hash(new_password, 12);
    await query('UPDATE cs_users SET password_hash=$1 WHERE id=$2', [hash, target_user_id]);
    await query('DELETE FROM cs_sessions WHERE user_id=$1', [target_user_id]);
  }
  return ok(res, { ok: true, action: 'update_user', target_user_id });
}

async function handleDeleteUser(res, b, user) {
  if (user.role !== 'admin') return fail(res, 'Admin access required', 403);
  const { target_user_id } = b;
  if (!target_user_id) return fail(res, 'target_user_id is required');
  if (target_user_id === user.id) return fail(res, 'Cannot delete your own admin account');
  await query('DELETE FROM cs_users WHERE id=$1', [target_user_id]);
  return ok(res, { ok: true, action: 'delete_user', target_user_id });
}

async function handleUpdateAdminCredentials(res, b, user) {
  if (user.role !== 'admin') return fail(res, 'Admin access required', 403);
  const { current_password, new_password, new_2fa_code } = b;
  if (!current_password) return fail(res, 'Current password is required');
  const r = await query('SELECT password_hash FROM cs_users WHERE id=$1', [user.id]);
  const match = await bcrypt.compare(current_password, r.rows[0].password_hash);
  if (!match) return fail(res, 'Current password is incorrect');
  if (new_password) {
    if (new_password.length < 8)   return fail(res, 'New password must be at least 8 characters');
    if (!/[A-Z]/.test(new_password)) return fail(res, 'New password needs at least one uppercase letter');
    if (!/[0-9]/.test(new_password)) return fail(res, 'New password needs at least one number');
    const hash = await bcrypt.hash(new_password, 12);
    await query('UPDATE cs_users SET password_hash=$1 WHERE id=$2', [hash, user.id]);
    await query('DELETE FROM cs_sessions WHERE user_id=$1 AND token!=$2', [user.id, b.token || '']);
  }
  if (new_2fa_code) {
    if (!/^\d{4,8}$/.test(new_2fa_code)) return fail(res, '2FA code must be 4-8 digits');
    await query(
      "INSERT INTO cs_admin_config (key,value,updated_at) VALUES ('admin_2fa_code',$1,NOW()) ON CONFLICT(key) DO UPDATE SET value=$1, updated_at=NOW()",
      [new_2fa_code]
    );
  }
  return ok(res, { ok: true, action: 'update_admin_credentials', password_changed: !!new_password, twofa_changed: !!new_2fa_code });
}

// ── Transaction SQL helper ────────────────────────────────────────────────────
const TX_SQL = `
  SELECT t.id,t.type,t.quantity,t.price_per_unit_cad,t.subtotal_cad,t.fees_cad,t.total_cad,
         t.transacted_at,t.tx_hash,t.notes,t.compliance_note,t.is_taxable,t.superficial_loss,
         t.capital_gain_cad,t.created_at,t.transfer_group_id,t.transfer_role,t.external_id,
         json_build_object('id',c.id,'symbol',c.symbol,'name',c.name,'icon',c.icon) AS cs_coins,
         CASE WHEN fp.id IS NOT NULL THEN json_build_object('id',fp.id,'name',fp.name,'icon',fp.icon) END AS from_provider,
         CASE WHEN tp.id IS NOT NULL THEN json_build_object('id',tp.id,'name',tp.name,'icon',tp.icon) END AS to_provider
  FROM cs_transactions t
  LEFT JOIN cs_coins     c  ON c.id  = t.coin_id
  LEFT JOIN cs_providers fp ON fp.id = t.from_provider_id
  LEFT JOIN cs_providers tp ON tp.id = t.to_provider_id`;

async function handleAddTransaction(res, b, user) {
  const { type, coin_id, quantity, price_per_unit_cad, fees_cad, from_provider_id, to_provider_id, transacted_at, tx_hash, notes } = b;
  if (!type || !coin_id || !quantity || !price_per_unit_cad || !transacted_at) return fail(res, 'Missing required fields');
  const r = await query(
    `INSERT INTO cs_transactions (user_id,type,coin_id,quantity,price_per_unit_cad,fees_cad,from_provider_id,to_provider_id,transacted_at,is_taxable,tx_hash,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [user.id, type, coin_id, parseFloat(quantity), parseFloat(price_per_unit_cad),
     parseFloat(fees_cad || '0'), from_provider_id || null, to_provider_id || null,
     transacted_at, ['SELL','SWAP_OUT','SWAP_IN'].includes(type), tx_hash || null, notes || null]
  );
  const tx = await query(TX_SQL + ' WHERE t.id=$1', [r.rows[0].id]);
  return ok(res, { ok: true, action: 'add_transaction', transaction: tx.rows[0] });
}

async function handleAddSwap(res, b, user) {
  const { transacted_at: ta, from_provider_id: fp, tx_hash: th, from_coin_id: fci,
          amount_sold: as_, from_coin_price_cad: fcp, capital_gain_cad: cg,
          to_coin_id: tci, amount_received: ar, swap_fee_cad: sfc, new_coin_acb_unit: nau,
          swap_out_notes, swap_in_notes } = b;
  if (!ta || !fci || !tci || fci === tci) return fail(res, 'Invalid swap fields');
  const sg = crypto.randomUUID();
  const o = await query(
    `INSERT INTO cs_transactions (user_id,type,coin_id,quantity,price_per_unit_cad,fees_cad,from_provider_id,to_provider_id,transacted_at,is_taxable,capital_gain_cad,tx_hash,notes)
     VALUES ($1,'SWAP_OUT',$2,$3,$4,0,$5,NULL,$6,true,$7,$8,$9) RETURNING id`,
    [user.id, fci, parseFloat(as_), parseFloat(fcp), fp || null, ta, parseFloat(cg), th || null, swap_out_notes || null]
  );
  const i = await query(
    `INSERT INTO cs_transactions (user_id,type,coin_id,quantity,price_per_unit_cad,fees_cad,from_provider_id,to_provider_id,transacted_at,is_taxable,capital_gain_cad,tx_hash,notes)
     VALUES ($1,'SWAP_IN',$2,$3,$4,$5,$6,NULL,$7,true,0,$8,$9) RETURNING id`,
    [user.id, tci, parseFloat(ar), parseFloat(nau), parseFloat(sfc || '0'), fp || null, ta, th || null, swap_in_notes || null]
  );
  const [outTx, inTx] = await Promise.all([
    query(TX_SQL + ' WHERE t.id=$1', [o.rows[0].id]),
    query(TX_SQL + ' WHERE t.id=$1', [i.rows[0].id]),
  ]);
  return ok(res, { ok: true, action: 'add_swap', swap_group_id: sg, swap_out: outTx.rows[0], swap_in: inTx.rows[0] });
}

async function handleAddTransfer(res, b, user) {
  const { coin_id: ci, from_provider_id: fp, to_provider_id: tp, transacted_at: ta,
          quantity, acb_per_unit: apu, fee_acb_cad: fac, fee_units: fu,
          fee_fmv_cad: ffc, fee_gain_cad: fgc, fee_treatment: ft, tx_hash: th,
          transfer_out_notes, transfer_in_notes } = b;
  if (!ci || !fp || !tp || !ta || fp === tp) return fail(res, 'Invalid transfer fields');
  const tg = crypto.randomUUID();
  const qty = parseFloat(quantity), facN = parseFloat(fac || '0'), fgcN = parseFloat(fgc || '0');
  const o = await query(
    `INSERT INTO cs_transactions (user_id,type,coin_id,quantity,price_per_unit_cad,fees_cad,from_provider_id,to_provider_id,transacted_at,is_taxable,tx_hash,notes,transfer_group_id,transfer_role,fee_treatment,fee_units,fee_fmv_cad,fee_acb_cad,fee_gain_cad)
     VALUES ($1,'TRANSFER_OUT',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'TRANSFER_OUT',$13,$14,$15,$16,$17) RETURNING id`,
    [user.id, ci, qty, parseFloat(apu || '0'), facN, fp, tp, ta, fgcN !== 0, th || null,
     transfer_out_notes || null, tg, ft || 'realize', parseFloat(fu || '0') || null,
     parseFloat(ffc || '0') || null, facN || null, fgcN || null]
  );
  const i = await query(
    `INSERT INTO cs_transactions (user_id,type,coin_id,quantity,price_per_unit_cad,fees_cad,from_provider_id,to_provider_id,transacted_at,is_taxable,tx_hash,notes,transfer_group_id,transfer_role,fee_treatment)
     VALUES ($1,'TRANSFER_IN',$2,$3,$4,0,$5,$6,$7,false,$8,$9,$10,'TRANSFER_IN',$11) RETURNING id`,
    [user.id, ci, qty, parseFloat(apu || '0'), fp, tp, ta, th || null, transfer_in_notes || null, tg, ft || 'realize']
  );
  const [outTx, inTx] = await Promise.all([
    query(TX_SQL + ' WHERE t.id=$1', [o.rows[0].id]),
    query(TX_SQL + ' WHERE t.id=$1', [i.rows[0].id]),
  ]);
  return ok(res, { ok: true, action: 'add_transfer', transfer_group_id: tg, transfer_out: outTx.rows[0], transfer_in: inTx.rows[0] });
}

async function handleGetTransactions(res, b, user) {
  const lim = Math.min(parseInt(b.limit || '100'), 500);
  let sql = TX_SQL + ' WHERE t.user_id=$1';
  const params = [user.id];
  if (b.coin_id) { sql += ` AND t.coin_id=$${params.length + 1}`; params.push(b.coin_id); }
  sql += ' ORDER BY t.transacted_at DESC LIMIT $' + (params.length + 1);
  params.push(lim);
  const r = await query(sql, params);
  return ok(res, { ok: true, action: 'get_transactions', transactions: r.rows, count: r.rows.length });
}

async function handleDeleteTransaction(res, b, user) {
  if (!b.transaction_id) return fail(res, 'transaction_id is required');
  const ex = await query('SELECT id FROM cs_transactions WHERE id=$1 AND user_id=$2', [b.transaction_id, user.id]);
  if (!ex.rows.length) return fail(res, 'Transaction not found', 404);
  await query('DELETE FROM cs_transactions WHERE id=$1', [b.transaction_id]);
  return ok(res, { ok: true, action: 'delete_transaction', id: b.transaction_id });
}

async function handleUpdateComplianceNote(res, b, user) {
  if (!b.transaction_id) return fail(res, 'transaction_id is required');
  const ex = await query('SELECT id FROM cs_transactions WHERE id=$1 AND user_id=$2', [b.transaction_id, user.id]);
  if (!ex.rows.length) return fail(res, 'Transaction not found', 404);
  await query('UPDATE cs_transactions SET compliance_note=$1, updated_at=NOW() WHERE id=$2',
    [b.compliance_note || null, b.transaction_id]);
  return ok(res, { ok: true, action: 'update_compliance_note', transaction_id: b.transaction_id, compliance_note: b.compliance_note || null });
}

// ── Import ────────────────────────────────────────────────────────────────────

async function handleImportTransactions(res, b, user) {
  const { exchange, filename, rows } = b;
  if (!exchange) return fail(res, 'exchange is required');
  if (!rows || !Array.isArray(rows) || !rows.length) return fail(res, 'No rows to import');
  if (rows.length > 5000) return fail(res, 'Maximum 5000 rows per import');

  const [coins, providers] = await Promise.all([
    query('SELECT id,symbol FROM cs_coins WHERE is_active=true'),
    query('SELECT id,name FROM cs_providers WHERE is_active=true'),
  ]);
  const coinMap = {}, providerMap = {};
  coins.rows.forEach(c => { coinMap[c.symbol.toUpperCase()] = c.id; });
  providers.rows.forEach(p => { providerMap[p.name.toLowerCase()] = p.id; });
  const exchangeProviderId = providerMap[exchange.toLowerCase()] || null;

  // Load existing external_ids and fingerprints for dedup
  const [exRows, existingTxs] = await Promise.all([
    query('SELECT external_id FROM cs_transactions WHERE user_id=$1 AND external_id IS NOT NULL', [user.id]),
    query('SELECT t.type,t.quantity,t.price_per_unit_cad,t.subtotal_cad,t.transacted_at,c.symbol FROM cs_transactions t JOIN cs_coins c ON c.id=t.coin_id WHERE t.user_id=$1', [user.id]),
  ]);
  const seenExtIds = new Set(exRows.rows.map(r => r.external_id));
  const seenValFps = new Set(), seenQtyFps = new Set();
  existingTxs.rows.forEach(tx => {
    const sym = (tx.symbol || '').toUpperCase(), type = tx.type, qty = parseFloat(tx.quantity), date = String(tx.transacted_at || '').slice(0, 10);
    seenQtyFps.add(`${type}|${sym}|${date}|${Math.round(qty * 1e6) / 1e6}`);
    if (type === 'BUY' || type === 'SELL') {
      const sub = parseFloat(tx.subtotal_cad || (qty * parseFloat(tx.price_per_unit_cad || 0)));
      if (sub > 0) seenValFps.add(`${type}|${sym}|${date}|${Math.round(sub)}`);
    }
  });

  let imported = 0, skipped = 0, errored = 0;
  const errors = [];
  const validTypes = new Set(['BUY','SELL','SWAP_OUT','SWAP_IN','TRANSFER_OUT','TRANSFER_IN','STAKING','AIRDROP']);

  for (const row of rows) {
    try {
      const extId = row.external_id || null, txType = String(row.type || ''), sym = String(row.symbol || '').toUpperCase();
      const qty = parseFloat(row.quantity || 0), price = parseFloat(row.price_cad || 0), fees = parseFloat(row.fees_cad || '0');
      const txAt = String(row.transacted_at || ''), date = txAt.slice(0, 10);

      if (extId && seenExtIds.has(extId))                          { skipped++; continue; }
      if ((txType === 'BUY' || txType === 'SELL') && qty > 0 && price > 0) {
        if (seenValFps.has(`${txType}|${sym}|${date}|${Math.round(qty * price)}`)) { skipped++; continue; }
      }
      if (qty > 0 && seenQtyFps.has(`${txType}|${sym}|${date}|${Math.round(qty * 1e6) / 1e6}`)) { skipped++; continue; }

      const coinId = coinMap[sym];
      if (!coinId)               { errored++; errors.push(`Unknown coin: ${row.symbol}`); continue; }
      if (!qty || qty <= 0)      { errored++; errors.push(`Invalid quantity for ${sym}`); continue; }
      if (isNaN(price) || price < 0) { errored++; errors.push(`Invalid price for ${sym}`); continue; }
      if (!validTypes.has(txType))   { errored++; errors.push(`Unknown type: ${txType}`); continue; }

      await query(
        `INSERT INTO cs_transactions (user_id,type,coin_id,quantity,price_per_unit_cad,fees_cad,transacted_at,is_taxable,tx_hash,notes,from_provider_id,external_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [user.id, txType, coinId, qty, price, isNaN(fees) ? 0 : fees, txAt || null,
         ['SELL','SWAP_OUT','SWAP_IN','STAKING','AIRDROP'].includes(txType),
         (row.tx_hash && row.tx_hash !== 'null') ? row.tx_hash : null,
         row.notes || null, exchangeProviderId, extId]
      );

      if (extId) seenExtIds.add(extId);
      if ((txType === 'BUY' || txType === 'SELL') && price > 0 && qty > 0)
        seenValFps.add(`${txType}|${sym}|${date}|${Math.round(qty * price)}`);
      seenQtyFps.add(`${txType}|${sym}|${date}|${Math.round(qty * 1e6) / 1e6}`);
      imported++;
    } catch (e) { errored++; errors.push(String(e.message || e)); }
  }

  await query(
    `INSERT INTO cs_import_logs (user_id,exchange,filename,rows_parsed,rows_imported,rows_skipped,rows_errored,status,error_detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [user.id, exchange, filename || null, rows.length, imported, skipped, errored,
     imported === 0 && errored > 0 ? 'failed' : 'complete', errors.slice(0, 10).join(' | ') || null]
  );
  return ok(res, { ok: true, action: 'import_transactions', imported, skipped, errored, errors: errors.slice(0, 10), total: rows.length });
}

async function handleGetImportLogs(res, user) {
  const r = await query(
    'SELECT id,exchange,filename,rows_parsed,rows_imported,rows_skipped,rows_errored,status,created_at FROM cs_import_logs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',
    [user.id]
  );
  return ok(res, { ok: true, action: 'get_import_logs', logs: r.rows });
}

// ── Simulation Handlers ───────────────────────────────────────────────────────

async function handleSaveSimulation(res, b, user) {
  const qty = parseFloat(b.quantity), pp = parseFloat(b.purchase_price_cad);
  const fc = parseFloat(b.fees_cad || '0'), fp_ = parseFloat(b.forecasted_profit), rsp = parseFloat(b.required_sell_price);
  if (!b.coin_id || isNaN(qty) || qty <= 0 || isNaN(pp) || isNaN(fp_) || isNaN(rsp)) return fail(res, 'Invalid simulation parameters');
  const cb = qty * pp + fc, gp = qty * rsp - cb - fc;
  const r = await query(
    `INSERT INTO cs_simulations (user_id,coin_id,quantity,purchase_price_cad,fees_cad,forecasted_profit,required_sell_price,cost_basis_cad,gross_proceeds_cad,sell_fees_cad,gross_profit_cad,net_profit_cad,label)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [user.id, b.coin_id, qty, pp, fc, fp_, rsp, cb, qty * rsp, fc, gp, gp, b.label || null]
  );
  const sim = r.rows[0];
  const coin = await query('SELECT id,symbol,name,icon FROM cs_coins WHERE id=$1', [sim.coin_id]);
  sim.cs_coins = coin.rows[0];
  return ok(res, { ok: true, action: 'save_simulation', simulation: sim });
}

async function handleGetSimulations(res, b, user) {
  const lim = Math.min(parseInt(b.limit || '50'), 200);
  const r = await query(
    `SELECT s.*, json_build_object('id',c.id,'symbol',c.symbol,'name',c.name,'icon',c.icon) AS cs_coins
     FROM cs_simulations s JOIN cs_coins c ON c.id=s.coin_id
     WHERE s.user_id=$1 ORDER BY s.created_at DESC LIMIT $2`,
    [user.id, lim]
  );
  return ok(res, { ok: true, action: 'get_simulations', simulations: r.rows, count: r.rows.length });
}

async function handleDeleteSimulation(res, b, user) {
  if (!b.simulation_id) return fail(res, 'simulation_id required');
  const ex = await query('SELECT id FROM cs_simulations WHERE id=$1 AND user_id=$2', [b.simulation_id, user.id]);
  if (!ex.rows.length) return fail(res, 'Simulation not found', 404);
  await query('DELETE FROM cs_simulations WHERE id=$1', [b.simulation_id]);
  return ok(res, { ok: true, action: 'delete_simulation', id: b.simulation_id });
}

// ── Main Router ───────────────────────────────────────────────────────────────

app.post('/functions/v1/auth', async (req, res) => {
  const body  = req.body || {};
  const token = extractToken(req, body);

  // Public actions (no auth required)
  if (body.action === 'signup') return handleSignup(res, body);
  if (body.action === 'login')  return handleLogin(res, body);
  if (body.action === 'verify') return handleVerify(res, body);
  if (body.action === 'logout') return handleLogout(res, body);
  if (body.action === 'get_coins')     return handleGetCoins(res);
  if (body.action === 'get_providers') return handleGetProviders(res);

  // All other actions require a valid session
  const user = await resolveUser(token);
  if (!user) return fail(res, 'Unauthorized', 401);

  try {
    switch (body.action) {
      case 'add_coin':                 return handleAddCoin(res, body, user);
      case 'delete_coin':              return handleDeleteCoin(res, body, user);
      case 'add_provider':             return handleAddProvider(res, body, user);
      case 'delete_provider':          return handleDeleteProvider(res, body, user);
      case 'get_users':                return handleGetUsers(res, user);
      case 'update_user':              return handleUpdateUser(res, body, user);
      case 'delete_user':              return handleDeleteUser(res, body, user);
      case 'update_admin_credentials': return handleUpdateAdminCredentials(res, body, user);
      case 'add_transaction':          return handleAddTransaction(res, body, user);
      case 'add_swap':                 return handleAddSwap(res, body, user);
      case 'add_transfer':             return handleAddTransfer(res, body, user);
      case 'get_transactions':         return handleGetTransactions(res, body, user);
      case 'delete_transaction':       return handleDeleteTransaction(res, body, user);
      case 'update_compliance_note':   return handleUpdateComplianceNote(res, body, user);
      case 'import_transactions':      return handleImportTransactions(res, body, user);
      case 'get_import_logs':          return handleGetImportLogs(res, user);
      case 'save_simulation':          return handleSaveSimulation(res, body, user);
      case 'get_simulations':          return handleGetSimulations(res, body, user);
      case 'delete_simulation':        return handleDeleteSimulation(res, body, user);
      default:                         return fail(res, 'Unknown action: ' + body.action);
    }
  } catch (e) {
    console.error('Handler error:', e);
    return fail(res, 'Server error: ' + e.message, 500);
  }
});

// Health check
app.get('/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, database: 'connected', version: 'CryptoStack v1.0' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Start server
pool.connect()
  .then(client => {
    client.release();
    app.listen(PORT, () => {
      console.log('');
      console.log('  ┌─────────────────────────────────────────┐');
      console.log('  │  CryptoStack Server v1.0                │');
      console.log('  │  Running on  http://localhost:' + PORT + '       │');
      console.log('  │  Database:   ' + DB.database + ' @ ' + DB.host + ':' + DB.port + '  │');
      console.log('  └─────────────────────────────────────────┘');
      console.log('');
      console.log('  Open frontend/cryptostack-mobile.html in Firefox or Chrome');
      console.log('  Press Ctrl+C to stop');
      console.log('');
    });
  })
  .catch(e => {
    console.error('');
    console.error('  ✗ Could not connect to PostgreSQL:', e.message);
    console.error('  Check your database settings in server.js or environment variables:');
    console.error('    DB_HOST=' + DB.host + '  DB_PORT=' + DB.port + '  DB_NAME=' + DB.database);
    console.error('    DB_USER=' + DB.user + '  DB_PASS=***');
    console.error('');
    process.exit(1);
  });
