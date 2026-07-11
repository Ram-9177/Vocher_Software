const SESSION_DAYS = 3650;
const PBKDF2_ITERATIONS = 100000;
const LEGACY_SHA256 = 'legacy-sha256';
const API_VERSION = 'voucher-api-admin1-users-v6';

// Permission constants
const VIEW_DASHBOARD = 'view_dashboard';
const VIEW_ANALYTICS = 'view_analytics';
const CREATE_VOUCHER = 'create_voucher';
const VIEW_OWN_VOUCHERS = 'view_own_vouchers';
const VIEW_ALL_VOUCHERS = 'view_all_vouchers';
const EDIT_VOUCHER = 'edit_voucher';
const DELETE_VOUCHER = 'delete_voucher';
const PRINT_VOUCHER = 'print_voucher';
const EXPORT_EXCEL = 'export_excel';
const CASH_BOOK = 'cash_book';
const LINK_EXCEL = 'link_excel';
const PRINTER_SETUP = 'printer_setup';
const ACCOUNT_HEADS = 'account_heads';
const CREATE_USERS = 'create_users';
const RESET_PASSWORDS = 'reset_passwords';
const BLOCK_USERS = 'block_users';
const CREATE_ADMIN = 'create_admin';
const MANAGE_PERMISSIONS = 'manage_permissions';
const MANAGE_COLLEGES = 'manage_colleges';
const CHANGE_ADMIN_KEY = 'change_admin_key';
const VIEW_AUDIT = 'view_audit';
const USERNAME_RE = /^[a-z0-9._@-]{1,64}$/;

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

  await ensureSchema(env.DB, env);

  if (action === 'listAdmins') return await listAdmins(env.DB, body);
  if (action === 'signup' || action === 'bootstrapAdmin') return await bootstrapAdmin(env.DB, body, ip);
  if (action === 'login') return await login(env.DB, request, body, ip);
  if (action === 'logout') return await logout(env.DB, request, body.token);

  const session = await requireSession(env.DB, request, body.token);
  const user = session.user;
  const isAdmin1 = user.username === 'admin';

  if (action === 'validateSession') return await validateSession(env.DB, session);
  if (action === 'changeOwnPassword') return await changeOwnPassword(env.DB, user, body, ip);
  if (Number(user.must_change_password || 0) === 1) {
    throwError('Password change required before continuing.', 403);
  }

  if (action === 'syncData') return await syncData(env.DB, user, body);

  if (action === 'listVouchers') {
    if (!isAdmin1 && !hasPermission(user, 'view_all_vouchers') && !hasPermission(user, 'view_own_vouchers')) {
      throwError('Access denied. Missing voucher view permission.', 403);
    }
    return await listVouchers(env.DB, user, body);
  }
  if (action === 'saveVoucher') {
    const v = body.voucher || {};
    const id = Number(v.id || 0);
    const canUpdate = id > 0 && id < 100000000000;
    if (canUpdate) {
      if (!isAdmin1 && !hasPermission(user, 'edit_voucher')) {
        throwError('Access denied. Missing edit_voucher permission.', 403);
      }
    } else {
      if (!isAdmin1 && !hasPermission(user, 'create_voucher')) {
        throwError('Access denied. Missing create_voucher permission.', 403);
      }
    }
    return await saveVoucher(env.DB, user, body.voucher, ip);
  }
  if (action === 'deleteVoucher') {
    if (!isAdmin1 && !hasPermission(user, 'delete_voucher')) {
      throwError('Access denied. Missing delete_voucher permission.', 403);
    }
    return await deleteVoucher(env.DB, user, body.id, ip);
  }
  if (action === 'listHeads') return await listHeads(env.DB, user, body);
  if (action === 'addHead') {
    if (!isAdmin1 && !hasPermission(user, 'account_heads')) {
      throwError('Access denied. Missing account_heads permission.', 403);
    }
    return await addHead(env.DB, user, body, ip);
  }
  if (action === 'listBlocks') return await listBlocks(env.DB, user, body);
  if (action === 'addBlock') {
    if (!isAdmin1 && !hasPermission(user, 'account_heads')) {
      throwError('Access denied. Missing block permission.', 403);
    }
    return await addBlock(env.DB, user, body, ip);
  }
  if (action === 'listUsers') {
    if (!isAdmin1 && !hasPermission(user, 'create_users') && !hasPermission(user, 'create_admin') && !hasPermission(user, 'manage_permissions') && !hasPermission(user, 'reset_passwords') && !hasPermission(user, 'block_users') && !hasPermission(user, 'manage_colleges') && !hasPermission(user, 'change_admin_key') && !hasPermission(user, 'view_audit')) {
      throwError('Access denied. Missing permissions.', 403);
    }
    return await listUsers(env.DB);
  }
  if (action === 'createUser') {
    const requestedRole = body.role === 'admin' ? 'admin' : 'user';
    if (!isAdmin1) {
      if (requestedRole === 'admin') {
        if (!hasPermission(user, 'create_admin')) {
          throwError('Access denied. Missing create_admin permission.', 403);
        }
      } else {
        if (!hasPermission(user, 'create_users')) {
          throwError('Access denied. Missing create_users permission.', 403);
        }
      }
    }
    return await createUser(env.DB, user, body, ip);
  }
  if (action === 'updateUserPermissions') {
    if (!isAdmin1) {
      if (!hasPermission(user, 'manage_permissions')) {
        throwError('Access denied. Missing manage_permissions permission.', 403);
      }
      if (body.role === 'admin' && !hasPermission(user, 'create_admin')) {
        throwError('Access denied. Missing create_admin permission to promote to admin.', 403);
      }
    }
    return await updateUserPermissions(env.DB, user, body, ip);
  }
  if (action === 'setUserStatus') {
    if (!isAdmin1 && !hasPermission(user, 'block_users')) {
      throwError('Access denied. Missing block_users permission.', 403);
    }
    return await setUserStatus(env.DB, user, body, ip);
  }
  if (action === 'resetPassword') {
    const target = actualUsername(body.username);
    if (target === 'admin') {
      if (!isAdmin1 && !hasPermission(user, 'change_admin_key')) {
        throwError('Access denied. Missing change_admin_key permission.', 403);
      }
    } else {
      if (!isAdmin1 && !hasPermission(user, 'reset_passwords')) {
        throwError('Access denied. Missing reset_passwords permission.', 403);
      }
    }
    return await resetUserPassword(env.DB, user, body, ip);
  }
  if (action === 'listAudit') {
    if (!isAdmin1 && !hasPermission(user, 'view_audit')) {
      throwError('Access denied. Missing view_audit permission.', 403);
    }
    return await listAudit(env.DB);
  }

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
function actualUsername(name) { const u = norm(name); if (u === 'admin' || u === 'admin1') return 'admin'; if (u === 'admin2') return 'user2'; if (u === 'admin3') return 'user3'; return u; }
function uiUsername(name) { const u = norm(name); if (u === 'admin') return 'admin1'; if (u === 'user2') return 'admin2'; if (u === 'user3') return 'admin3'; return u; }

function parsePerms(user) {
  if (user.username === 'admin') return ['*'];
  let permsStr = user.permissions || '';
  if (!permsStr) {
    permsStr = user.role === 'admin' ? 
      'view_dashboard,view_analytics,create_voucher,view_own_vouchers,view_all_vouchers,edit_voucher,print_voucher,export_excel,cash_book,link_excel,printer_setup,account_heads,create_users,reset_passwords,block_users' :
      'create_voucher,view_own_vouchers,print_voucher';
  }
  return permsStr.split(',').map(p => p.trim()).filter(Boolean);
}
function parseCollegeAccess(user) {
  if (user.username === 'admin') return ['*'];
  let accessStr = user.college_access || '';
  if (!accessStr) accessStr = user.college || 'smg';
  return accessStr.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
}
function hasPerm(user, perm) {
  if (user.username === 'admin') return true;
  return parsePerms(user).includes(perm);
}
function hasPermission(user, perm) { return hasPerm(user, perm); }
function need(user, permission) {
  if (!hasPerm(user, permission)) throwError('Access denied. Missing ' + permission, 403);
}
function needAny(user, permissions) {
  if (user.username === 'admin') return;
  const perms = parsePerms(user);
  if (!permissions.some(p => perms.includes(p))) throwError('Access denied. Missing required permissions.', 403);
}

function publicUser(u) {
  const isMain = u.username === 'admin';
  const allPerms = [
    'view_dashboard', 'view_analytics', 'create_voucher', 'view_own_vouchers', 'view_all_vouchers',
    'edit_voucher', 'delete_voucher', 'print_voucher', 'export_excel', 'cash_book', 'link_excel',
    'printer_setup', 'account_heads', 'create_users', 'reset_passwords', 'block_users', 'create_admin',
    'manage_permissions', 'manage_colleges', 'change_admin_key', 'view_audit'
  ].join(',');
  return {
    username: uiUsername(u.username),
    fullName: isMain ? 'Main Administrator' : (u.full_name || ''),
    role: u.role,
    status: u.status,
    college: u.college,
    collegeAccess: isMain ? '' : (u.college_access || ''),
    permissions: isMain ? allPerms : (u.permissions || ''),
    mustChangePassword: Number(u.must_change_password || 0) === 1
  };
}

function allowedCollege(user, requested) {
  const req = clean(requested || user.college || 'smg', 20);
  if (user.username === 'admin') return req;
  const allowed = parseCollegeAccess(user);
  if (!allowed.length) {
    const primary = clean(user.college || 'smg', 20);
    if (req !== primary) throwError('Access denied. College is outside your access.', 403);
    return primary;
  }
  if (!allowed.includes('*') && !allowed.includes(req)) throwError('Access denied. College is outside your access.', 403);
  return req;
}

function csvList(v) {
  return clean(v || '', 2000).split(',').map(function (p) { return p.trim(); }).filter(Boolean);
}
function assertPassword(password) {
  if (String(password || '').length < 6) throwError('Password must be at least 6 characters', 400);
}
function assertAssignableAccess(actor, role, college, collegeAccess, permissions) {
  if (actor.username === 'admin') return;
  const actorPerms = parsePerms(actor);
  const actorColleges = parseCollegeAccess(actor);
  const requestedColleges = Array.from(new Set([college].concat(csvList(collegeAccess || college)).filter(Boolean)));
  if (!actorColleges.includes('*')) {
    requestedColleges.forEach(function (c) {
      if (!actorColleges.includes(c)) throwError('Access denied. Cannot assign college outside your access.', 403);
    });
  }
  if (role === 'admin' && !actorPerms.includes('create_admin')) {
    throwError('Access denied. Missing create_admin permission.', 403);
  }
  csvList(permissions).forEach(function (p) {
    if (!actorPerms.includes(p)) throwError('Access denied. Cannot assign permission: ' + p, 403);
  });
}

function cookieToken(request, bodyToken) { if (bodyToken) return String(bodyToken); const c = request.headers.get('cookie') || ''; const m = c.match(/(?:^|;\s*)SMV_SESSION=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }
function sessionCookie(token, maxAgeSeconds) { return 'SMV_SESSION=' + encodeURIComponent(token || '') + '; Path=/; Max-Age=' + Number(maxAgeSeconds || 0) + '; HttpOnly; Secure; SameSite=Lax'; }

async function ensureSchema(DB, env) {
  await DB.prepare("CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','user')),status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','blocked')),college TEXT NOT NULL DEFAULT 'smg',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_login TEXT)").run();
  try { await DB.prepare("ALTER TABLE users ADD COLUMN full_name TEXT").run(); } catch(e) {}
  try { await DB.prepare("ALTER TABLE users ADD COLUMN permissions TEXT").run(); } catch(e) {}
  try { await DB.prepare("ALTER TABLE users ADD COLUMN college_access TEXT").run(); } catch(e) {}
  try { await DB.prepare("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0").run(); } catch(e) {}
  try { await DB.prepare("ALTER TABLE vouchers ADD COLUMN block TEXT").run(); } catch(e) {}
  await DB.prepare("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY,username TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL)").run();
  await DB.prepare("CREATE TABLE IF NOT EXISTS vouchers (id INTEGER PRIMARY KEY AUTOINCREMENT,voucher_no TEXT,college TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('debit','onaccount','credit')),date TEXT NOT NULL,head TEXT NOT NULL,ac_name TEXT,received_from TEXT,paid_to TEXT,towards TEXT NOT NULL,amount INTEGER NOT NULL,amt_words TEXT,mode TEXT,cheque TEXT,prep_by TEXT,checked_by TEXT,remarks TEXT,created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_by TEXT,updated_at TEXT NOT NULL,deleted_at TEXT,deleted_by TEXT)").run();
  await DB.prepare("CREATE TABLE IF NOT EXISTS account_heads (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,name_norm TEXT NOT NULL,type TEXT NOT NULL DEFAULT 'common',college TEXT NOT NULL DEFAULT 'smg',created_by TEXT NOT NULL,created_at TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,UNIQUE(name_norm,college))").run();
  await DB.prepare("CREATE TABLE IF NOT EXISTS blocks (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,name_norm TEXT NOT NULL,college TEXT NOT NULL DEFAULT 'smg',created_by TEXT NOT NULL,created_at TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,UNIQUE(name_norm,college))").run();
  await DB.prepare("CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT,details TEXT,ip TEXT,created_at TEXT NOT NULL)").run();
  await DB.prepare('CREATE INDEX IF NOT EXISTS idx_vouchers_college_date ON vouchers(college,date)').run();
  await DB.prepare('CREATE INDEX IF NOT EXISTS idx_vouchers_created_by ON vouchers(created_by)').run();
  await DB.prepare('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at)').run();
  const initialPassword = env && (env.ADMIN1_INITIAL_PASSWORD || env.ADMIN_BOOTSTRAP_PASSWORD);
  if (initialPassword) {
    const admin = await DB.prepare('SELECT username FROM users WHERE username=?').bind('admin').first();
    if (!admin) await createInitialAdmin(DB, String(initialPassword), '', 'smg', 'env-bootstrap', '');
  }
}

async function createInitialAdmin(DB, password, passwordHash, college, actor, ip) {
  if (String(password || '').length >= 6) {
    const hp = await hashPassword(String(password));
    await DB.prepare('INSERT INTO users(username,password_salt,password_hash,role,status,college,full_name,permissions,college_access,must_change_password,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind('admin',hp.salt,hp.hash,'admin','active',clean(college||'smg',20),'Main Administrator','*','*',0,now(),now()).run();
  } else if (passwordHash) {
    await DB.prepare('INSERT INTO users(username,password_salt,password_hash,role,status,college,full_name,permissions,college_access,must_change_password,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind('admin',LEGACY_SHA256,clean(passwordHash,200),'admin','active',clean(college||'smg',20),'Main Administrator','*','*',0,now(),now()).run();
  } else {
    throwError('Admin password must be at least 6 characters',400);
  }
  await audit(DB,actor||'system','bootstrap_admin','user','admin','Initial admin1 created',ip);
  return send({ok:true,user:'admin1',version:API_VERSION});
}

async function bootstrapAdmin(DB, body, ip) {
  const countRow = await DB.prepare('SELECT COUNT(*) AS c FROM users').first();
  if (Number((countRow && countRow.c) || 0) > 0) throwError('Public sign up is disabled. Only admin1 can create users.',403);
  const username = actualUsername(body.username);
  if (username !== 'admin') throwError('First account must be admin1.',400);
  return await createInitialAdmin(DB, String(body.password || ''), clean(body.passwordHash || '',200), body.college || 'smg', 'first-run', ip);
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
async function requireSession(DB, request, bodyToken) { const token = cookieToken(request, bodyToken); if (!token) throwError('Login required', 401); const row = await DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.username=s.username WHERE s.token=? AND s.expires_at>?').bind(token, now()).first(); if (!row) throwError('Session expired. Login again.', 401); if (row.status !== 'active') throwError('User is blocked. Contact admin1.', 403); return { user: row, token: token }; }
async function validateSession(DB, session){const exp=new Date(Date.now()+SESSION_DAYS*86400000).toISOString();await DB.prepare('UPDATE sessions SET expires_at=? WHERE token=?').bind(exp,session.token).run();return send({user:publicUser(session.user),version:API_VERSION},200,{'set-cookie':sessionCookie(session.token,SESSION_DAYS*86400)});}

async function listVouchers(DB, user, body) {
  const college = allowedCollege(user, body.college);
  const showAll = user.username === 'admin' || hasPermission(user, 'view_all_vouchers');
  const q = showAll ?
    DB.prepare('SELECT * FROM vouchers WHERE deleted_at IS NULL AND college=? ORDER BY date DESC,id DESC').bind(college) :
    DB.prepare('SELECT * FROM vouchers WHERE deleted_at IS NULL AND college=? AND created_by=? ORDER BY date DESC,id DESC').bind(college, user.username);
  const r = await q.all();
  return send({ vouchers: (r.results || []).map(voucherToOld), version: API_VERSION });
}
async function syncData(DB,user,body){
  const college=allowedCollege(user,body.college);
  const showAll=user.username==='admin'||hasPermission(user,'view_all_vouchers');
  const canView=showAll||hasPermission(user,'view_own_vouchers');
  const voucherRequest=!canView?Promise.resolve({results:[]}):(showAll?
    DB.prepare('SELECT * FROM vouchers WHERE deleted_at IS NULL AND college=? ORDER BY date DESC,id DESC').bind(college).all():
    DB.prepare('SELECT * FROM vouchers WHERE deleted_at IS NULL AND college=? AND created_by=? ORDER BY date DESC,id DESC').bind(college,user.username).all());
  const results=await Promise.all([
    voucherRequest,
    DB.prepare('SELECT * FROM account_heads WHERE active=1 AND college=? ORDER BY name').bind(college).all(),
    DB.prepare('SELECT * FROM blocks WHERE active=1 AND college=? ORDER BY name').bind(college).all()
  ]);
  let users;
  if(body.includeUsers&&(user.username==='admin'||['create_users','create_admin','manage_permissions','reset_passwords','block_users','manage_colleges','change_admin_key','view_audit'].some(function(permission){return hasPermission(user,permission);}))){
    const userRows=await DB.prepare('SELECT username,role,status,college,full_name,permissions,college_access,must_change_password,created_at,updated_at,last_login FROM users ORDER BY username').all();
    users=(userRows.results||[]).map(function(row){row.username=uiUsername(row.username);return row;});
  }
  return send({
    vouchers:(results[0].results||[]).map(voucherToOld),
    heads:results[1].results||[],
    blocks:results[2].results||[],
    user:publicUser(user),
    users:users,
    version:API_VERSION
  });
}
function voucherToOld(v) { const dateISO = isoFromAny(v.date); return { id:Number(v.id||0), voucherNo:v.voucher_no||'', voucher_no:v.voucher_no||'', date:dmyFromIso(dateISO), dateISO:dateISO, type:v.type||'debit', college:v.college||'smg', head:v.head||'', acName:v.ac_name||'', ac_name:v.ac_name||'', receivedFrom:v.received_from||'', received_from:v.received_from||'', paidTo:v.paid_to||'', paid_to:v.paid_to||'', towards:v.towards||'', block:v.block||'', amount:Number(v.amount||0), amtWords:v.amt_words||'', amt_words:v.amt_words||'', mode:v.mode||'Cash', cheque:v.cheque||'', prepBy:v.prep_by||'', prep_by:v.prep_by||'', checkedBy:v.checked_by||'', checked_by:v.checked_by||'', remarks:v.remarks||'', createdBy:uiUsername(v.created_by||''), created_by:v.created_by||'', createdAt:v.created_at||'', created_at:v.created_at||'', _u:v.updated_at||v.created_at||'', party:v.paid_to||v.received_from||v.ac_name||'' }; }
function isoFromAny(s) { s = clean(s,20); if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const p=s.split('-'); if(p.length===3) return p[2]+'-'+p[1]+'-'+p[0]; return s || new Date().toISOString().slice(0,10); }
function dmyFromIso(s) { if(/^\d{4}-\d{2}-\d{2}$/.test(s)){ const p=s.split('-'); return p[2]+'-'+p[1]+'-'+p[0]; } return s; }
function normalizeVoucher(v,user) { const type=clean(v.type,20); if(['debit','onaccount','credit'].indexOf(type)===-1) throwError('Invalid voucher type',400); return { college:allowedCollege(user,v.college), type:type, date:isoFromAny(v.dateISO||v.date), head:clean(v.head,250), ac_name:clean(v.ac_name||v.acName,250), received_from:clean(v.received_from||v.receivedFrom,250), paid_to:clean(v.paid_to||v.paidTo,250), towards:clean(v.towards,500), block:clean(v.block,250), amount:amount(v.amount), amt_words:clean(v.amt_words||v.amtWords,500), mode:clean(v.mode||'Cash',50), cheque:clean(v.cheque,120), prep_by:clean(v.prep_by||v.prepBy,120), checked_by:clean(v.checked_by||v.checkedBy,120), remarks:clean(v.remarks,500) }; }
async function saveVoucher(DB,user,v,ip) {
  if(!v||typeof v!=='object') throwError('Invalid voucher',400);
  const row=normalizeVoucher(v,user);
  if(!row.date||!row.head||!row.towards||!row.amount) throwError('Date, head, towards and amount are required',400);
  const id=Number(v.id||0), canUpdate=id>0&&id<100000000000;
  if(canUpdate){
    if(user.username!=='admin' && !hasPermission(user,'edit_voucher')) throwError('Only authorized users can edit vouchers',403);
    const existing=await getActiveVoucher(DB,id);
    ensureVoucherMutationAccess(user,existing);
    await DB.prepare('UPDATE vouchers SET college=?,type=?,date=?,head=?,ac_name=?,received_from=?,paid_to=?,towards=?,block=?,amount=?,amt_words=?,mode=?,cheque=?,prep_by=?,checked_by=?,remarks=?,updated_by=?,updated_at=? WHERE id=? AND deleted_at IS NULL AND college=?').bind(row.college,row.type,row.date,row.head,row.ac_name,row.received_from,row.paid_to,row.towards,row.block,row.amount,row.amt_words,row.mode,row.cheque,row.prep_by,row.checked_by,row.remarks,user.username,now(),id,existing.college).run();
    await audit(DB,user.username,'update_voucher','voucher',String(id),JSON.stringify({amount:row.amount,head:row.head}),ip);
    return send({ok:true,id:id,version:API_VERSION});
  }
  const ins=await DB.prepare('INSERT INTO vouchers(college,type,date,head,ac_name,received_from,paid_to,towards,block,amount,amt_words,mode,cheque,prep_by,checked_by,remarks,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(row.college,row.type,row.date,row.head,row.ac_name,row.received_from,row.paid_to,row.towards,row.block,row.amount,row.amt_words,row.mode,row.cheque,row.prep_by,row.checked_by,row.remarks,user.username,now(),user.username,now()).run();
  const newId=ins.meta.last_row_id, voucherNo=voucherNumber(row.college,row.type,newId);
  await DB.prepare('UPDATE vouchers SET voucher_no=? WHERE id=?').bind(voucherNo,newId).run();
  await audit(DB,user.username,'create_voucher','voucher',String(newId),JSON.stringify({voucherNo:voucherNo,amount:row.amount,head:row.head}),ip);
  return send({ok:true,id:newId,voucher_no:voucherNo,version:API_VERSION});
}
function voucherNumber(college,type,id){const p={debit:'DV',onaccount:'OA',credit:'CV'}[type]||'VO';return String(college||'SMG').toUpperCase()+'-'+p+'-'+new Date().getFullYear()+'-'+String(id).padStart(5,'0');}
async function getActiveVoucher(DB,id){const row=await DB.prepare('SELECT id,college,created_by FROM vouchers WHERE id=? AND deleted_at IS NULL').bind(id).first();if(!row)throwError('Voucher not found',404);return row;}
function ensureVoucherMutationAccess(user,v){const college=clean(v.college||'smg',20);if(allowedCollege(user,college)!==college)throwError('Access denied. Voucher is outside your college access.',403);if(user.username!=='admin'&&!hasPermission(user,'view_all_vouchers')&&v.created_by!==user.username)throwError('Access denied. You can only modify your own vouchers.',403);}
async function deleteVoucher(DB,user,id,ip){id=Number(id||0);if(!id)throwError('Invalid voucher id',400);const existing=await getActiveVoucher(DB,id);ensureVoucherMutationAccess(user,existing);await DB.prepare('UPDATE vouchers SET deleted_at=?,deleted_by=?,updated_by=?,updated_at=? WHERE id=? AND deleted_at IS NULL AND college=?').bind(now(),user.username,user.username,now(),id,existing.college).run();await audit(DB,user.username,'delete_voucher','voucher',String(id),'Soft delete',ip);return send({ok:true,version:API_VERSION});}
async function listHeads(DB,user,body){const college=allowedCollege(user,body.college);const r=await DB.prepare('SELECT * FROM account_heads WHERE active=1 AND college=? ORDER BY name').bind(college).all();return send({heads:r.results||[],version:API_VERSION});}
async function addHead(DB,user,body,ip){const name=clean(body.name,250);if(!name)throwError('Head name required',400);const type=['debit','onaccount','credit','common'].indexOf(body.type)!==-1?body.type:'common';const college=allowedCollege(user,body.college);await DB.prepare('INSERT OR IGNORE INTO account_heads(name,name_norm,type,college,created_by,created_at,active) VALUES(?,?,?,?,?,?,1)').bind(name,norm(name),type,college,user.username,now()).run();await audit(DB,user.username,'add_account_head','account_head',name,JSON.stringify({type:type,college:college}),ip);return await listHeads(DB,user,body);}

async function listBlocks(DB,user,body){const college=allowedCollege(user,body.college);const r=await DB.prepare('SELECT * FROM blocks WHERE active=1 AND college=? ORDER BY name').bind(college).all();return send({blocks:r.results||[],version:API_VERSION});}
async function addBlock(DB,user,body,ip){const name=clean(body.name,250);if(!name)throwError('Block name required',400);const college=allowedCollege(user,body.college);await DB.prepare('INSERT OR IGNORE INTO blocks(name,name_norm,college,created_by,created_at,active) VALUES(?,?,?,?,?,1)').bind(name,norm(name),college,user.username,now()).run();await audit(DB,user.username,'add_block','block',name,JSON.stringify({college:college}),ip);return await listBlocks(DB,user,body);}

async function listUsers(DB){
  const r=await DB.prepare('SELECT username,role,status,college,full_name,permissions,college_access,must_change_password,created_at,updated_at,last_login FROM users ORDER BY username').all();
  return send({users:(r.results||[]).map(function(u){
    return Object.assign({},u,{username:uiUsername(u.username)});
  }),version:API_VERSION});
}

async function createUser(DB,actor,body,ip){
  const username=actualUsername(body.username);
  if(!USERNAME_RE.test(username))throwError('Username must be 1-64 letters/numbers or . _ - @',400);
  if(username==='admin')throwError('admin1 already exists as the main admin.',400);
  const password=String(body.password||'Stmarys@1234');
  assertPassword(password);
  const existing=await DB.prepare('SELECT username FROM users WHERE username=?').bind(username).first();
  if(existing)throwError('Username already exists',409);
  const college=clean(body.college||actor.college||'smg',20),hp=await hashPassword(password);
  
  const role = body.role === 'admin' ? 'admin' : 'user';
  const fullName = clean(body.fullName || body.full_name || '', 200);
  
  let collegeAccess = clean(body.collegeAccess || body.college_access || '', 1000);
  if (!collegeAccess) collegeAccess = college;
  
  let permissions = clean(body.permissions || '', 2000);
  if (!permissions) {
    permissions = role === 'admin' ? 
      'view_dashboard,view_analytics,create_voucher,view_own_vouchers,view_all_vouchers,edit_voucher,print_voucher,export_excel,cash_book,link_excel,printer_setup,account_heads,create_users,reset_passwords,block_users' :
      'create_voucher,view_own_vouchers,print_voucher';
  }
  assertAssignableAccess(actor, role, college, collegeAccess, permissions);

  await DB.prepare('INSERT INTO users(username,password_salt,password_hash,role,status,college,full_name,permissions,college_access,must_change_password,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(username,hp.salt,hp.hash,role,'active',college,fullName,permissions,collegeAccess,1,now(),now()).run();
  await audit(DB,actor.username,'create_user','user',username,JSON.stringify({role:role,college:college}),ip);
  return send({ok:true,version:API_VERSION});
}

async function updateUserPermissions(DB,actor,body,ip){
  const username=actualUsername(body.username);
  if(!username)throwError('Username required',400);
  if(username==='admin')throwError('admin1 cannot be permission-reduced or modified.',400);
  const target=await DB.prepare('SELECT username, role FROM users WHERE username=?').bind(username).first();
  if(!target)throwError('User not found',404);
  
  const role=body.role==='admin'?'admin':'user';
  if (role === 'admin' && target.role !== 'admin' && actor.username !== 'admin' && !hasPermission(actor, 'create_admin')) {
    throwError('Access denied. Missing create_admin permission to promote to admin.', 403);
  }
  const fullName=clean(body.fullName||body.full_name||'',200);
  const college=clean(body.college||'smg',20);
  const collegeAccess=clean(body.collegeAccess||body.college_access||'',1000);
  const permissions=clean(body.permissions||'',2000);
  assertAssignableAccess(actor, role, college, collegeAccess || college, permissions);
  
  await DB.prepare('UPDATE users SET role=?,full_name=?,college=?,college_access=?,permissions=?,updated_at=? WHERE username=?').bind(role,fullName,college,collegeAccess,permissions,now(),username).run();
  await audit(DB,actor.username,'update_user_permissions','user',username,JSON.stringify({role,college,permissions}),ip);
  return send({ok:true,version:API_VERSION});
}

async function resetUserPassword(DB,actor,body,ip){
  const username=actualUsername(body.username);
  if(!username)throwError('Username required',400);
  const password=String(body.password||'');
  assertPassword(password);
  const target=await DB.prepare('SELECT username FROM users WHERE username=?').bind(username).first();
  if(!target)throwError('User not found',404);
  const hp=await hashPassword(password);
  const mustChange = username === 'admin' ? 0 : 1;
  await DB.prepare('UPDATE users SET password_salt=?,password_hash=?,must_change_password=?,updated_at=? WHERE username=?').bind(hp.salt,hp.hash,mustChange,now(),username).run();
  await DB.prepare('DELETE FROM sessions WHERE username=?').bind(username).run();
  await audit(DB,actor.username,'reset_user_password','user',username,'Password reset and sessions revoked',ip);
  return send({ok:true,version:API_VERSION});
}
async function changeOwnPassword(DB,user,body,ip){
  const password=String(body.password||body.newPassword||'');
  assertPassword(password);
  const hp=await hashPassword(password);
  await DB.prepare('UPDATE users SET password_salt=?,password_hash=?,must_change_password=0,updated_at=? WHERE username=?').bind(hp.salt,hp.hash,now(),user.username).run();
  await audit(DB,user.username,'change_own_password','user',user.username,'Password changed by user',ip);
  const fresh=await DB.prepare('SELECT * FROM users WHERE username=?').bind(user.username).first();
  return send({ok:true,user:publicUser(fresh||Object.assign({},user,{must_change_password:0})),version:API_VERSION});
}
async function setUserStatus(DB,actor,body,ip){
  const username=actualUsername(body.username),status=body.status==='blocked'?'blocked':'active';
  if(username==='admin')throwError('admin1 cannot be blocked',400);
  await DB.prepare('UPDATE users SET status=?,updated_at=? WHERE username=?').bind(status,now(),username).run();
  if(status==='blocked')await DB.prepare('DELETE FROM sessions WHERE username=?').bind(username).run();
  await audit(DB,actor.username,'set_user_status','user',username,status,ip);
  return send({ok:true,version:API_VERSION});
}
async function listAudit(DB){const r=await DB.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500').all();return send({logs:r.results||[],version:API_VERSION});}
async function audit(DB,actor,action,entityType,entityId,details,ip){await DB.prepare('INSERT INTO audit_logs(actor,action,entity_type,entity_id,details,ip,created_at) VALUES(?,?,?,?,?,?,?)').bind(actor||'system',action,entityType,entityId||'',details||'',ip||'',now()).run();}
async function hashPassword(password,saltB64){const enc=new TextEncoder();const salt=saltB64?fromB64(saltB64):crypto.getRandomValues(new Uint8Array(16));const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:salt,iterations:PBKDF2_ITERATIONS},key,256);return{salt:toB64(salt),hash:toB64(new Uint8Array(bits))};}
async function verifyPassword(password,salt,expected){const hp=await hashPassword(password,salt);return safeEqual(hp.hash,expected);}
async function sha256Hex(text){const enc=new TextEncoder();const buf=await crypto.subtle.digest('SHA-256',enc.encode(text));return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');}
function safeEqual(a,b){a=String(a||'');b=String(b||'');if(a.length!==b.length)return false;let out=0;for(let i=0;i<a.length;i++)out|=a.charCodeAt(i)^b.charCodeAt(i);return out===0;}
function randomHex(bytes){const a=crypto.getRandomValues(new Uint8Array(bytes));return Array.from(a).map(function(b){return b.toString(16).padStart(2,'0');}).join('');}
function toB64(bytes){let s='';bytes.forEach(function(b){s+=String.fromCharCode(b);});return btoa(s);}
function fromB64(str){const bin=atob(str);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;}
