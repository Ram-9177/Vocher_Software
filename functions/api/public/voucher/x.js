const SESSION_DAYS = 7;
const PBKDF2_ITERATIONS = 120000;

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.DB) return json({ error: 'D1 binding DB missing. Add DB in Cloudflare Pages settings.' }, 500);
    await ensureSchema(env.DB);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '');
    const ip = request.headers.get('cf-connecting-ip') || '';
    if (action === 'setupAdmin') return setupAdmin(env, body, ip);
    if (action === 'login') return login(env, body, ip);
    if (action === 'logout') return logout(env.DB, body.token);
    const session = await requireSession(env.DB, body.token);
    if (action === 'validateSession') return json({ user: publicUser(session.user) });
    if (action === 'listVouchers') return listVouchers(env.DB, session.user);
    if (action === 'saveVoucher') return saveVoucher(env.DB, session.user, body.voucher, ip);
    if (action === 'deleteVoucher') return adminOnly(session.user, () => deleteVoucher(env.DB, session.user, body.id, ip));
    if (action === 'listHeads') return listHeads(env.DB, session.user);
    if (action === 'addHead') return addHead(env.DB, session.user, body, ip);
    if (action === 'listUsers') return adminOnly(session.user, () => listUsers(env.DB));
    if (action === 'createUser') return adminOnly(session.user, () => createUser(env.DB, session.user, body, ip));
    if (action === 'setUserStatus') return adminOnly(session.user, () => setUserStatus(env.DB, session.user, body, ip));
    if (action === 'resetPassword') return adminOnly(session.user, () => resetPassword(env.DB, session.user, body, ip));
    if (action === 'listAudit') return adminOnly(session.user, () => listAudit(env.DB));
    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ error: err.message || 'Server error' }, err.status || 500);
  }
}

function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' } }); }
function bad(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
function adminOnly(user, fn) { if (user.role !== 'admin') bad('Access denied', 403); return fn(); }
function publicUser(u) { return { username:u.username, role:u.role, status:u.status, college:u.college }; }
function now() { return new Date().toISOString(); }
function clean(v, max = 2000) { return String(v || '').trim().replace(/\s+/g, ' ').slice(0, max); }
function norm(v) { return clean(v, 250).toLowerCase(); }
function amount(v) { return Math.round(Number(v || 0)); }
function allowedCollege(user, requested) { return user.role === 'admin' ? clean(requested || user.college || 'smg', 20) : clean(user.college || 'smg', 20); }

async function ensureSchema(DB) {
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','user')),status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','blocked')),college TEXT NOT NULL DEFAULT 'smg',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_login TEXT)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY,username TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS vouchers (id INTEGER PRIMARY KEY AUTOINCREMENT,voucher_no TEXT,college TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('debit','onaccount','credit')),date TEXT NOT NULL,head TEXT NOT NULL,ac_name TEXT,received_from TEXT,paid_to TEXT,towards TEXT NOT NULL,amount INTEGER NOT NULL,amt_words TEXT,mode TEXT,cheque TEXT,prep_by TEXT,checked_by TEXT,remarks TEXT,created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_by TEXT,updated_at TEXT NOT NULL,deleted_at TEXT,deleted_by TEXT)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS account_heads (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,name_norm TEXT NOT NULL,type TEXT NOT NULL DEFAULT 'common',college TEXT NOT NULL DEFAULT 'smg',created_by TEXT NOT NULL,created_at TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,UNIQUE(name_norm,college))`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT,details TEXT,ip TEXT,created_at TEXT NOT NULL)`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS idx_vouchers_college_date ON vouchers(college,date)`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS idx_vouchers_created_by ON vouchers(created_by)`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at)`)
  ]);
}

async function setupAdmin(env, body, ip) {
  if (!env.SMV_SETUP_KEY) bad('SMV_SETUP_KEY is not configured in Cloudflare environment.', 500);
  if (String(body.setupKey || '') !== String(env.SMV_SETUP_KEY)) bad('Invalid setup key', 403);
  const row = await env.DB.prepare('SELECT COUNT(*) c FROM users').first();
  if (Number(row?.c || 0) > 0) bad('Setup already completed', 409);
  const password = String(body.password || '');
  if (password.length < 8) bad('Admin password must be at least 8 characters');
  const hp = await hashPassword(password);
  await env.DB.prepare(`INSERT INTO users(username,password_salt,password_hash,role,status,college,created_at,updated_at) VALUES('admin',?,?, 'admin','active','smg',?,?)`).bind(hp.salt, hp.hash, now(), now()).run();
  await audit(env.DB, 'system', 'setup_admin', 'user', 'admin', 'Initial admin created', ip);
  return json({ ok:true });
}

async function login(env, body, ip) {
  const username = norm(body.username);
  const password = String(body.password || '');
  const user = await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username).first();
  if (!user) bad('Invalid credentials', 401);
  if (user.status !== 'active') bad('User is blocked. Contact admin.', 403);
  const ok = await verifyPassword(password, user.password_salt, user.password_hash);
  if (!ok) bad('Invalid credentials', 401);
  const token = randomToken();
  const exp = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions(token,username,expires_at,created_at) VALUES(?,?,?,?)').bind(token, username, exp, now()),
    env.DB.prepare('UPDATE users SET last_login=?,updated_at=? WHERE username=?').bind(now(), now(), username)
  ]);
  await audit(env.DB, username, 'login', 'user', username, 'Login successful', ip);
  return json({ token, user: publicUser(user) });
}

async function logout(DB, token) { if (token) await DB.prepare('DELETE FROM sessions WHERE token=?').bind(token).run(); return json({ ok:true }); }

async function requireSession(DB, token) {
  if (!token) bad('Login required', 401);
  const row = await DB.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.username=s.username WHERE s.token=? AND s.expires_at>?`).bind(token, now()).first();
  if (!row) bad('Session expired. Login again.', 401);
  if (row.status !== 'active') bad('User is blocked. Contact admin.', 403);
  return { user: row };
}

async function listVouchers(DB, user) {
  const sql = user.role === 'admin' ? 'SELECT * FROM vouchers WHERE deleted_at IS NULL ORDER BY date DESC,id DESC' : 'SELECT * FROM vouchers WHERE deleted_at IS NULL AND created_by=? ORDER BY date DESC,id DESC';
  const q = user.role === 'admin' ? DB.prepare(sql) : DB.prepare(sql).bind(user.username);
  const r = await q.all();
  return json({ vouchers: r.results || [] });
}

async function saveVoucher(DB, user, v, ip) {
  if (!v || typeof v !== 'object') bad('Invalid voucher');
  const id = Number(v.id || 0);
  const type = clean(v.type, 20);
  if (!['debit','onaccount','credit'].includes(type)) bad('Invalid voucher type');
  const row = {
    college: allowedCollege(user, v.college), type, date: clean(v.date, 20), head: clean(v.head, 250), ac_name: clean(v.ac_name, 250), received_from: clean(v.received_from, 250), paid_to: clean(v.paid_to, 250), towards: clean(v.towards, 500), amount: amount(v.amount), amt_words: clean(v.amt_words, 500), mode: clean(v.mode, 50), cheque: clean(v.cheque, 120), prep_by: clean(v.prep_by, 120), checked_by: clean(v.checked_by, 120), remarks: clean(v.remarks, 500)
  };
  if (!row.date || !row.head || !row.towards || !row.amount) bad('Date, head, towards and amount are required');
  if (id) {
    if (user.role !== 'admin') bad('Only admin can edit vouchers', 403);
    await DB.prepare(`UPDATE vouchers SET college=?,type=?,date=?,head=?,ac_name=?,received_from=?,paid_to=?,towards=?,amount=?,amt_words=?,mode=?,cheque=?,prep_by=?,checked_by=?,remarks=?,updated_by=?,updated_at=? WHERE id=? AND deleted_at IS NULL`).bind(row.college,row.type,row.date,row.head,row.ac_name,row.received_from,row.paid_to,row.towards,row.amount,row.amt_words,row.mode,row.cheque,row.prep_by,row.checked_by,row.remarks,user.username,now(),id).run();
    await audit(DB, user.username, 'update_voucher', 'voucher', String(id), JSON.stringify({ amount: row.amount, head: row.head }), ip);
    return json({ ok:true, id });
  }
  const ins = await DB.prepare(`INSERT INTO vouchers(college,type,date,head,ac_name,received_from,paid_to,towards,amount,amt_words,mode,cheque,prep_by,checked_by,remarks,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(row.college,row.type,row.date,row.head,row.ac_name,row.received_from,row.paid_to,row.towards,row.amount,row.amt_words,row.mode,row.cheque,row.prep_by,row.checked_by,row.remarks,user.username,now(),user.username,now()).run();
  const newId = ins.meta.last_row_id;
  const voucherNo = voucherNumber(row.college, row.type, newId);
  await DB.prepare('UPDATE vouchers SET voucher_no=? WHERE id=?').bind(voucherNo, newId).run();
  await audit(DB, user.username, 'create_voucher', 'voucher', String(newId), JSON.stringify({ voucherNo, amount: row.amount, head: row.head }), ip);
  return json({ ok:true, id:newId, voucher_no:voucherNo });
}

function voucherNumber(college, type, id) { const p = {debit:'DV',onaccount:'OA',credit:'CV'}[type] || 'VO'; return `${String(college || 'SMG').toUpperCase()}-${p}-${new Date().getFullYear()}-${String(id).padStart(5,'0')}`; }

async function deleteVoucher(DB, user, id, ip) {
  id = Number(id || 0); if (!id) bad('Invalid voucher id');
  await DB.prepare('UPDATE vouchers SET deleted_at=?,deleted_by=?,updated_by=?,updated_at=? WHERE id=? AND deleted_at IS NULL').bind(now(), user.username, user.username, now(), id).run();
  await audit(DB, user.username, 'delete_voucher', 'voucher', String(id), 'Soft delete', ip);
  return json({ ok:true });
}

async function listHeads(DB, user) {
  const q = user.role === 'admin' ? DB.prepare('SELECT * FROM account_heads WHERE active=1 ORDER BY name') : DB.prepare('SELECT * FROM account_heads WHERE active=1 AND college=? ORDER BY name').bind(user.college || 'smg');
  const r = await q.all();
  return json({ heads:r.results || [] });
}
async function addHead(DB, user, body, ip) {
  const name = clean(body.name, 250); if (!name) bad('Head name required');
  const type = ['debit','onaccount','credit','common'].includes(body.type) ? body.type : 'common';
  const college = allowedCollege(user, body.college);
  await DB.prepare('INSERT OR IGNORE INTO account_heads(name,name_norm,type,college,created_by,created_at,active) VALUES(?,?,?,?,?,?,1)').bind(name, norm(name), type, college, user.username, now()).run();
  await audit(DB, user.username, 'add_account_head', 'account_head', name, JSON.stringify({ type, college }), ip);
  return listHeads(DB, user);
}

async function listUsers(DB) { const r = await DB.prepare('SELECT username,role,status,college,created_at,updated_at,last_login FROM users ORDER BY username').all(); return json({ users:r.results || [] }); }
async function createUser(DB, actor, body, ip) {
  const username = norm(body.username); if (!/^[a-z0-9._-]{3,32}$/.test(username)) bad('Username must be 3-32 letters/numbers');
  const password = String(body.password || ''); if (password.length < 6) bad('Password must be at least 6 characters');
  const existing = await DB.prepare('SELECT username FROM users WHERE username=?').bind(username).first();
  if (existing) bad('Username already exists', 409);
  const role = body.role === 'admin' ? 'admin' : 'user';
  const college = clean(body.college || 'smg', 20);
  const hp = await hashPassword(password);
  await DB.prepare('INSERT INTO users(username,password_salt,password_hash,role,status,college,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(username,hp.salt,hp.hash,role,'active',college,now(),now()).run();
  await audit(DB, actor.username, 'create_user', 'user', username, JSON.stringify({ role, college }), ip);
  return json({ ok:true });
}
async function setUserStatus(DB, actor, body, ip) {
  const username = norm(body.username); const status = body.status === 'blocked' ? 'blocked' : 'active';
  if (username === 'admin') bad('Admin cannot be blocked');
  await DB.prepare('UPDATE users SET status=?,updated_at=? WHERE username=?').bind(status, now(), username).run();
  if (status === 'blocked') await DB.prepare('DELETE FROM sessions WHERE username=?').bind(username).run();
  await audit(DB, actor.username, 'set_user_status', 'user', username, status, ip);
  return json({ ok:true });
}
async function resetPassword(DB, actor, body, ip) {
  const username = norm(body.username); const password = String(body.password || '');
  if (password.length < 6) bad('Password must be at least 6 characters');
  const hp = await hashPassword(password);
  await DB.batch([DB.prepare('UPDATE users SET password_salt=?,password_hash=?,updated_at=? WHERE username=?').bind(hp.salt,hp.hash,now(),username), DB.prepare('DELETE FROM sessions WHERE username=?').bind(username)]);
  await audit(DB, actor.username, 'reset_password', 'user', username, 'Password reset and sessions revoked', ip);
  return json({ ok:true });
}
async function listAudit(DB) { const r = await DB.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500').all(); return json({ logs:r.results || [] }); }
async function audit(DB, actor, action, entityType, entityId, details, ip) { await DB.prepare('INSERT INTO audit_logs(actor,action,entity_type,entity_id,details,ip,created_at) VALUES(?,?,?,?,?,?,?)').bind(actor, action, entityType, entityId, details || '', ip || '', now()).run(); }

async function hashPassword(password, saltB64) {
  const enc = new TextEncoder();
  const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', hash:'SHA-256', salt, iterations:PBKDF2_ITERATIONS }, key, 256);
  return { salt: toB64(salt), hash: toB64(new Uint8Array(bits)) };
}
async function verifyPassword(password, salt, expected) { const hp = await hashPassword(password, salt); return safeEqual(hp.hash, expected); }
function safeEqual(a, b) { if (a.length !== b.length) return false; let out = 0; for (let i=0;i<a.length;i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i); return out === 0; }
function randomToken() { return toB64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, ''); }
function toB64(bytes) { let s=''; bytes.forEach(b=>s+=String.fromCharCode(b)); return btoa(s); }
function fromB64(str) { const bin = atob(str); const out = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i); return out; }
