const SESSION_DAYS = 7;
const PBKDF2_ITERATIONS = 100000;
const API_VERSION = 'voucher-api-stable-v4';

export async function onRequest(context) {
  const request = context.request;
  if (request.method === 'OPTIONS') return new Response('', { status: 204 });
  if (request.method !== 'POST') return send({ error: 'Method not allowed', version: API_VERSION }, 405);
  try {
    return await handle(context);
  } catch (err) {
    return send({
      error: err && err.message ? String(err.message) : 'Server error',
      name: err && err.name ? String(err.name) : 'Error',
      status: safeStatus(err && (err.status || err.statusCode) ? (err.status || err.statusCode) : 500),
      version: API_VERSION
    }, err && (err.status || err.statusCode) ? (err.status || err.statusCode) : 500);
  }
}

async function handle(context) {
  const request = context.request;
  const env = context.env || {};
  const body = await request.json().catch(function () { return {}; });
  const action = String(body.action || '');
  const ip = request.headers.get('cf-connecting-ip') || '';

  if (action === 'health') return send({ ok: true, version: API_VERSION, db: !!env.DB, setupKey: !!env.SMV_SETUP_KEY });
  if (!env.DB) throwError('D1 binding DB missing. Binding name must be DB.', 500);

  await ensureSchema(env.DB);

  if (action === 'setupAdmin') return await setupAdmin(env, body, ip);
  if (action === 'login') return await login(env, body, ip);
  if (action === 'logout') return await logout(env.DB, body.token);

  const session = await requireSession(env.DB, body.token);
  if (action === 'validateSession') return send({ user: publicUser(session.user), version: API_VERSION });
  if (action === 'listVouchers') return await listVouchers(env.DB, session.user);
  if (action === 'saveVoucher') return await saveVoucher(env.DB, session.user, body.voucher, ip);
  if (action === 'deleteVoucher') return await adminOnly(session.user, function () { return deleteVoucher(env.DB, session.user, body.id, ip); });
  if (action === 'listHeads') return await listHeads(env.DB, session.user);
  if (action === 'addHead') return await addHead(env.DB, session.user, body, ip);
  if (action === 'listUsers') return await adminOnly(session.user, function () { return listUsers(env.DB); });
  if (action === 'createUser') return await adminOnly(session.user, function () { return createUser(env.DB, session.user, body, ip); });
  if (action === 'setUserStatus') return await adminOnly(session.user, function () { return setUserStatus(env.DB, session.user, body, ip); });
  if (action === 'resetPassword') return await adminOnly(session.user, function () { return resetPassword(env.DB, session.user, body, ip); });
  if (action === 'listAudit') return await adminOnly(session.user, function () { return listAudit(env.DB); });
  return send({ error: 'Unknown action', action: action, version: API_VERSION }, 400);
}

function send(data, status) {
  return new Response(JSON.stringify(data), {
    status: safeStatus(status || 200),
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
function safeStatus(status) { const n = Number(status); return Number.isInteger(n) && n >= 200 && n <= 599 ? n : 500; }
function throwError(message, status) { const e = new Error(message); e.status = status || 400; throw e; }
async function adminOnly(user, fn) { if (!user || user.role !== 'admin') throwError('Access denied', 403); return await fn(); }
function now() { return new Date().toISOString(); }
function clean(v, max) { return String(v || '').trim().replace(/\s+/g, ' ').slice(0, max || 2000); }
function norm(v) { return clean(v, 250).toLowerCase(); }
function publicUser(u) { return { username: u.username, role: u.role, status: u.status, college: u.college }; }
function amount(v) { return Math.round(Number(v || 0)); }
function allowedCollege(user, requested) { return user.role === 'admin' ? clean(requested || user.college || 'smg', 20) : clean(user.college || 'smg', 20); }

async function ensureSchema(DB) {
  await DB.prepare("CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','user')),status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','blocked')),college TEXT NOT NULL DEFAULT 'smg',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_login TEXT)").run();
  await DB.prepare("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY,username TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL)").run();
  await DB.prepare("CREATE TABLE IF NOT EXISTS vouchers (id INTEGER PRIMARY KEY AUTOINCREMENT,voucher_no TEXT,college TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('debit','onaccount','credit')),date TEXT NOT NULL,head TEXT NOT NULL,ac_name TEXT,received_from TEXT,paid_to TEXT,towards TEXT NOT NULL,amount INTEGER NOT NULL,amt_words TEXT,mode TEXT,cheque TEXT,prep_by TEXT,checked_by TEXT,remarks TEXT,created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_by TEXT,updated_at TEXT NOT NULL,deleted_at TEXT,deleted_by TEXT)").run();
  await DB.prepare("CREATE TABLE IF NOT EXISTS account_heads (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,name_norm TEXT NOT NULL,type TEXT NOT NULL DEFAULT 'common',college TEXT NOT NULL DEFAULT 'smg',created_by TEXT NOT NULL,created_at TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,UNIQUE(name_norm,college))").run();
  await DB.prepare("CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT,details TEXT,ip TEXT,created_at TEXT NOT NULL)").run();
  await DB.prepare('CREATE INDEX IF NOT EXISTS idx_vouchers_college_date ON vouchers(college,date)').run();
  await DB.prepare('CREATE INDEX IF NOT EXISTS idx_vouchers_created_by ON vouchers(created_by)').run();
  await DB.prepare('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at)').run();
}

async function setupAdmin(env, body, ip) {
  if (!env.SMV_SETUP_KEY) throwError('SMV_SETUP_KEY is not configured.', 500);
  if (String(body.setupKey || '') !== String(env.SMV_SETUP_KEY)) throwError('Invalid setup key', 403);
  const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first();
  if (Number(row && row.c ? row.c : 0) > 0) throwError('Setup already completed', 409);
  const password = String(body.password || '');
  if (password.length < 8) throwError('Admin password must be at least 8 characters', 400);
  const hp = await hashPassword(password);
  await env.DB.prepare('INSERT INTO users(username,password_salt,password_hash,role,status,college,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind('admin', hp.salt, hp.hash, 'admin', 'active', 'smg', now(), now()).run();
  await audit(env.DB, 'system', 'setup_admin', 'user', 'admin', 'Initial admin created', ip);
  return send({ ok: true, message: 'Admin created', version: API_VERSION });
}

async function login(env, body, ip) {
  const username = norm(body.username), password = String(body.password || '');
  const user = await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username).first();
  if (!user) throwError('Invalid credentials', 401);
  if (user.status !== 'active') throwError('User is blocked. Contact admin.', 403);
  if (!(await verifyPassword(password, user.password_salt, user.password_hash))) throwError('Invalid credentials', 401);
  const token = randomHex(32), exp = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare('INSERT INTO sessions(token,username,expires_at,created_at) VALUES(?,?,?,?)').bind(token, username, exp, now()).run();
  await env.DB.prepare('UPDATE users SET last_login=?,updated_at=? WHERE username=?').bind(now(), now(), username).run();
  await audit(env.DB, username, 'login', 'user', username, 'Login successful', ip);
  return send({ token: token, user: publicUser(user), version: API_VERSION });
}

async function logout(DB, token) { if (token) await DB.prepare('DELETE FROM sessions WHERE token=?').bind(token).run(); return send({ ok: true, version: API_VERSION }); }
async function requireSession(DB, token) {
  if (!token) throwError('Login required', 401);
  const row = await DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.username=s.username WHERE s.token=? AND s.expires_at>?').bind(token, now()).first();
  if (!row) throwError('Session expired. Login again.', 401);
  if (row.status !== 'active') throwError('User is blocked. Contact admin.', 403);
  return { user: row };
}
async function listVouchers(DB, user) {
  const sql = user.role === 'admin' ? 'SELECT * FROM vouchers WHERE deleted_at IS NULL ORDER BY date DESC,id DESC' : 'SELECT * FROM vouchers WHERE deleted_at IS NULL AND created_by=? ORDER BY date DESC,id DESC';
  const q = user.role === 'admin' ? DB.prepare(sql) : DB.prepare(sql).bind(user.username);
  const r = await q.all(); return send({ vouchers: r.results || [], version: API_VERSION });
}
async function saveVoucher(DB, user, v, ip) {
  if (!v || typeof v !== 'object') throwError('Invalid voucher', 400);
  const id = Number(v.id || 0), type = clean(v.type, 20);
  if (['debit','onaccount','credit'].indexOf(type) === -1) throwError('Invalid voucher type', 400);
  const row = { college: allowedCollege(user,v.college), type:type, date:clean(v.date,20), head:clean(v.head,250), ac_name:clean(v.ac_name,250), received_from:clean(v.received_from,250), paid_to:clean(v.paid_to,250), towards:clean(v.towards,500), amount:amount(v.amount), amt_words:clean(v.amt_words,500), mode:clean(v.mode,50), cheque:clean(v.cheque,120), prep_by:clean(v.prep_by,120), checked_by:clean(v.checked_by,120), remarks:clean(v.remarks,500) };
  if (!row.date || !row.head || !row.towards || !row.amount) throwError('Date, head, towards and amount are required', 400);
  if (id) {
    if (user.role !== 'admin') throwError('Only admin can edit vouchers', 403);
    await DB.prepare('UPDATE vouchers SET college=?,type=?,date=?,head=?,ac_name=?,received_from=?,paid_to=?,towards=?,amount=?,amt_words=?,mode=?,cheque=?,prep_by=?,checked_by=?,remarks=?,updated_by=?,updated_at=? WHERE id=? AND deleted_at IS NULL').bind(row.college,row.type,row.date,row.head,row.ac_name,row.received_from,row.paid_to,row.towards,row.amount,row.amt_words,row.mode,row.cheque,row.prep_by,row.checked_by,row.remarks,user.username,now(),id).run();
    await audit(DB,user.username,'update_voucher','voucher',String(id),JSON.stringify({amount:row.amount,head:row.head}),ip); return send({ ok:true, id:id, version:API_VERSION });
  }
  const ins = await DB.prepare('INSERT INTO vouchers(college,type,date,head,ac_name,received_from,paid_to,towards,amount,amt_words,mode,cheque,prep_by,checked_by,remarks,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(row.college,row.type,row.date,row.head,row.ac_name,row.received_from,row.paid_to,row.towards,row.amount,row.amt_words,row.mode,row.cheque,row.prep_by,row.checked_by,row.remarks,user.username,now(),user.username,now()).run();
  const newId = ins.meta.last_row_id, voucherNo = voucherNumber(row.college,row.type,newId);
  await DB.prepare('UPDATE vouchers SET voucher_no=? WHERE id=?').bind(voucherNo,newId).run();
  await audit(DB,user.username,'create_voucher','voucher',String(newId),JSON.stringify({voucherNo:voucherNo,amount:row.amount,head:row.head}),ip);
  return send({ ok:true, id:newId, voucher_no:voucherNo, version:API_VERSION });
}
function voucherNumber(college,type,id) { const p = {debit:'DV',onaccount:'OA',credit:'CV'}[type] || 'VO'; return String(college || 'SMG').toUpperCase() + '-' + p + '-' + new Date().getFullYear() + '-' + String(id).padStart(5,'0'); }
async function deleteVoucher(DB,user,id,ip) { id = Number(id || 0); if(!id) throwError('Invalid voucher id',400); await DB.prepare('UPDATE vouchers SET deleted_at=?,deleted_by=?,updated_by=?,updated_at=? WHERE id=? AND deleted_at IS NULL').bind(now(),user.username,user.username,now(),id).run(); await audit(DB,user.username,'delete_voucher','voucher',String(id),'Soft delete',ip); return send({ok:true,version:API_VERSION}); }
async function listHeads(DB,user) { const q = user.role === 'admin' ? DB.prepare('SELECT * FROM account_heads WHERE active=1 ORDER BY name') : DB.prepare('SELECT * FROM account_heads WHERE active=1 AND college=? ORDER BY name').bind(user.college || 'smg'); const r = await q.all(); return send({heads:r.results || [],version:API_VERSION}); }
async function addHead(DB,user,body,ip) { const name = clean(body.name,250); if(!name) throwError('Head name required',400); const type = ['debit','onaccount','credit','common'].indexOf(body.type) !== -1 ? body.type : 'common'; const college = allowedCollege(user,body.college); await DB.prepare('INSERT OR IGNORE INTO account_heads(name,name_norm,type,college,created_by,created_at,active) VALUES(?,?,?,?,?,?,1)').bind(name,norm(name),type,college,user.username,now()).run(); await audit(DB,user.username,'add_account_head','account_head',name,JSON.stringify({type:type,college:college}),ip); return await listHeads(DB,user); }
async function listUsers(DB) { const r = await DB.prepare('SELECT username,role,status,college,created_at,updated_at,last_login FROM users ORDER BY username').all(); return send({users:r.results || [],version:API_VERSION}); }
async function createUser(DB,actor,body,ip) { const username=norm(body.username); if(!/^[a-z0-9._-]{3,32}$/.test(username)) throwError('Username must be 3-32 letters/numbers',400); const password=String(body.password || ''); if(password.length<6) throwError('Password must be at least 6 characters',400); const existing=await DB.prepare('SELECT username FROM users WHERE username=?').bind(username).first(); if(existing) throwError('Username already exists',409); const role=body.role==='admin'?'admin':'user', college=clean(body.college || 'smg',20), hp=await hashPassword(password); await DB.prepare('INSERT INTO users(username,password_salt,password_hash,role,status,college,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(username,hp.salt,hp.hash,role,'active',college,now(),now()).run(); await audit(DB,actor.username,'create_user','user',username,JSON.stringify({role:role,college:college}),ip); return send({ok:true,version:API_VERSION}); }
async function setUserStatus(DB,actor,body,ip) { const username=norm(body.username), status=body.status==='blocked'?'blocked':'active'; if(username==='admin') throwError('Admin cannot be blocked',400); await DB.prepare('UPDATE users SET status=?,updated_at=? WHERE username=?').bind(status,now(),username).run(); if(status==='blocked') await DB.prepare('DELETE FROM sessions WHERE username=?').bind(username).run(); await audit(DB,actor.username,'set_user_status','user',username,status,ip); return send({ok:true,version:API_VERSION}); }
async function resetPassword(DB,actor,body,ip) { const username=norm(body.username), password=String(body.password || ''); if(password.length<6) throwError('Password must be at least 6 characters',400); const hp=await hashPassword(password); await DB.prepare('UPDATE users SET password_salt=?,password_hash=?,updated_at=? WHERE username=?').bind(hp.salt,hp.hash,now(),username).run(); await DB.prepare('DELETE FROM sessions WHERE username=?').bind(username).run(); await audit(DB,actor.username,'reset_password','user',username,'Password reset and sessions revoked',ip); return send({ok:true,version:API_VERSION}); }
async function listAudit(DB) { const r=await DB.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500').all(); return send({logs:r.results || [],version:API_VERSION}); }
async function audit(DB,actor,action,entityType,entityId,details,ip) { await DB.prepare('INSERT INTO audit_logs(actor,action,entity_type,entity_id,details,ip,created_at) VALUES(?,?,?,?,?,?,?)').bind(actor,action,entityType,entityId,details || '',ip || '',now()).run(); }
async function hashPassword(password,saltHex) { const enc=new TextEncoder(); const salt=saltHex && /^[0-9a-f]+$/i.test(saltHex) ? fromHex(saltHex) : randomBytes(16); const key=await crypto.subtle.importKey('raw',enc.encode(password),{name:'PBKDF2'},false,['deriveBits']); const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:salt,iterations:PBKDF2_ITERATIONS},key,256); return {salt:toHex(salt),hash:toHex(new Uint8Array(bits))}; }
async function verifyPassword(password,salt,expected) { if(!/^[0-9a-f]+$/i.test(String(salt || ''))) return false; const hp=await hashPassword(password,salt); return safeEqual(hp.hash,expected); }
function randomBytes(len) { const arr=new Uint8Array(len); crypto.getRandomValues(arr); return arr; }
function randomHex(len) { return toHex(randomBytes(len)); }
function toHex(bytes) { let s=''; for(let i=0;i<bytes.length;i++) s += bytes[i].toString(16).padStart(2,'0'); return s; }
function fromHex(hex) { const h=String(hex || '').replace(/[^0-9a-f]/gi,''); const out=new Uint8Array(Math.floor(h.length/2)); for(let i=0;i<out.length;i++) out[i]=parseInt(h.slice(i*2,i*2+2),16); return out; }
function safeEqual(a,b) { a=String(a || ''); b=String(b || ''); if(a.length!==b.length) return false; let out=0; for(let i=0;i<a.length;i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i); return out===0; }
