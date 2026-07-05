const API_VERSION='college-management-v1';

export async function onRequest(context){
  const request=context.request;
  if(request.method==='OPTIONS')return new Response('',{status:204});
  if(request.method!=='POST')return send({error:'Method not allowed',version:API_VERSION},405);
  try{return await handle(context);}catch(err){return send({error:err&&err.message?String(err.message):'Server error',version:API_VERSION},err&&err.status?err.status:500);}
}

async function handle(context){
  const request=context.request;
  const env=context.env||{};
  const body=await request.json().catch(function(){return{};});
  const action=String(body.action||'');
  const ip=request.headers.get('cf-connecting-ip')||'';
  if(action==='health')return send({ok:true,version:API_VERSION,db:!!env.DB});
  if(!env.DB)throwError('D1 binding DB missing. Binding name must be DB.',500);
  await ensureSchema(env.DB);

  const session=await requireUser(env.DB,request,body.token);
  const user=session.user;
  const isAdmin1 = user.username === 'admin';

  if(action==='listColleges')return await listColleges(env.DB);
  if(action==='createCollege') {
    if (!isAdmin1 && !hasPermission(user, 'manage_colleges')) {
      throwError('Access denied. Missing manage_colleges permission.', 403);
    }
    return await createCollege(env.DB,user,body,ip);
  }
  if(action==='setCollegeStatus') {
    if (!isAdmin1 && !hasPermission(user, 'manage_colleges')) {
      throwError('Access denied. Missing manage_colleges permission.', 403);
    }
    return await setCollegeStatus(env.DB,user,body,ip);
  }
  return send({error:'Unknown action',action:action,version:API_VERSION},400);
}

function send(data,status){return new Response(JSON.stringify(data),{status:status||200,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function throwError(message,status){const e=new Error(message);e.status=status||400;throw e;}
function now(){return new Date().toISOString();}
function clean(v,max){return String(v==null?'':v).trim().replace(/\s+/g,' ').slice(0,max||1000);}
function norm(v){return clean(v,80).toLowerCase().replace(/[^a-z0-9_-]/g,'');}
function uiUsername(name){const u=String(name||'').toLowerCase();if(u==='admin')return'admin1';if(u==='user2')return'admin2';if(u==='user3')return'admin3';return u;}
function cookieToken(request,bodyToken){if(bodyToken)return String(bodyToken);const c=request.headers.get('cookie')||'';const m=c.match(/(?:^|;\s*)SMV_SESSION=([^;]+)/);return m?decodeURIComponent(m[1]):'';}

function hasPermission(user, perm) {
  if (user.username === 'admin') return true;
  if (!user.permissions) return false;
  const perms = user.permissions.split(',').map(p => p.trim()).filter(Boolean);
  return perms.includes(perm);
}

async function ensureSchema(DB){
  await DB.prepare("CREATE TABLE IF NOT EXISTS colleges (code TEXT PRIMARY KEY,name TEXT NOT NULL,location TEXT,logo_url TEXT,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)").run();
  await DB.prepare("CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT,details TEXT,ip TEXT,created_at TEXT NOT NULL)").run();
  await DB.prepare("INSERT OR IGNORE INTO colleges(code,name,location,logo_url,status,created_by,created_at,updated_at) VALUES('smg',?,'Guntur','','active','system',?,?)").bind("St. Mary's Group Of Institutions Guntur For Women",now(),now()).run();
  await DB.prepare("INSERT OR IGNORE INTO colleges(code,name,location,logo_url,status,created_by,created_at,updated_at) VALUES('smwec',?,'Budampadu','','active','system',?,?)").bind("St. Mary's Women's Engineering College",now(),now()).run();
}

async function requireUser(DB,request,bodyToken){
  const token=cookieToken(request,bodyToken);
  if(!token)throwError('Login required',401);
  const row=await DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.username=s.username WHERE s.token=? AND s.expires_at>?').bind(token,now()).first();
  if(!row)throwError('Session expired. Login again.',401);
  if(row.status!=='active')throwError('User is blocked. Contact admin1.',403);
  return{user:row};
}

async function listColleges(DB){
  const r=await DB.prepare('SELECT code,name,location,logo_url,status,created_by,created_at,updated_at FROM colleges ORDER BY name').all();
  return send({colleges:r.results||[],version:API_VERSION});
}
async function createCollege(DB,user,body,ip){
  const name=clean(body.name,160);
  let code=norm(body.code||name);
  const location=clean(body.location,160);
  const logoUrl=clean(body.logoUrl||body.logo_url,500);
  if(!name)throwError('College name required',400);
  if(!code)throwError('College code required',400);
  if(code.length<2||code.length>20)throwError('College code must be 2-20 characters',400);
  const existing=await DB.prepare('SELECT code FROM colleges WHERE code=?').bind(code).first();
  if(existing)throwError('College code already exists',409);
  await DB.prepare('INSERT INTO colleges(code,name,location,logo_url,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(code,name,location,logoUrl,'active',user.username,now(),now()).run();
  await audit(DB,user.username,'create_college','college',code,JSON.stringify({name:name,location:location}),ip);
  return await listColleges(DB);
}
async function setCollegeStatus(DB,user,body,ip){
  const code=norm(body.code);
  const status=body.status==='inactive'?'inactive':'active';
  if(!code)throwError('College code required',400);
  if(code==='smg')throwError('Main college cannot be disabled',400);
  await DB.prepare('UPDATE colleges SET status=?,updated_at=? WHERE code=?').bind(status,now(),code).run();
  await audit(DB,user.username,'set_college_status','college',code,status,ip);
  return await listColleges(DB);
}
async function audit(DB,actor,action,entityType,entityId,details,ip){
  await DB.prepare('INSERT INTO audit_logs(actor,action,entity_type,entity_id,details,ip,created_at) VALUES(?,?,?,?,?,?,?)').bind(actor||'system',action,entityType,entityId||'',details||'',ip||'',now()).run();
}
