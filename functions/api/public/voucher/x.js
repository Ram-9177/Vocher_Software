const SESSION_DAYS = 7;
const PBKDF2_ITERATIONS = 100000;
const LEGACY_SHA256 = 'legacy-sha256';
const API_VERSION = 'voucher-api-admin1-users-v6';

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

  if (action === 'health') return send({ ok: true, version: API_VERSION, db: !!env.DB });
  if (!env.DB) throwError('D1 binding DB missing. Binding name must be DB.', 500);

  await ensureSchema(env.DB);

  if (action === 'listAdmins') return await listAdmins(env.DB, body);
  if (action === 'signup') throwError('Public sign up is disabled. Only admin1 can create users.', 403);
  if (action === 'login') return await login(env.DB, request, body, ip);
  if (action === 'logout') return await logout(env.DB, request, body.token);

  const session = await requireSession(env.DB, request, body.token);
  if (action === 'validateSession') return send({ user: publicUser(session.user), version: API_VERSION });
  if (action === 'listVouchers') return await listVouchers(env.DB, session.user, body);
  if (action === 'saveVoucher') return await saveVoucher(env.DB, session.user, body.voucher, ip);
  if (action === 'deleteVoucher') return await adminOnly(session.user, function () { return deleteVoucher(env.DB, session.user, body.id, ip); });
  if (action === 'listHeads') return await listHeads(env.DB, session.user, body);
  if (action === 'addHead') return await addHead(env.DB, session.user, body, ip);
  if (action === 'listUsers') return await adminOnly(session.user, function () { return listUsers(env.DB); });
  if (action === 'createUser') return await adminOnly(session.user, function () { return createUser(env.DB, session.user, body, ip); });
  if (action === 'setUserStatus') return await adminOnly(session.user, function () { return setUserStatus(env.DB, session.user, body, ip); });
  if (action === 'resetPassword') return await adminOnly(session.user, function () { return resetUserPassword(env.DB, session.user, body, ip); });
  if (action === 'listAudit') return await adminOnly(session.user, function () { return listAudit(env.DB); });

  return send({ error: 'Unknown action', action: action, version: API_VERSION }, 400);
}

function send(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: safeStatus(status || 200),
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, headers || {})
  });
}
function safeStatus(status) { const n = Number(status); return Number.isInteger(n) && n >= 200 && n <= 599 ? n : 500; }
function throwError(message, status) { const e = new Error(message); e.status = status || 400; throw e; }
async function adminOnly(user, fn) { if (!user || user.role !== 'admin') throwError('Access denied. Only admin1 can do this.', 403); return await fn(); }
function now() { return new Date().toISOString(); }
function clean(v, max) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max || 2000); }
function norm(v) { return clean(v, 250).toLowerCase(); }
function amount(v) { return Math.round(Number(v || 0)); }
function actualUsername(name) { const u = norm(name); if (u === 'admin1') return 'admin'; if (u === 'admin2') return 'user2'; if (u === 'admin3') return 'user3'; return u; }
function uiUsername(name) { const u = norm(name); if (u === 'admin') return 'admin1'; if (u === 'user2') return 'admin2'; if (u === 'user3') return 'admin3'; return u; }
function publicUser(u) { return { username: uiUsername(u.username), role: u.role, status: u.status, college: u.college }; }
function allowedCollege(user, requested) { return user.role === 'admin' ? clean(requested || user.college || 'smg', 20) : clean(user.college || 'smg', 20); }
function cookieToken(request, bodyToken) { if (bodyToken) return String(bodyToken); const c = request.headers.get('cookie') || ''; const m = c.match(/(?:^|;\s*)SMV_SESSION=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }
function sessionCookie(token, maxAgeSeconds) { return 'SMV_SESSION=' + encodeURIComponent(token || '') + '; Path=/; Max-Age=' + Number(maxAgeSeconds || 0) + '; HttpOnly; Secure; SameSite=Lax'; }

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

async function listAdmins(DB, body) {
  const college = clean(body.college || 'smg', 20);
  const r = await DB.prepare("SELECT username,role,college,status FROM users WHERE status='active' ORDER BY username").all();
  const out = [];
  (r.results || []).forEach(function (u) { const mapped = uiUsername(u.username); if (mapped === 'admin1') out.push('admin1'); else if ((u.college || 'smg') === college && ['admin2','admin3'].indexOf(mapped) !== -1) out.push(mapped); });
  return send({ usernames: Array.from(new Set(out)), version: API_VERSION });
}
async function login(DB, request, body, ip) {
  const requested = norm(body.username);
  const candidates = Array.from(new Set([actualUsername(requested), requested]));
  let user = null;
  for (const c of candidates) { user = await DB.prepare('SELECT * FROM users WHERE username=?').bind(c).first(); if (user) break; }
  if (!user) throwError('No such account', 401);
  if (user.status !== 'active') throwError('User is blocked. Contact admin1.', 403);
  const ok = await verifyLogin(body, user);
  if (!ok) throwError('Invalid credentials', 401);
  const token = randomHex(32);
  const exp = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await DB.prepare('INSERT INTO sessions(token,username,expires_at,created_at) VALUES(?,?,?,?)').bind(token, user.username, exp, now()).run();
  await DB.prepare('UPDATE users SET last_login=?,updated_at=? WHERE username=?').bind(now(), now(), user.username).run();
  await audit(DB, user.username, 'login', 'user', user.username, 'Login successful', ip);
  return send({ token: token, user: publicUser(user), version: API_VERSION }, 200, { 'set-cookie': sessionCookie(token, SESSION_DAYS * 86400) });
}
async function verifyLogin(body, user) { const password = String(body.password || ''); const passwordHash = clean(body.passwordHash || '', 200); if (user.password_salt === LEGACY_SHA256) { if (passwordHash && safeEqual(passwordHash, user.password_hash)) return true; if (password) return safeEqual(await sha256Hex(password), user.password_hash); return false; } if (!password) return false; return await verifyPassword(password, user.password_salt, user.password_hash); }
async function logout(DB, request, bodyToken) { const token = cookieToken(request, bodyToken); if (token) await DB.prepare('DELETE FROM sessions WHERE token=?').bind(token).run(); return send({ ok: true, version: API_VERSION }, 200, { 'set-cookie': sessionCookie('', 0) }); }
async function requireSession(DB, request, bodyToken) { const token = cookieToken(request, bodyToken); if (!token) throwError('Login required', 401); const row = await DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.username=s.username WHERE s.token=? AND s.expires_at>?').bind(token, now()).first(); if (!row) throwError('Session expired. Login again.', 401); if (row.status !== 'active') throwError('User is blocked. Contact admin1.', 403); return { user: row }; }

async function listVouchers(DB, user, body) { const college = allowedCollege(user, body.college); const q = user.role === 'admin' ? DB.prepare('SELECT * FROM vouchers WHERE deleted_at IS NULL AND college=? ORDER BY date DESC,id DESC').bind(college) : DB.prepare('SELECT * FROM vouchers WHERE deleted_at IS NULL AND college=? AND created_by=? ORDER BY date DESC,id DESC').bind(college, user.username); const r = await q.all(); return send({ vouchers: (r.results || []).map(voucherToOld), version: API_VERSION }); }
function voucherToOld(v) { const dateISO = isoFromAny(v.date); return { id:Number(v.id||0), voucherNo:v.voucher_no||'', voucher_no:v.voucher_no||'', date:dmyFromIso(dateISO), dateISO:dateISO, type:v.type||'debit', college:v.college||'smg', head:v.head||'', acName:v.ac_name||'', ac_name:v.ac_name||'', receivedFrom:v.received_from||'', received_from:v.received_from||'', paidTo:v.paid_to||'', paid_to:v.paid_to||'', towards:v.towards||'', amount:Number(v.amount||0), amtWords:v.amt_words||'', amt_words:v.amt_words||'', mode:v.mode||'Cash', cheque:v.cheque||'', prepBy:v.prep_by||'', prep_by:v.prep_by||'', checkedBy:v.checked_by||'', checked_by:v.checked_by||'', remarks:v.remarks||'', createdBy:uiUsername(v.created_by||''), created_by:v.created_by||'', createdAt:v.created_at||'', created_at:v.created_at||'', _u:v.updated_at||v.created_at||'', party:v.paid_to||v.received_from||v.ac_name||'' }; }
function isoFromAny(s) { s = clean(s,20); if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const p=s.split('-'); if(p.length===3) return p[2]+'-'+p[1]+'-'+p[0]; return s || new Date().toISOString().slice(0,10); }
function dmyFromIso(s) { if(/^\d{4}-\d{2}-\d{2}$/.test(s)){ const p=s.split('-'); return p[2]+'-'+p[1]+'-'+p[0]; } return s; }
function normalizeVoucher(v,user) { const type=clean(v.type,20); if(['debit','onaccount','credit'].indexOf(type)===-1) throwError('Invalid voucher type',400); return { college:allowedCollege(user,v.college), type:type, date:isoFromAny(v.dateISO||v.date), head:clean(v.head,250), ac_name:clean(v.ac_name||v.acName,250), received_from:clean(v.received_from||v.receivedFrom,250), paid_to:clean(v.paid_to||v.paidTo,250), towards:clean(v.towards,500), amount:amount(v.amount), amt_words:clean(v.amt_words||v.amtWords,500), mode:clean(v.mode||'Cash',50), cheque:clean(v.cheque,120), prep_by:clean(v.prep_by||v.prepBy,120), checked_by:clean(v.checked_by||v.checkedBy,120), remarks:clean(v.remarks,500) }; }
async function saveVoucher(DB,user,v,ip) { if(!v||typeof v!=='object') throwError('Invalid voucher',400); const row=normalizeVoucher(v,user); if(!row.date||!row.head||!row.towards||!row.amount) throwError('Date, head, towards and amount are required',400); const id=Number(v.id||0), canUpdate=id>0&&id<100000000000; if(canUpdate){ if(user.role!=='admin') throwError('Only admin1 can edit vouchers',403); await DB.prepare('UPDATE vouchers SET college=?,type=?,date=?,head=?,ac_name=?,received_from=?,paid_to=?,towards=?,amount=?,amt_words=?,mode=?,cheque=?,prep_by=?,checked_by=?,remarks=?,updated_by=?,updated_at=? WHERE id=? AND deleted_at IS NULL').bind(row.college,row.type,row.date,row.head,row.ac_name,row.received_from,row.paid_to,row.towards,row.amount,row.amt_words,row.mode,row.cheque,row.prep_by,row.checked_by,row.remarks,user.username,now(),id).run(); await audit(DB,user.username,'update_voucher','voucher',String(id),JSON.stringify({amount:row.amount,head:row.head}),ip); return send({ok:true,id:id,version:API_VERSION}); } const ins=await DB.prepare('INSERT INTO vouchers(college,type,date,head,ac_name,received_from,paid_to,towards,amount,amt_words,mode,cheque,prep_by,checked_by,remarks,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(row.college,row.type,row.date,row.head,row.ac_name,row.received_from,row.paid_to,row.towards,row.amount,row.amt_words,row.mode,row.cheque,row.prep_by,row.checked_by,row.remarks,user.username,now(),user.username,now()).run(); const newId=ins.meta.last_row_id, voucherNo=voucherNumber(row.college,row.type,newId); await DB.prepare('UPDATE vouchers SET voucher_no=? WHERE id=?').bind(voucherNo,newId).run(); await audit(DB,user.username,'create_voucher','voucher',String(newId),JSON.stringify({voucherNo:voucherNo,amount:row.amount,head:row.head}),ip); return send({ok:true,id:newId,voucher_no:voucherNo,version:API_VERSION}); }
function voucherNumber(college,type,id){const p={debit:'DV',onaccount:'OA',credit:'CV'}[type]||'VO';return String(college||'SMG').toUpperCase()+'-'+p+'-'+new Date().getFullYear()+'-'+String(id).padStart(5,'0');}
async function deleteVoucher(DB,user,id,ip){id=Number(id||0);if(!id)throwError('Invalid voucher id',400);await DB.prepare('UPDATE vouchers SET deleted_at=?,deleted_by=?,updated_by=?,updated_at=? WHERE id=? AND deleted_at IS NULL').bind(now(),user.username,user.username,now(),id).run();await audit(DB,user.username,'delete_voucher','voucher',String(id),'Soft delete',ip);return send({ok:true,version:API_VERSION});}
async function listHeads(DB,user,body){const college=allowedCollege(user,body.college);const r=await DB.prepare('SELECT * FROM account_heads WHERE active=1 AND college=? ORDER BY name').bind(college).all();return send({heads:r.results||[],version:API_VERSION});}
async function addHead(DB,user,body,ip){const name=clean(body.name,250);if(!name)throwError('Head name required',400);const type=['debit','onaccount','credit','common'].indexOf(body.type)!==-1?body.type:'common';const college=allowedCollege(user,body.college);await DB.prepare('INSERT OR IGNORE INTO account_heads(name,name_norm,type,college,created_by,created_at,active) VALUES(?,?,?,?,?,?,1)').bind(name,norm(name),type,college,user.username,now()).run();await audit(DB,user.username,'add_account_head','account_head',name,JSON.stringify({type:type,college:college}),ip);return await listHeads(DB,user,body);}
async function listUsers(DB){const r=await DB.prepare('SELECT username,role,status,college,created_at,updated_at,last_login FROM users ORDER BY username').all();return send({users:(r.results||[]).map(function(u){return Object.assign({},u,{username:uiUsername(u.username)});}),version:API_VERSION});}
async function createUser(DB,actor,body,ip){const username=actualUsername(body.username);if(!/^[a-z0-9._-]{3,32}$/.test(username))throwError('Username must be 3-32 letters/numbers',400);if(username==='admin')throwError('admin1 already exists as the main admin.',400);const password=String(body.password||'');if(password.length<6)throwError('Password must be at least 6 characters',400);const existing=await DB.prepare('SELECT username FROM users WHERE username=?').bind(username).first();if(existing)throwError('Username already exists',409);const college=clean(body.college||actor.college||'smg',20),hp=await hashPassword(password);await DB.prepare('INSERT INTO users(username,password_salt,password_hash,role,status,college,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(username,hp.salt,hp.hash,'user','active',college,now(),now()).run();await audit(DB,actor.username,'create_user','user',username,JSON.stringify({role:'user',college:college}),ip);return send({ok:true,version:API_VERSION});}
async function resetUserPassword(DB,actor,body,ip){const username=actualUsername(body.username);if(!username)throwError('Username required',400);const password=String(body.password||'');if(password.length<6)throwError('Password must be at least 6 characters',400);const target=await DB.prepare('SELECT username FROM users WHERE username=?').bind(username).first();if(!target)throwError('User not found',404);const hp=await hashPassword(password);await DB.prepare('UPDATE users SET password_salt=?,password_hash=?,updated_at=? WHERE username=?').bind(hp.salt,hp.hash,now(),username).run();await DB.prepare('DELETE FROM sessions WHERE username=?').bind(username).run();await audit(DB,actor.username,'reset_user_password','user',username,'Password reset and sessions revoked',ip);return send({ok:true,version:API_VERSION});}
async function setUserStatus(DB,actor,body,ip){const username=actualUsername(body.username),status=body.status==='blocked'?'blocked':'active';if(username==='admin')throwError('admin1 cannot be blocked',400);await DB.prepare('UPDATE users SET status=?,updated_at=? WHERE username=?').bind(status,now(),username).run();if(status==='blocked')await DB.prepare('DELETE FROM sessions WHERE username=?').bind(username).run();await audit(DB,actor.username,'set_user_status','user',username,status,ip);return send({ok:true,version:API_VERSION});}
async function listAudit(DB){const r=await DB.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500').all();return send({logs:r.results||[],version:API_VERSION});}
async function audit(DB,actor,action,entityType,entityId,details,ip){await DB.prepare('INSERT INTO audit_logs(actor,action,entity_type,entity_id,details,ip,created_at) VALUES(?,?,?,?,?,?,?)').bind(actor||'system',action,entityType,entityId||'',details||'',ip||'',now()).run();}
async function hashPassword(password,saltB64){const enc=new TextEncoder();const salt=saltB64?fromB64(saltB64):crypto.getRandomValues(new Uint8Array(16));const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:salt,iterations:PBKDF2_ITERATIONS},key,256);return{salt:toB64(salt),hash:toB64(new Uint8Array(bits))};}
async function verifyPassword(password,salt,expected){const hp=await hashPassword(password,salt);return safeEqual(hp.hash,expected);}
async function sha256Hex(text){const enc=new TextEncoder();const buf=await crypto.subtle.digest('SHA-256',enc.encode(text));return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');}
function safeEqual(a,b){a=String(a||'');b=String(b||'');if(a.length!==b.length)return false;let out=0;for(let i=0;i<a.length;i++)out|=a.charCodeAt(i)^b.charCodeAt(i);return out===0;}
function randomHex(bytes){const a=crypto.getRandomValues(new Uint8Array(bytes));return Array.from(a).map(function(b){return b.toString(16).padStart(2,'0');}).join('');}
function toB64(bytes){let s='';bytes.forEach(function(b){s+=String.fromCharCode(b);});return btoa(s);}
function fromB64(str){const bin=atob(str);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;}
