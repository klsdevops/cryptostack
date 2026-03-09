import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SVC_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const db = () => createClient(SUPABASE_URL, SUPABASE_SVC_KEY, { auth: { persistSession: false } });
const ok   = (data: unknown, s = 200) => new Response(JSON.stringify(data), { status: s, headers: cors });
const fail = (msg: string,  s = 400) => ok({ ok: false, error: msg }, s);

// ── Helpers ───────────────────────────────────────────────────────────
async function getAdminConfig(key: string): Promise<string | null> {
  const { data } = await db().from('cs_admin_config').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}

async function resolveUser(token?: string) {
  if (!token) return null;
  const { data } = await db()
    .from('cs_sessions')
    .select('user_id, expires_at, cs_users(id,username,name,province,role)')
    .eq('token', token).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (!data) return null;
  return data.cs_users as { id:string; username:string; name:string; province:string; role:string };
}

// ── AUTH ──────────────────────────────────────────────────────────────
async function handleSignup(b: Record<string,string>) {
  const { username, name, password, province } = b;
  if (!username || username.length < 3)    return fail('Username must be at least 3 characters');
  if (!/^[a-zA-Z0-9_]+$/.test(username))  return fail('Username: letters, numbers and _ only');
  if (!name || name.trim().length < 2)     return fail('Please enter your full name');
  if (!password || password.length < 8)    return fail('Password must be at least 8 characters');
  if (!/[A-Z]/.test(password))            return fail('Password needs at least one uppercase letter');
  if (!/[0-9]/.test(password))            return fail('Password needs at least one number');
  const d = db();
  const { data: ex } = await d.from('cs_users').select('id').eq('username', username.toLowerCase()).maybeSingle();
  if (ex) return fail('Username is already taken');
  const { data: user, error } = await d.from('cs_users')
    .insert({ username: username.toLowerCase(), name: name.trim(), password_hash: 'PENDING', province: province||'AB', role: 'user' })
    .select('id,username,name,province,role').single();
  if (error) return fail('Signup failed: ' + error.message);
  const { error: he } = await d.rpc('set_user_password', { p_user_id: user.id, p_password: password });
  if (he) { await d.from('cs_users').delete().eq('id', user.id); return fail('Password error: ' + he.message); }
  const { data: sess, error: se } = await d.from('cs_sessions')
    .insert({ user_id: user.id, remember_me: false }).select('token,expires_at').single();
  if (se) return fail('Session error');
  return ok({ ok:true, action:'signup', user:{ id:user.id, username:user.username, name:user.name, province:user.province, role:user.role }, session:{ token:sess.token, expiresAt:sess.expires_at } });
}

async function handleLogin(b: Record<string,string>) {
  const { username, password, remember_me, twofa } = b;
  if (!username) return fail('Username is required');
  if (!password) return fail('Password is required');
  const d = db();
  const { data, error } = await d.rpc('verify_user_password', { p_username: username.toLowerCase(), p_password: password });
  if (error || !data || data.length === 0) return fail('Invalid username or password');
  const user = data[0];
  if (user.role === 'admin') {
    const adminCode = await getAdminConfig('admin_2fa_code') ?? '000000';
    if (!twofa) return fail('2FA code is required for admin login');
    if (twofa !== adminCode) return fail('Invalid 2FA code');
  }
  await d.from('cs_users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);
  const remMe = remember_me === 'true' || remember_me === true as unknown as string;
  const exp = remMe ? new Date(Date.now()+30*24*60*60*1000).toISOString() : new Date(Date.now()+24*60*60*1000).toISOString();
  const { data: sess, error: se } = await d.from('cs_sessions')
    .insert({ user_id: user.id, remember_me: remMe, expires_at: exp }).select('token,expires_at').single();
  if (se) return fail('Session error');
  return ok({ ok:true, action:'login', user:{ id:user.id, username:user.username, name:user.name, province:user.province, role:user.role }, session:{ token:sess.token, expiresAt:sess.expires_at } });
}

async function handleVerify(b: Record<string,string>) {
  const { token } = b;
  if (!token) return fail('Token required', 401);
  const d = db();
  const { data, error } = await d.from('cs_sessions')
    .select('id,token,expires_at,remember_me,cs_users(id,username,name,province,role)')
    .eq('token', token).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (error || !data) return fail('Session expired or invalid', 401);
  await d.from('cs_sessions').update({ last_active: new Date().toISOString() }).eq('id', data.id);
  const u = data.cs_users as { id:string; username:string; name:string; province:string; role:string };
  return ok({ ok:true, action:'verify', user:{ id:u.id, username:u.username, name:u.name, province:u.province, role:u.role }, session:{ token:data.token, expiresAt:data.expires_at, rememberMe:data.remember_me } });
}

async function handleLogout(b: Record<string,string>) {
  const { token } = b;
  if (token) await db().from('cs_sessions').delete().eq('token', token);
  return ok({ ok:true, action:'logout' });
}

// ── COINS ─────────────────────────────────────────────────────────────
async function handleGetCoins() {
  const { data, error } = await db().from('cs_coins').select('id,symbol,name,icon,coingecko_id').eq('is_active',true).order('symbol');
  if (error) return fail('Failed to load coins');
  return ok({ ok:true, coins: data });
}

async function handleAddCoin(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token);
  if (!user) return fail('Unauthorized', 401);
  if (user.role !== 'admin') return fail('Admin access required', 403);
  const symbol       = ((b.symbol       as string) || '').trim().toUpperCase();
  const name         = ((b.name         as string) || '').trim();
  const coingecko_id = ((b.coingecko_id as string) || '').trim().toLowerCase() || null;
  const icon         = ((b.icon         as string) || '').trim() || '●';
  if (!symbol) return fail('Symbol is required');
  if (!name)   return fail('Name is required');
  if (!/^[A-Z0-9]+$/.test(symbol)) return fail('Symbol must be letters and numbers only');
  const { data: existing } = await db().from('cs_coins').select('id').ilike('symbol', symbol).maybeSingle();
  if (existing) return fail(`A coin with symbol "${symbol}" already exists`);
  const { data, error } = await db().from('cs_coins')
    .insert({ symbol, name, coingecko_id, icon, is_active: true })
    .select('id,symbol,name,icon,coingecko_id,is_active').single();
  if (error) return fail('Failed to add coin: ' + error.message);
  return ok({ ok:true, action:'add_coin', coin: data });
}

async function handleDeleteCoin(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token);
  if (!user) return fail('Unauthorized', 401);
  if (user.role !== 'admin') return fail('Admin access required', 403);
  const coin_id = b.coin_id as string;
  if (!coin_id) return fail('coin_id is required');
  const { data: existing } = await db().from('cs_coins').select('id').eq('id', coin_id).maybeSingle();
  if (!existing) return fail('Coin not found', 404);
  const { error } = await db().from('cs_coins').update({ is_active: false }).eq('id', coin_id);
  if (error) return fail('Failed to remove coin: ' + error.message);
  return ok({ ok:true, action:'delete_coin', coin_id });
}

// ── PROVIDERS ─────────────────────────────────────────────────────────
async function handleGetProviders() {
  const { data, error } = await db().from('cs_providers').select('id,name,type,icon').eq('is_active',true).order('name');
  if (error) return fail('Failed to load providers');
  return ok({ ok:true, providers: data });
}

async function handleAddProvider(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token);
  if (!user) return fail('Unauthorized', 401);
  if (user.role !== 'admin') return fail('Admin access required', 403);
  const name = (b.name as string || '').trim();
  const type = (b.type as string || '').trim();
  if (!name) return fail('Provider name is required');
  if (!['EXCHANGE','WALLET','BANK'].includes(type)) return fail('Type must be EXCHANGE, WALLET, or BANK');
  const icon = type === 'EXCHANGE' ? '⚡' : type === 'WALLET' ? '🔐' : '🏦';
  const { data: existing } = await db().from('cs_providers').select('id').ilike('name', name).maybeSingle();
  if (existing) return fail(`A provider named "${name}" already exists`);
  const { data, error } = await db().from('cs_providers')
    .insert({ name, type, icon, is_active: true })
    .select('id,name,type,icon,is_active').single();
  if (error) return fail('Failed to add provider: ' + error.message);
  return ok({ ok:true, action:'add_provider', provider: data });
}

async function handleDeleteProvider(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token);
  if (!user) return fail('Unauthorized', 401);
  if (user.role !== 'admin') return fail('Admin access required', 403);
  const provider_id = b.provider_id as string;
  if (!provider_id) return fail('provider_id is required');
  const { data: existing } = await db().from('cs_providers').select('id').eq('id', provider_id).maybeSingle();
  if (!existing) return fail('Provider not found', 404);
  const { error } = await db().from('cs_providers').update({ is_active: false }).eq('id', provider_id);
  if (error) return fail('Failed to remove provider: ' + error.message);
  return ok({ ok:true, action:'delete_provider', provider_id });
}

// ── USER MANAGEMENT (admin only) ──────────────────────────────────────
async function handleGetUsers(token?: string) {
  const user = await resolveUser(token);
  if (!user) return fail('Unauthorized', 401);
  if (user.role !== 'admin') return fail('Admin access required', 403);
  const d = db();
  const { data: users, error } = await d
    .from('cs_users')
    .select('id,username,name,province,role,created_at,last_login_at')
    .order('created_at', { ascending: false });
  if (error) return fail('Failed to load users: ' + error.message);
  const ids = (users || []).map((u: Record<string,string>) => u.id);
  const { data: txCounts }   = await d.from('cs_transactions').select('user_id').in('user_id', ids);
  const { data: simCounts }  = await d.from('cs_simulations').select('user_id').in('user_id', ids);
  const { data: sessCounts } = await d.from('cs_sessions').select('user_id')
    .gt('expires_at', new Date().toISOString()).in('user_id', ids);
  const txMap: Record<string,number>   = {};
  const simMap: Record<string,number>  = {};
  const sessMap: Record<string,number> = {};
  (txCounts   || []).forEach((r: Record<string,string>) => { txMap[r.user_id]   = (txMap[r.user_id]   || 0) + 1; });
  (simCounts  || []).forEach((r: Record<string,string>) => { simMap[r.user_id]  = (simMap[r.user_id]  || 0) + 1; });
  (sessCounts || []).forEach((r: Record<string,string>) => { sessMap[r.user_id] = (sessMap[r.user_id] || 0) + 1; });
  const enriched = (users || []).map((u: Record<string,string>) => ({
    ...u,
    tx_count:        txMap[u.id]   || 0,
    sim_count:       simMap[u.id]  || 0,
    active_sessions: sessMap[u.id] || 0,
  }));
  return ok({ ok:true, action:'get_users', users: enriched, total: enriched.length });
}

async function handleUpdateUser(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token);
  if (!user) return fail('Unauthorized', 401);
  if (user.role !== 'admin') return fail('Admin access required', 403);
  const { target_user_id, role, new_password, name } = b as Record<string,string>;
  if (!target_user_id) return fail('target_user_id is required');
  const { data: target } = await db().from('cs_users').select('id,role').eq('id', target_user_id).maybeSingle();
  if (!target) return fail('User not found', 404);
  const d = db();
  const updates: Record<string,string> = {};
  if (role && ['user','admin'].includes(role)) updates.role = role;
  if (name && name.trim().length >= 2) updates.name = name.trim();
  if (Object.keys(updates).length > 0) {
    const { error } = await d.from('cs_users').update(updates).eq('id', target_user_id);
    if (error) return fail('Failed to update user: ' + error.message);
  }
  if (new_password) {
    if (new_password.length < 8)     return fail('Password must be at least 8 characters');
    if (!/[A-Z]/.test(new_password)) return fail('Password needs at least one uppercase letter');
    if (!/[0-9]/.test(new_password)) return fail('Password needs at least one number');
    const { error: he } = await d.rpc('set_user_password', { p_user_id: target_user_id, p_password: new_password });
    if (he) return fail('Failed to reset password: ' + he.message);
    await d.from('cs_sessions').delete().eq('user_id', target_user_id);
  }
  return ok({ ok:true, action:'update_user', target_user_id });
}

async function handleDeleteUser(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token);
  if (!user) return fail('Unauthorized', 401);
  if (user.role !== 'admin') return fail('Admin access required', 403);
  const { target_user_id } = b as Record<string,string>;
  if (!target_user_id) return fail('target_user_id is required');
  if (target_user_id === user.id) return fail('Cannot delete your own admin account');
  const { data: target } = await db().from('cs_users').select('id').eq('id', target_user_id).maybeSingle();
  if (!target) return fail('User not found', 404);
  const { error } = await db().from('cs_users').delete().eq('id', target_user_id);
  if (error) return fail('Failed to delete user: ' + error.message);
  return ok({ ok:true, action:'delete_user', target_user_id });
}

async function handleUpdateAdminCredentials(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token);
  if (!user) return fail('Unauthorized', 401);
  if (user.role !== 'admin') return fail('Admin access required', 403);
  const { current_password, new_password, new_2fa_code } = b as Record<string,string>;
  if (!current_password) return fail('Current password is required');
  const d = db();
  const { data: verified } = await d.rpc('verify_user_password', { p_username: user.username, p_password: current_password });
  if (!verified || verified.length === 0) return fail('Current password is incorrect');
  if (new_password) {
    if (new_password.length < 8)     return fail('New password must be at least 8 characters');
    if (!/[A-Z]/.test(new_password)) return fail('New password needs at least one uppercase letter');
    if (!/[0-9]/.test(new_password)) return fail('New password needs at least one number');
    const { error } = await d.rpc('set_user_password', { p_user_id: user.id, p_password: new_password });
    if (error) return fail('Failed to update password: ' + error.message);
    await d.from('cs_sessions').delete().eq('user_id', user.id).neq('token', b.token as string || '');
  }
  if (new_2fa_code) {
    if (!/^\d{4,8}$/.test(new_2fa_code)) return fail('2FA code must be 4–8 digits');
    const { error } = await d.from('cs_admin_config')
      .upsert({ key: 'admin_2fa_code', value: new_2fa_code, updated_at: new Date().toISOString() });
    if (error) return fail('Failed to update 2FA code: ' + error.message);
  }
  return ok({ ok:true, action:'update_admin_credentials', password_changed: !!new_password, twofa_changed: !!new_2fa_code });
}

// ── TRANSACTIONS ──────────────────────────────────────────────────────
// ⚠️  subtotal_cad and total_cad are GENERATED ALWAYS — never include in INSERT/UPDATE
const TX_SELECT = `id,type,quantity,price_per_unit_cad,subtotal_cad,fees_cad,total_cad,
  transacted_at,tx_hash,notes,compliance_note,is_taxable,superficial_loss,
  capital_gain_cad,created_at,transfer_group_id,transfer_role,
  cs_coins(id,symbol,name,icon),
  from_provider:cs_providers!from_provider_id(id,name,icon),
  to_provider:cs_providers!to_provider_id(id,name,icon)`;

async function handleAddTransaction(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token);
  if (!user) return fail('Unauthorized', 401);
  const { type, coin_id, quantity, price_per_unit_cad, fees_cad,
          from_provider_id, to_provider_id, transacted_at, tx_hash, notes } = b as Record<string,string>;
  if (!type)               return fail('Transaction type is required');
  if (!coin_id)            return fail('Please select a coin');
  if (!quantity || isNaN(parseFloat(quantity)))                       return fail('Please enter a valid quantity');
  if (!price_per_unit_cad || isNaN(parseFloat(price_per_unit_cad))) return fail('Please enter the price per unit');
  if (!transacted_at)      return fail('Please select a date and time');
  const { data, error } = await db().from('cs_transactions').insert({
    user_id: user.id, type, coin_id,
    quantity:           parseFloat(quantity),
    price_per_unit_cad: parseFloat(price_per_unit_cad),
    fees_cad:           parseFloat(fees_cad||'0'),
    from_provider_id:   from_provider_id||null,
    to_provider_id:     to_provider_id||null,
    transacted_at,
    is_taxable: ['SELL','SWAP_OUT','SWAP_IN'].includes(type),
    tx_hash:    tx_hash||null,
    notes:      notes||null,
  }).select(TX_SELECT).single();
  if (error) return fail('Failed to save transaction: ' + error.message);
  return ok({ ok:true, action:'add_transaction', transaction: data });
}

async function handleAddSwap(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token);
  if (!user) return fail('Unauthorized', 401);
  const transacted_at    = b.transacted_at      as string;
  const from_provider_id = (b.from_provider_id  as string) || null;
  const tx_hash          = (b.tx_hash           as string) || null;
  const from_coin_id     = b.from_coin_id       as string;
  const amount_sold      = parseFloat(b.amount_sold        as string);
  const acb_per_unit     = parseFloat(b.acb_per_unit       as string);
  const from_coin_price  = parseFloat(b.from_coin_price_cad as string);
  const capital_gain_cad = parseFloat(b.capital_gain_cad   as string);
  const swap_out_notes   = (b.swap_out_notes    as string) || null;
  const to_coin_id       = b.to_coin_id         as string;
  const amount_received  = parseFloat(b.amount_received    as string);
  const swap_fee_cad     = parseFloat(b.swap_fee_cad       as string || '0');
  const new_coin_acb_unit= parseFloat(b.new_coin_acb_unit  as string);
  const swap_in_notes    = (b.swap_in_notes     as string) || null;
  if (!transacted_at)                                 return fail('transacted_at is required');
  if (!from_coin_id)                                  return fail('from_coin_id is required');
  if (!to_coin_id)                                    return fail('to_coin_id is required');
  if (from_coin_id === to_coin_id)                    return fail('From and To coins must be different');
  if (isNaN(amount_sold)    || amount_sold    <= 0)   return fail('amount_sold must be > 0');
  if (isNaN(amount_received)|| amount_received <= 0)  return fail('amount_received must be > 0');
  if (isNaN(acb_per_unit)   || acb_per_unit   <= 0)   return fail('acb_per_unit must be > 0');
  if (isNaN(from_coin_price)|| from_coin_price <= 0)  return fail('from_coin_price_cad must be > 0');
  const swap_group_id = crypto.randomUUID();
  const d = db();
  const { data: outTx, error: outErr } = await d.from('cs_transactions').insert({
    user_id: user.id, type: 'SWAP_OUT', coin_id: from_coin_id,
    quantity: amount_sold, price_per_unit_cad: from_coin_price, fees_cad: 0,
    from_provider_id, to_provider_id: null, transacted_at,
    is_taxable: true, capital_gain_cad, tx_hash, notes: swap_out_notes,
  }).select(TX_SELECT).single();
  if (outErr) return fail('Failed to save swap (OUT leg): ' + outErr.message);
  const { data: inTx, error: inErr } = await d.from('cs_transactions').insert({
    user_id: user.id, type: 'SWAP_IN', coin_id: to_coin_id,
    quantity: amount_received, price_per_unit_cad: new_coin_acb_unit,
    fees_cad: isNaN(swap_fee_cad) ? 0 : swap_fee_cad,
    from_provider_id, to_provider_id: null, transacted_at,
    is_taxable: true, capital_gain_cad: 0, tx_hash, notes: swap_in_notes,
  }).select(TX_SELECT).single();
  if (inErr) {
    await d.from('cs_transactions').delete().eq('id', outTx.id);
    return fail('Failed to save swap (IN leg): ' + inErr.message);
  }
  return ok({ ok:true, action:'add_swap', swap_group_id, swap_out: outTx, swap_in: inTx });
}

async function handleAddTransfer(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token);
  if (!user) return fail('Unauthorized', 401);
  const coin_id            = b.coin_id           as string;
  const from_provider_id   = b.from_provider_id  as string;
  const to_provider_id     = b.to_provider_id    as string;
  const transacted_at      = b.transacted_at     as string;
  const quantity           = parseFloat(b.quantity         as string);
  const acb_per_unit       = parseFloat(b.acb_per_unit     as string || '0');
  const fee_acb_cad        = parseFloat(b.fee_acb_cad      as string || '0');
  const fee_units          = parseFloat(b.fee_units        as string || '0');
  const fee_fmv_cad        = parseFloat(b.fee_fmv_cad      as string || '0');
  const fee_gain_cad       = parseFloat(b.fee_gain_cad     as string || '0');
  const fee_treatment      = (b.fee_treatment   as string) || 'realize';
  const tx_hash            = (b.tx_hash         as string) || null;
  const transfer_out_notes = (b.transfer_out_notes as string) || null;
  const transfer_in_notes  = (b.transfer_in_notes  as string) || null;
  if (!coin_id)          return fail('coin_id is required');
  if (!from_provider_id) return fail('from_provider_id is required');
  if (!to_provider_id)   return fail('to_provider_id is required');
  if (!transacted_at)    return fail('transacted_at is required');
  if (isNaN(quantity) || quantity <= 0) return fail('quantity must be > 0');
  if (from_provider_id === to_provider_id) return fail('Source and destination must differ');
  const transfer_group_id = crypto.randomUUID();
  const d = db();
  const { data: outTx, error: outErr } = await d.from('cs_transactions').insert({
    user_id: user.id, type: 'TRANSFER_OUT', coin_id, quantity,
    price_per_unit_cad: acb_per_unit, fees_cad: isNaN(fee_acb_cad) ? 0 : fee_acb_cad,
    from_provider_id, to_provider_id, transacted_at,
    is_taxable: fee_gain_cad !== 0, tx_hash: tx_hash || null, notes: transfer_out_notes,
    transfer_group_id, transfer_role: 'TRANSFER_OUT', fee_treatment,
    fee_units: fee_units || null, fee_fmv_cad: fee_fmv_cad || null,
    fee_acb_cad: fee_acb_cad || null, fee_gain_cad: fee_gain_cad || null,
  }).select(TX_SELECT).single();
  if (outErr) return fail('Failed to save transfer (OUT leg): ' + outErr.message);
  const { data: inTx, error: inErr } = await d.from('cs_transactions').insert({
    user_id: user.id, type: 'TRANSFER_IN', coin_id, quantity,
    price_per_unit_cad: acb_per_unit, fees_cad: 0,
    from_provider_id, to_provider_id, transacted_at,
    is_taxable: false, tx_hash: tx_hash || null, notes: transfer_in_notes,
    transfer_group_id, transfer_role: 'TRANSFER_IN', fee_treatment,
    fee_units: null, fee_fmv_cad: null, fee_acb_cad: null, fee_gain_cad: null,
  }).select(TX_SELECT).single();
  if (inErr) {
    await d.from('cs_transactions').delete().eq('id', outTx.id);
    return fail('Failed to save transfer (IN leg): ' + inErr.message);
  }
  return ok({ ok:true, action:'add_transfer', transfer_group_id, transfer_out: outTx, transfer_in: inTx });
}

async function handleGetTransactions(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token);
  if (!user) return fail('Unauthorized', 401);
  const coin_id = b.coin_id as string|undefined;
  const limit   = Math.min(parseInt(b.limit as string||'100'), 500);
  let q = db().from('cs_transactions')
    .select(TX_SELECT).eq('user_id', user.id)
    .order('transacted_at', { ascending: false }).limit(limit);
  if (coin_id) q = q.eq('coin_id', coin_id);
  const { data, error } = await q;
  if (error) return fail('Failed to load transactions: ' + error.message);
  return ok({ ok:true, action:'get_transactions', transactions: data??[], count:(data??[]).length });
}

async function handleDeleteTransaction(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token);
  if (!user) return fail('Unauthorized', 401);
  const { transaction_id } = b as Record<string,string>;
  if (!transaction_id) return fail('transaction_id is required');
  const { data: ex } = await db().from('cs_transactions').select('id')
    .eq('id', transaction_id).eq('user_id', user.id).maybeSingle();
  if (!ex) return fail('Transaction not found or access denied', 404);
  const { error } = await db().from('cs_transactions').delete().eq('id', transaction_id);
  if (error) return fail('Delete failed: ' + error.message);
  return ok({ ok:true, action:'delete_transaction', id: transaction_id });
}

async function handleUpdateComplianceNote(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token);
  if (!user) return fail('Unauthorized', 401);
  const { transaction_id, compliance_note } = b as Record<string,string>;
  if (!transaction_id) return fail('transaction_id is required');
  const { data: ex } = await db().from('cs_transactions').select('id')
    .eq('id', transaction_id).eq('user_id', user.id).maybeSingle();
  if (!ex) return fail('Transaction not found or access denied', 404);
  const { error } = await db().from('cs_transactions')
    .update({ compliance_note: compliance_note || null, updated_at: new Date().toISOString() })
    .eq('id', transaction_id);
  if (error) return fail('Failed to save note: ' + error.message);
  return ok({ ok:true, action:'update_compliance_note', transaction_id, compliance_note: compliance_note || null });
}

// ── SIMULATIONS ───────────────────────────────────────────────────────
async function handleSaveSimulation(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token);
  if (!user) return fail('Unauthorized', 401);
  const coin_id             = b.coin_id             as string;
  const quantity            = parseFloat(b.quantity            as string);
  const purchase_price_cad  = parseFloat(b.purchase_price_cad  as string);
  const fees_cad            = parseFloat(b.fees_cad            as string || '0');
  const forecasted_profit   = parseFloat(b.forecasted_profit   as string);
  const required_sell_price = parseFloat(b.required_sell_price as string);
  const label               = (b.label as string) || null;
  if (!coin_id)                         return fail('coin_id required');
  if (isNaN(quantity) || quantity <= 0) return fail('Invalid quantity');
  if (isNaN(purchase_price_cad))        return fail('Invalid purchase price');
  if (isNaN(forecasted_profit))         return fail('Invalid forecasted profit');
  if (isNaN(required_sell_price))       return fail('Invalid required sell price');
  const cost_basis_cad = quantity * purchase_price_cad + fees_cad;
  const sell_fees_cad  = fees_cad;
  const gross_proceeds = quantity * required_sell_price;
  const gross_profit   = gross_proceeds - cost_basis_cad - sell_fees_cad;
  const { data, error } = await db().from('cs_simulations').insert({
    user_id: user.id, coin_id, quantity, purchase_price_cad, fees_cad,
    forecasted_profit, required_sell_price, cost_basis_cad,
    gross_proceeds_cad: gross_proceeds, sell_fees_cad,
    gross_profit_cad: gross_profit, net_profit_cad: gross_profit, label,
  }).select(`id,quantity,purchase_price_cad,fees_cad,forecasted_profit,required_sell_price,
    cost_basis_cad,gross_proceeds_cad,sell_fees_cad,gross_profit_cad,net_profit_cad,
    label,created_at,cs_coins(id,symbol,name,icon)`).single();
  if (error) return fail('Failed to save simulation: ' + error.message);
  return ok({ ok:true, action:'save_simulation', simulation: data });
}

async function handleGetSimulations(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token);
  if (!user) return fail('Unauthorized', 401);
  const limit = Math.min(parseInt(b.limit as string || '50'), 200);
  const { data, error } = await db().from('cs_simulations')
    .select(`id,quantity,purchase_price_cad,fees_cad,forecasted_profit,required_sell_price,
      cost_basis_cad,gross_proceeds_cad,sell_fees_cad,gross_profit_cad,net_profit_cad,
      label,created_at,cs_coins(id,symbol,name,icon)`)
    .eq('user_id', user.id).order('created_at', { ascending: false }).limit(limit);
  if (error) return fail('Failed to load simulations: ' + error.message);
  return ok({ ok:true, action:'get_simulations', simulations: data??[], count:(data??[]).length });
}

async function handleDeleteSimulation(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token);
  if (!user) return fail('Unauthorized', 401);
  const { simulation_id } = b as Record<string,string>;
  if (!simulation_id) return fail('simulation_id required');
  const { data: ex } = await db().from('cs_simulations').select('id')
    .eq('id', simulation_id).eq('user_id', user.id).maybeSingle();
  if (!ex) return fail('Simulation not found or access denied', 404);
  const { error } = await db().from('cs_simulations').delete().eq('id', simulation_id);
  if (error) return fail('Delete failed: ' + error.message);
  return ok({ ok:true, action:'delete_simulation', id: simulation_id });
}

// ── ROUTER ────────────────────────────────────────────────────────────
// All actions listed below; auth required unless noted
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST')    return fail('Method not allowed', 405);
  let body: Record<string,unknown> = {};
  try { body = await req.json(); } catch { return fail('Invalid JSON'); }
  const authHeader  = req.headers.get('authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const token = (body.token as string) || bearerToken;
  switch (body.action) {
    // Auth (no token required)
    case 'signup':                   return handleSignup(body as Record<string,string>);
    case 'login':                    return handleLogin(body as Record<string,string>);
    case 'verify':                   return handleVerify(body as Record<string,string>);
    case 'logout':                   return handleLogout(body as Record<string,string>);
    // Reference data (no token required for get)
    case 'get_coins':                return handleGetCoins();
    case 'add_coin':                 return handleAddCoin(body, token);
    case 'delete_coin':              return handleDeleteCoin(body, token);
    case 'get_providers':            return handleGetProviders();
    case 'add_provider':             return handleAddProvider(body, token);
    case 'delete_provider':          return handleDeleteProvider(body, token);
    // User management (admin only)
    case 'get_users':                return handleGetUsers(token);
    case 'update_user':              return handleUpdateUser(body, token);
    case 'delete_user':              return handleDeleteUser(body, token);
    case 'update_admin_credentials': return handleUpdateAdminCredentials(body, token);
    // Transactions
    case 'add_transaction':          return handleAddTransaction(body, token);
    case 'add_swap':                 return handleAddSwap(body, token);
    case 'add_transfer':             return handleAddTransfer(body, token);
    case 'get_transactions':         return handleGetTransactions(body, token);
    case 'delete_transaction':       return handleDeleteTransaction(body, token);
    case 'update_compliance_note':   return handleUpdateComplianceNote(body, token);
    // Simulations
    case 'save_simulation':          return handleSaveSimulation(body, token);
    case 'get_simulations':          return handleGetSimulations(body, token);
    case 'delete_simulation':        return handleDeleteSimulation(body, token);
    default:                         return fail('Unknown action: ' + body.action);
  }
});
