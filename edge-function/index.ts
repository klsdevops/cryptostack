// CryptoStack Edge Function v19 — Production Build
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SVC_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const db   = () => createClient(SUPABASE_URL, SUPABASE_SVC_KEY, { auth: { persistSession: false } });
const ok   = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: cors });
const fail = (m: string,  s = 400) => ok({ ok: false, error: m }, s);

async function getAdminConfig(key: string): Promise<string | null> {
  const { data } = await db().from('cs_admin_config').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}
async function resolveUser(token?: string) {
  if (!token) return null;
  const { data } = await db().from('cs_sessions')
    .select('user_id,expires_at,cs_users(id,username,name,province,role)')
    .eq('token', token).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (!data) return null;
  return data.cs_users as { id:string; username:string; name:string; province:string; role:string };
}

async function handleSignup(b: Record<string,string>) {
  const { username, name, password, province } = b;
  if (!username||username.length<3)        return fail('Username must be at least 3 characters');
  if (!/^[a-zA-Z0-9_]+$/.test(username))  return fail('Username: letters, numbers and _ only');
  if (!name||name.trim().length<2)         return fail('Please enter your full name');
  if (!password||password.length<8)        return fail('Password must be at least 8 characters');
  if (!/[A-Z]/.test(password))             return fail('Password needs at least one uppercase letter');
  if (!/[0-9]/.test(password))             return fail('Password needs at least one number');
  const d = db();
  const { data: ex } = await d.from('cs_users').select('id').eq('username',username.toLowerCase()).maybeSingle();
  if (ex) return fail('Username is already taken');
  const { data: user, error } = await d.from('cs_users')
    .insert({ username:username.toLowerCase(), name:name.trim(), password_hash:'PENDING', province:province||'AB', role:'user' })
    .select('id,username,name,province,role').single();
  if (error) return fail('Signup failed: '+error.message);
  const { error: he } = await d.rpc('set_user_password',{ p_user_id:user.id, p_password:password });
  if (he) { await d.from('cs_users').delete().eq('id',user.id); return fail('Password error: '+he.message); }
  const { data: sess, error: se } = await d.from('cs_sessions').insert({ user_id:user.id, remember_me:false }).select('token,expires_at').single();
  if (se) return fail('Session error');
  return ok({ ok:true, action:'signup', user:{ id:user.id, username:user.username, name:user.name, province:user.province, role:user.role }, session:{ token:sess.token, expiresAt:sess.expires_at } });
}
async function handleLogin(b: Record<string,string>) {
  const { username, password, remember_me, twofa } = b;
  if (!username) return fail('Username is required');
  if (!password) return fail('Password is required');
  const d = db();
  const { data, error } = await d.rpc('verify_user_password',{ p_username:username.toLowerCase(), p_password:password });
  if (error||!data||data.length===0) return fail('Invalid username or password');
  const user = data[0];
  if (user.role==='admin') {
    const adminCode = await getAdminConfig('admin_2fa_code')?? '000000';
    if (!twofa) return fail('2FA code is required for admin login');
    if (twofa!==adminCode) return fail('Invalid 2FA code');
  }
  await d.from('cs_users').update({ last_login_at:new Date().toISOString() }).eq('id',user.id);
  const remMe = remember_me==='true'||remember_me===true as unknown as string;
  const exp = remMe ? new Date(Date.now()+30*24*60*60*1000).toISOString() : new Date(Date.now()+24*60*60*1000).toISOString();
  const { data: sess, error: se } = await d.from('cs_sessions').insert({ user_id:user.id, remember_me:remMe, expires_at:exp }).select('token,expires_at').single();
  if (se) return fail('Session error');
  return ok({ ok:true, action:'login', user:{ id:user.id, username:user.username, name:user.name, province:user.province, role:user.role }, session:{ token:sess.token, expiresAt:sess.expires_at } });
}
async function handleVerify(b: Record<string,string>) {
  const { token } = b;
  if (!token) return fail('Token required',401);
  const d = db();
  const { data, error } = await d.from('cs_sessions')
    .select('id,token,expires_at,remember_me,cs_users(id,username,name,province,role)')
    .eq('token',token).gt('expires_at',new Date().toISOString()).maybeSingle();
  if (error||!data) return fail('Session expired or invalid',401);
  await d.from('cs_sessions').update({ last_active:new Date().toISOString() }).eq('id',data.id);
  const u = data.cs_users as { id:string; username:string; name:string; province:string; role:string };
  return ok({ ok:true, action:'verify', user:{ id:u.id, username:u.username, name:u.name, province:u.province, role:u.role }, session:{ token:data.token, expiresAt:data.expires_at, rememberMe:data.remember_me } });
}
async function handleLogout(b: Record<string,string>) {
  if (b.token) await db().from('cs_sessions').delete().eq('token',b.token);
  return ok({ ok:true, action:'logout' });
}
async function handleGetCoins() {
  const { data, error } = await db().from('cs_coins').select('id,symbol,name,icon,coingecko_id').eq('is_active',true).order('symbol');
  if (error) return fail('Failed to load coins');
  return ok({ ok:true, coins:data });
}
async function handleAddCoin(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token); if (!user) return fail('Unauthorized',401);
  if (user.role!=='admin') return fail('Admin access required',403);
  const symbol=((b.symbol as string)||'').trim().toUpperCase(), name=((b.name as string)||'').trim();
  const coingecko_id=((b.coingecko_id as string)||'').trim().toLowerCase()||null, icon=((b.icon as string)||'').trim()||'●';
  if (!symbol) return fail('Symbol is required'); if (!name) return fail('Name is required');
  if (!/^[A-Z0-9]+$/.test(symbol)) return fail('Symbol must be letters and numbers only');
  const { data: ex } = await db().from('cs_coins').select('id').ilike('symbol',symbol).maybeSingle();
  if (ex) return fail(`A coin with symbol "${symbol}" already exists`);
  const { data, error } = await db().from('cs_coins').insert({ symbol,name,coingecko_id,icon,is_active:true }).select('id,symbol,name,icon,coingecko_id,is_active').single();
  if (error) return fail('Failed to add coin: '+error.message);
  return ok({ ok:true, action:'add_coin', coin:data });
}
async function handleDeleteCoin(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token); if (!user) return fail('Unauthorized',401);
  if (user.role!=='admin') return fail('Admin access required',403);
  const coin_id = b.coin_id as string; if (!coin_id) return fail('coin_id is required');
  const { error } = await db().from('cs_coins').update({ is_active:false }).eq('id',coin_id);
  if (error) return fail('Failed to remove coin: '+error.message);
  return ok({ ok:true, action:'delete_coin', coin_id });
}
async function handleGetProviders() {
  const { data, error } = await db().from('cs_providers').select('id,name,type,icon').eq('is_active',true).order('name');
  if (error) return fail('Failed to load providers');
  return ok({ ok:true, providers:data });
}
async function handleAddProvider(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token); if (!user) return fail('Unauthorized',401);
  if (user.role!=='admin') return fail('Admin access required',403);
  const name=(b.name as string||'').trim(), type=(b.type as string||'').trim();
  if (!name) return fail('Provider name is required');
  if (!['EXCHANGE','WALLET','BANK'].includes(type)) return fail('Type must be EXCHANGE, WALLET, or BANK');
  const icon = type==='EXCHANGE'?'⚡':type==='WALLET'?'🔐':'🏦';
  const { data: ex } = await db().from('cs_providers').select('id').ilike('name',name).maybeSingle();
  if (ex) return fail(`A provider named "${name}" already exists`);
  const { data, error } = await db().from('cs_providers').insert({ name,type,icon,is_active:true }).select('id,name,type,icon,is_active').single();
  if (error) return fail('Failed to add provider: '+error.message);
  return ok({ ok:true, action:'add_provider', provider:data });
}
async function handleDeleteProvider(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token); if (!user) return fail('Unauthorized',401);
  if (user.role!=='admin') return fail('Admin access required',403);
  const provider_id = b.provider_id as string; if (!provider_id) return fail('provider_id is required');
  const { error } = await db().from('cs_providers').update({ is_active:false }).eq('id',provider_id);
  if (error) return fail('Failed to remove provider: '+error.message);
  return ok({ ok:true, action:'delete_provider', provider_id });
}
async function handleGetUsers(token?: string) {
  const user = await resolveUser(token); if (!user) return fail('Unauthorized',401);
  if (user.role!=='admin') return fail('Admin access required',403);
  const d = db();
  const { data: users, error } = await d.from('cs_users').select('id,username,name,province,role,created_at,last_login_at').order('created_at',{ascending:false});
  if (error) return fail('Failed to load users: '+error.message);
  const ids=(users||[]).map((u:Record<string,string>)=>u.id);
  const [{ data: txC },{ data: simC },{ data: sesC }] = await Promise.all([
    d.from('cs_transactions').select('user_id').in('user_id',ids),
    d.from('cs_simulations').select('user_id').in('user_id',ids),
    d.from('cs_sessions').select('user_id').gt('expires_at',new Date().toISOString()).in('user_id',ids),
  ]);
  const txM:Record<string,number>={},simM:Record<string,number>={},sesM:Record<string,number>={};
  (txC||[]).forEach((r:Record<string,string>)=>{txM[r.user_id]=(txM[r.user_id]||0)+1;});
  (simC||[]).forEach((r:Record<string,string>)=>{simM[r.user_id]=(simM[r.user_id]||0)+1;});
  (sesC||[]).forEach((r:Record<string,string>)=>{sesM[r.user_id]=(sesM[r.user_id]||0)+1;});
  return ok({ ok:true, action:'get_users', users:(users||[]).map((u:Record<string,string>)=>({...u,tx_count:txM[u.id]||0,sim_count:simM[u.id]||0,active_sessions:sesM[u.id]||0})), total:(users||[]).length });
}
async function handleUpdateUser(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token); if (!user) return fail('Unauthorized',401);
  if (user.role!=='admin') return fail('Admin access required',403);
  const { target_user_id, role, new_password, name } = b as Record<string,string>;
  if (!target_user_id) return fail('target_user_id is required');
  const { data: target } = await db().from('cs_users').select('id,role').eq('id',target_user_id).maybeSingle();
  if (!target) return fail('User not found',404);
  const d = db(), updates: Record<string,string> = {};
  if (role&&['user','admin'].includes(role)) updates.role=role;
  if (name&&name.trim().length>=2) updates.name=name.trim();
  if (Object.keys(updates).length>0) { const { error } = await d.from('cs_users').update(updates).eq('id',target_user_id); if (error) return fail('Failed to update user: '+error.message); }
  if (new_password) {
    if (new_password.length<8) return fail('Password must be at least 8 characters');
    if (!/[A-Z]/.test(new_password)) return fail('Password needs at least one uppercase letter');
    if (!/[0-9]/.test(new_password)) return fail('Password needs at least one number');
    const { error: he } = await d.rpc('set_user_password',{ p_user_id:target_user_id, p_password:new_password });
    if (he) return fail('Failed to reset password: '+he.message);
    await d.from('cs_sessions').delete().eq('user_id',target_user_id);
  }
  return ok({ ok:true, action:'update_user', target_user_id });
}
async function handleDeleteUser(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token); if (!user) return fail('Unauthorized',401);
  if (user.role!=='admin') return fail('Admin access required',403);
  const { target_user_id } = b as Record<string,string>;
  if (!target_user_id) return fail('target_user_id is required');
  if (target_user_id===user.id) return fail('Cannot delete your own admin account');
  const { data: target } = await db().from('cs_users').select('id').eq('id',target_user_id).maybeSingle();
  if (!target) return fail('User not found',404);
  const { error } = await db().from('cs_users').delete().eq('id',target_user_id);
  if (error) return fail('Failed to delete user: '+error.message);
  return ok({ ok:true, action:'delete_user', target_user_id });
}
async function handleUpdateAdminCredentials(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token); if (!user) return fail('Unauthorized',401);
  if (user.role!=='admin') return fail('Admin access required',403);
  const { current_password, new_password, new_2fa_code } = b as Record<string,string>;
  if (!current_password) return fail('Current password is required');
  const d = db();
  const { data: verified } = await d.rpc('verify_user_password',{ p_username:user.username, p_password:current_password });
  if (!verified||verified.length===0) return fail('Current password is incorrect');
  if (new_password) {
    if (new_password.length<8) return fail('New password must be at least 8 characters');
    if (!/[A-Z]/.test(new_password)) return fail('New password needs at least one uppercase letter');
    if (!/[0-9]/.test(new_password)) return fail('New password needs at least one number');
    const { error } = await d.rpc('set_user_password',{ p_user_id:user.id, p_password:new_password });
    if (error) return fail('Failed to update password: '+error.message);
    await d.from('cs_sessions').delete().eq('user_id',user.id).neq('token',b.token as string||'');
  }
  if (new_2fa_code) {
    if (!/^\d{4,8}$/.test(new_2fa_code)) return fail('2FA code must be 4-8 digits');
    const { error } = await d.from('cs_admin_config').upsert({ key:'admin_2fa_code', value:new_2fa_code, updated_at:new Date().toISOString() },{ onConflict:'key' });
    if (error) return fail('Failed to update 2FA code: '+error.message);
  }
  return ok({ ok:true, action:'update_admin_credentials', password_changed:!!new_password, twofa_changed:!!new_2fa_code });
}
const TX_SELECT = `id,type,quantity,price_per_unit_cad,subtotal_cad,fees_cad,total_cad,transacted_at,tx_hash,notes,compliance_note,is_taxable,superficial_loss,capital_gain_cad,created_at,transfer_group_id,transfer_role,cs_coins(id,symbol,name,icon),from_provider:cs_providers!from_provider_id(id,name,icon),to_provider:cs_providers!to_provider_id(id,name,icon)`;
async function handleAddTransaction(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token); if (!user) return fail('Unauthorized',401);
  const { type,coin_id,quantity,price_per_unit_cad,fees_cad,from_provider_id,to_provider_id,transacted_at,tx_hash,notes } = b as Record<string,string>;
  if (!type||!coin_id||!quantity||!price_per_unit_cad||!transacted_at) return fail('Missing required fields');
  const { data, error } = await db().from('cs_transactions').insert({ user_id:user.id,type,coin_id,quantity:parseFloat(quantity),price_per_unit_cad:parseFloat(price_per_unit_cad),fees_cad:parseFloat(fees_cad||'0'),from_provider_id:from_provider_id||null,to_provider_id:to_provider_id||null,transacted_at,is_taxable:['SELL','SWAP_OUT','SWAP_IN'].includes(type),tx_hash:tx_hash||null,notes:notes||null }).select(TX_SELECT).single();
  if (error) return fail('Failed to save transaction: '+error.message);
  return ok({ ok:true, action:'add_transaction', transaction:data });
}
async function handleAddSwap(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token); if (!user) return fail('Unauthorized',401);
  const ta=b.transacted_at as string,fp=(b.from_provider_id as string)||null,th=(b.tx_hash as string)||null;
  const fci=b.from_coin_id as string,as_=parseFloat(b.amount_sold as string),fcp=parseFloat(b.from_coin_price_cad as string),cg=parseFloat(b.capital_gain_cad as string);
  const tci=b.to_coin_id as string,ar=parseFloat(b.amount_received as string),sfc=parseFloat(b.swap_fee_cad as string||'0'),nau=parseFloat(b.new_coin_acb_unit as string);
  if (!ta||!fci||!tci||fci===tci) return fail('Invalid swap fields');
  if (isNaN(as_)||as_<=0||isNaN(ar)||ar<=0) return fail('Invalid quantities');
  const sg=crypto.randomUUID(),d=db();
  const { data: o, error: oe } = await d.from('cs_transactions').insert({ user_id:user.id,type:'SWAP_OUT',coin_id:fci,quantity:as_,price_per_unit_cad:fcp,fees_cad:0,from_provider_id:fp,to_provider_id:null,transacted_at:ta,is_taxable:true,capital_gain_cad:cg,tx_hash:th,notes:(b.swap_out_notes as string)||null }).select(TX_SELECT).single();
  if (oe) return fail('Failed to save swap (OUT): '+oe.message);
  const { data: i, error: ie } = await d.from('cs_transactions').insert({ user_id:user.id,type:'SWAP_IN',coin_id:tci,quantity:ar,price_per_unit_cad:nau,fees_cad:isNaN(sfc)?0:sfc,from_provider_id:fp,to_provider_id:null,transacted_at:ta,is_taxable:true,capital_gain_cad:0,tx_hash:th,notes:(b.swap_in_notes as string)||null }).select(TX_SELECT).single();
  if (ie) { await d.from('cs_transactions').delete().eq('id',o.id); return fail('Failed to save swap (IN): '+ie.message); }
  return ok({ ok:true, action:'add_swap', swap_group_id:sg, swap_out:o, swap_in:i });
}
async function handleAddTransfer(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token); if (!user) return fail('Unauthorized',401);
  const ci=b.coin_id as string,fp=b.from_provider_id as string,tp=b.to_provider_id as string,ta=b.transacted_at as string;
  const qty=parseFloat(b.quantity as string),apu=parseFloat(b.acb_per_unit as string||'0'),fac=parseFloat(b.fee_acb_cad as string||'0'),fu=parseFloat(b.fee_units as string||'0'),ffc=parseFloat(b.fee_fmv_cad as string||'0'),fgc=parseFloat(b.fee_gain_cad as string||'0'),ft=(b.fee_treatment as string)||'realize',th=(b.tx_hash as string)||null;
  if (!ci||!fp||!tp||!ta||isNaN(qty)||qty<=0||fp===tp) return fail('Invalid transfer fields');
  const tg=crypto.randomUUID(),d=db();
  const { data: o, error: oe } = await d.from('cs_transactions').insert({ user_id:user.id,type:'TRANSFER_OUT',coin_id:ci,quantity:qty,price_per_unit_cad:apu,fees_cad:isNaN(fac)?0:fac,from_provider_id:fp,to_provider_id:tp,transacted_at:ta,is_taxable:fgc!==0,tx_hash:th,notes:(b.transfer_out_notes as string)||null,transfer_group_id:tg,transfer_role:'TRANSFER_OUT',fee_treatment:ft,fee_units:fu||null,fee_fmv_cad:ffc||null,fee_acb_cad:fac||null,fee_gain_cad:fgc||null }).select(TX_SELECT).single();
  if (oe) return fail('Failed to save transfer (OUT): '+oe.message);
  const { data: i, error: ie } = await d.from('cs_transactions').insert({ user_id:user.id,type:'TRANSFER_IN',coin_id:ci,quantity:qty,price_per_unit_cad:apu,fees_cad:0,from_provider_id:fp,to_provider_id:tp,transacted_at:ta,is_taxable:false,tx_hash:th,notes:(b.transfer_in_notes as string)||null,transfer_group_id:tg,transfer_role:'TRANSFER_IN',fee_treatment:ft,fee_units:null,fee_fmv_cad:null,fee_acb_cad:null,fee_gain_cad:null }).select(TX_SELECT).single();
  if (ie) { await d.from('cs_transactions').delete().eq('id',o.id); return fail('Failed to save transfer (IN): '+ie.message); }
  return ok({ ok:true, action:'add_transfer', transfer_group_id:tg, transfer_out:o, transfer_in:i });
}
async function handleGetTransactions(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token); if (!user) return fail('Unauthorized',401);
  const ci=b.coin_id as string|undefined,lim=Math.min(parseInt(b.limit as string||'100'),500);
  let q=db().from('cs_transactions').select(TX_SELECT).eq('user_id',user.id).order('transacted_at',{ascending:false}).limit(lim);
  if (ci) q=q.eq('coin_id',ci);
  const { data, error } = await q;
  if (error) return fail('Failed to load transactions: '+error.message);
  return ok({ ok:true, action:'get_transactions', transactions:data??[], count:(data??[]).length });
}
async function handleDeleteTransaction(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token); if (!user) return fail('Unauthorized',401);
  const { transaction_id } = b as Record<string,string>;
  if (!transaction_id) return fail('transaction_id is required');
  const { data: ex } = await db().from('cs_transactions').select('id').eq('id',transaction_id).eq('user_id',user.id).maybeSingle();
  if (!ex) return fail('Transaction not found',404);
  const { error } = await db().from('cs_transactions').delete().eq('id',transaction_id);
  if (error) return fail('Delete failed: '+error.message);
  return ok({ ok:true, action:'delete_transaction', id:transaction_id });
}
async function handleUpdateComplianceNote(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token); if (!user) return fail('Unauthorized',401);
  const { transaction_id, compliance_note } = b as Record<string,string>;
  if (!transaction_id) return fail('transaction_id is required');
  const { data: ex } = await db().from('cs_transactions').select('id').eq('id',transaction_id).eq('user_id',user.id).maybeSingle();
  if (!ex) return fail('Transaction not found',404);
  const { error } = await db().from('cs_transactions').update({ compliance_note:compliance_note||null, updated_at:new Date().toISOString() }).eq('id',transaction_id);
  if (error) return fail('Failed to save note: '+error.message);
  return ok({ ok:true, action:'update_compliance_note', transaction_id, compliance_note:compliance_note||null });
}
async function handleImportTransactions(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token); if (!user) return fail('Unauthorized',401);
  const exchange=(b.exchange as string)||'',filename=(b.filename as string)||'',rows = b.rows as Array<Record<string,unknown>>;
  if (!exchange) return fail('exchange is required');
  if (!rows||!Array.isArray(rows)||rows.length===0) return fail('No rows to import');
  if (rows.length>5000) return fail('Maximum 5000 rows per import');
  const d = db();
  const [{ data: coins },{ data: providers }] = await Promise.all([d.from('cs_coins').select('id,symbol').eq('is_active',true),d.from('cs_providers').select('id,name').eq('is_active',true)]);
  const coinMap: Record<string,string>={},providerMap: Record<string,string>={};
  (coins||[]).forEach((c:Record<string,string>)=>{ coinMap[c.symbol.toUpperCase()]=c.id; });
  (providers||[]).forEach((p:Record<string,string>)=>{ providerMap[p.name.toLowerCase()]=p.id; });
  const exchangeProviderId = providerMap[exchange.toLowerCase()]||null;
  const { data: exRows } = await d.from('cs_transactions').select('external_id').eq('user_id',user.id).not('external_id','is',null);
  const seenExtIds = new Set<string>((exRows||[]).map((r:Record<string,string>)=>r.external_id).filter(Boolean));
  const { data: existingTxs } = await d.from('cs_transactions').select('type,quantity,price_per_unit_cad,subtotal_cad,transacted_at,cs_coins(symbol)').eq('user_id',user.id);
  const seenValFps = new Set<string>(),seenQtyFps = new Set<string>();
  (existingTxs||[]).forEach((tx:Record<string,unknown>) => {
    const coin=tx.cs_coins as Record<string,string>|null,sym=(coin?.symbol||'').toUpperCase(),type=String(tx.type),qty=parseFloat(String(tx.quantity||0)),date=String(tx.transacted_at||'').slice(0,10);
    seenQtyFps.add(`${type}|${sym}|${date}|${Math.round(qty*1e6)/1e6}`);
    if (type==='BUY'||type==='SELL') { const sub=parseFloat(String(tx.subtotal_cad||(qty*parseFloat(String(tx.price_per_unit_cad||0))))); if (sub>0) seenValFps.add(`${type}|${sym}|${date}|${Math.round(sub)}`); }
  });
  let imported=0,skipped=0,errored=0;
  const errors: string[]=[],validTypes = new Set(['BUY','SELL','SWAP_OUT','SWAP_IN','TRANSFER_OUT','TRANSFER_IN','STAKING','AIRDROP']);
  for (const row of rows) {
    try {
      const extId=(row.external_id as string)||null,txType=String(row.type||''),sym=String(row.symbol||'').toUpperCase(),qty=parseFloat(String(row.quantity||0)),price=parseFloat(String(row.price_cad||0)),fees=parseFloat(String(row.fees_cad||'0')),txAt=String(row.transacted_at||''),date=txAt.slice(0,10);
      if (extId&&seenExtIds.has(extId)) { skipped++; continue; }
      if ((txType==='BUY'||txType==='SELL')&&!isNaN(qty)&&!isNaN(price)&&price>0&&qty>0) { if (seenValFps.has(`${txType}|${sym}|${date}|${Math.round(qty*price)}`)) { skipped++; continue; } }
      if (!isNaN(qty)&&qty>0) { if (seenQtyFps.has(`${txType}|${sym}|${date}|${Math.round(qty*1e6)/1e6}`)) { skipped++; continue; } }
      const coinId=coinMap[sym];
      if (!coinId) { errored++; errors.push(`Unknown coin: ${row.symbol}`); continue; }
      if (isNaN(qty)||qty<=0) { errored++; errors.push(`Invalid quantity for ${sym}`); continue; }
      if (isNaN(price)||price<0) { errored++; errors.push(`Invalid price for ${sym}`); continue; }
      if (!validTypes.has(txType)) { errored++; errors.push(`Unknown type: ${txType}`); continue; }
      const rec: Record<string,unknown> = { user_id:user.id,type:txType,coin_id:coinId,quantity:qty,price_per_unit_cad:price,fees_cad:isNaN(fees)?0:fees,transacted_at:txAt||null,is_taxable:['SELL','SWAP_OUT','SWAP_IN','STAKING','AIRDROP'].includes(txType),tx_hash:(row.tx_hash&&String(row.tx_hash)!=='null')?String(row.tx_hash):null,notes:(row.notes as string)||null,from_provider_id:exchangeProviderId,to_provider_id:null,external_id:extId };
      if (row.swap_group_id) { rec.swap_group_id=row.swap_group_id; rec.swap_role=txType; }
      const { error } = await d.from('cs_transactions').insert(rec);
      if (error) { errored++; errors.push(error.message); continue; }
      if (extId) seenExtIds.add(extId);
      if ((txType==='BUY'||txType==='SELL')&&price>0&&qty>0) seenValFps.add(`${txType}|${sym}|${date}|${Math.round(qty*price)}`);
      seenQtyFps.add(`${txType}|${sym}|${date}|${Math.round(qty*1e6)/1e6}`);
      imported++;
    } catch(e) { errored++; errors.push(String(e)); }
  }
  await d.from('cs_import_logs').insert({ user_id:user.id,exchange,filename,rows_parsed:rows.length,rows_imported:imported,rows_skipped:skipped,rows_errored:errored,status:imported===0&&errored>0?'failed':'complete',error_detail:errors.slice(0,10).join(' | ')||null });
  return ok({ ok:true, action:'import_transactions', imported, skipped, errored, errors:errors.slice(0,10), total:rows.length });
}
async function handleGetImportLogs(token?: string) {
  const user = await resolveUser(token); if (!user) return fail('Unauthorized',401);
  const { data, error } = await db().from('cs_import_logs').select('id,exchange,filename,rows_parsed,rows_imported,rows_skipped,rows_errored,status,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(20);
  if (error) return fail('Failed to load import logs: '+error.message);
  return ok({ ok:true, action:'get_import_logs', logs:data??[] });
}
async function handleSaveSimulation(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token); if (!user) return fail('Unauthorized',401);
  const ci=b.coin_id as string,qty=parseFloat(b.quantity as string),pp=parseFloat(b.purchase_price_cad as string),fc=parseFloat(b.fees_cad as string||'0'),fp_=parseFloat(b.forecasted_profit as string),rsp=parseFloat(b.required_sell_price as string),lbl=(b.label as string)||null;
  if (!ci||isNaN(qty)||qty<=0||isNaN(pp)||isNaN(fp_)||isNaN(rsp)) return fail('Invalid simulation parameters');
  const cb=qty*pp+fc,gp=qty*rsp-cb-fc;
  const { data, error } = await db().from('cs_simulations').insert({ user_id:user.id,coin_id:ci,quantity:qty,purchase_price_cad:pp,fees_cad:fc,forecasted_profit:fp_,required_sell_price:rsp,cost_basis_cad:cb,gross_proceeds_cad:qty*rsp,sell_fees_cad:fc,gross_profit_cad:gp,net_profit_cad:gp,label:lbl }).select('id,quantity,purchase_price_cad,fees_cad,forecasted_profit,required_sell_price,cost_basis_cad,gross_proceeds_cad,sell_fees_cad,gross_profit_cad,net_profit_cad,label,created_at,cs_coins(id,symbol,name,icon)').single();
  if (error) return fail('Failed to save simulation: '+error.message);
  return ok({ ok:true, action:'save_simulation', simulation:data });
}
async function handleGetSimulations(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token); if (!user) return fail('Unauthorized',401);
  const lim=Math.min(parseInt(b.limit as string||'50'),200);
  const { data, error } = await db().from('cs_simulations').select('id,quantity,purchase_price_cad,fees_cad,forecasted_profit,required_sell_price,cost_basis_cad,gross_proceeds_cad,sell_fees_cad,gross_profit_cad,net_profit_cad,label,created_at,cs_coins(id,symbol,name,icon)').eq('user_id',user.id).order('created_at',{ascending:false}).limit(lim);
  if (error) return fail('Failed to load simulations: '+error.message);
  return ok({ ok:true, action:'get_simulations', simulations:data??[], count:(data??[]).length });
}
async function handleDeleteSimulation(b: Record<string,unknown>, token?: string) {
  const user = await resolveUser(token); if (!user) return fail('Unauthorized',401);
  const { simulation_id } = b as Record<string,string>;
  if (!simulation_id) return fail('simulation_id required');
  const { data: ex } = await db().from('cs_simulations').select('id').eq('id',simulation_id).eq('user_id',user.id).maybeSingle();
  if (!ex) return fail('Simulation not found',404);
  const { error } = await db().from('cs_simulations').delete().eq('id',simulation_id);
  if (error) return fail('Delete failed: '+error.message);
  return ok({ ok:true, action:'delete_simulation', id:simulation_id });
}

Deno.serve(async (req: Request) => {
  if (req.method==='OPTIONS') return new Response(null,{ headers:cors });
  if (req.method!=='POST') return fail('Method not allowed',405);
  let body: Record<string,unknown> = {};
  try { body = await req.json(); } catch { return fail('Invalid JSON'); }
  const auth=req.headers.get('authorization')||'';
  const token=(body.token as string)||(auth.startsWith('Bearer ')?auth.slice(7):undefined);
  switch (body.action) {
    case 'signup':                   return handleSignup(body as Record<string,string>);
    case 'login':                    return handleLogin(body as Record<string,string>);
    case 'verify':                   return handleVerify(body as Record<string,string>);
    case 'logout':                   return handleLogout(body as Record<string,string>);
    case 'get_coins':                return handleGetCoins();
    case 'add_coin':                 return handleAddCoin(body,token);
    case 'delete_coin':              return handleDeleteCoin(body,token);
    case 'get_providers':            return handleGetProviders();
    case 'add_provider':             return handleAddProvider(body,token);
    case 'delete_provider':          return handleDeleteProvider(body,token);
    case 'get_users':                return handleGetUsers(token);
    case 'update_user':              return handleUpdateUser(body,token);
    case 'delete_user':              return handleDeleteUser(body,token);
    case 'update_admin_credentials': return handleUpdateAdminCredentials(body,token);
    case 'add_transaction':          return handleAddTransaction(body,token);
    case 'add_swap':                 return handleAddSwap(body,token);
    case 'add_transfer':             return handleAddTransfer(body,token);
    case 'get_transactions':         return handleGetTransactions(body,token);
    case 'delete_transaction':       return handleDeleteTransaction(body,token);
    case 'update_compliance_note':   return handleUpdateComplianceNote(body,token);
    case 'import_transactions':      return handleImportTransactions(body,token);
    case 'get_import_logs':          return handleGetImportLogs(token);
    case 'save_simulation':          return handleSaveSimulation(body,token);
    case 'get_simulations':          return handleGetSimulations(body,token);
    case 'delete_simulation':        return handleDeleteSimulation(body,token);
    default:                         return fail('Unknown action: '+body.action);
  }
});
