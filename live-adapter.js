(function(){
  'use strict';

  const API_URL = '/api/public/voucher/x';
  const USER_ALIAS = { admin:'admin1', admin1:'admin1', user2:'admin2', admin2:'admin2', user3:'admin3', admin3:'admin3' };

  injectResponsiveFixes();

  function token(){ return localStorage.getItem('smv_token') || ''; }
  function setToken(t){ if(t) localStorage.setItem('smv_token', t); else localStorage.removeItem('smv_token'); }
  function setAuthUser(u){ if(u) localStorage.setItem('smv_auth_user', JSON.stringify(u)); else localStorage.removeItem('smv_auth_user'); }
  function safeText(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }

  function uiUserCode(u){
    const name = String((u && u.username) || u || '').toLowerCase();
    if((u && u.role === 'admin') || name === 'admin' || name === 'admin1') return 'admin1';
    if(USER_ALIAS[name]) return USER_ALIAS[name];
    if(name.indexOf('3') > -1) return 'admin3';
    return 'admin2';
  }
  function loginCandidates(name){
    const n = String(name || '').trim().toLowerCase();
    if(n === 'admin1') return ['admin1','admin'];
    if(n === 'admin2') return ['admin2','user2'];
    if(n === 'admin3') return ['admin3','user3'];
    return [n];
  }
  function dmy(s){
    s = String(s || '');
    if(/^\d{4}-\d{2}-\d{2}$/.test(s)){ const p=s.split('-'); return p[2]+'-'+p[1]+'-'+p[0]; }
    return s;
  }
  function iso(s){
    s = String(s || '');
    if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const p=s.split('-');
    return p.length === 3 ? p[2]+'-'+p[1]+'-'+p[0] : s;
  }

  async function cloud(action, payload){
    const body = Object.assign({}, payload || {}, { action: action, token: token() });
    const res = await fetch(API_URL, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(body) });
    const json = await res.json().catch(function(){ return { error:'Invalid server response' }; });
    if(!res.ok || json.error) throw new Error(json.error || ('HTTP '+res.status));
    return json;
  }
  window._api = cloud;

  function apiToOld(v){
    const out = {
      id: Number(v.id || 0),
      voucherNo: v.voucher_no || v.voucherNo || '',
      date: dmy(v.date),
      dateISO: iso(v.date),
      type: v.type || 'debit',
      college: v.college || CURRENT_COLLEGE || 'smg',
      head: v.head || '',
      acName: v.ac_name || v.acName || '',
      receivedFrom: v.received_from || v.receivedFrom || '',
      paidTo: v.paid_to || v.paidTo || '',
      towards: v.towards || '',
      amount: Number(v.amount || 0),
      amtWords: v.amt_words || v.amtWords || '',
      mode: v.mode || 'Cash',
      cheque: v.cheque || '',
      prepBy: v.prep_by || v.prepBy || '',
      checkedBy: v.checked_by || v.checkedBy || '',
      remarks: v.remarks || '',
      createdBy: uiUserCode(v.created_by || v.createdBy || ''),
      createdAt: v.created_at || v.createdAt || '',
      _u: v.updated_at || v.created_at || ''
    };
    out.party = out.paidTo || out.receivedFrom || out.acName || '';
    return out;
  }
  function oldToApi(v){
    return {
      id: v.id && String(v.id).length < 12 ? Number(v.id) : 0,
      college: CURRENT_COLLEGE || v.college || 'smg',
      type: v.type || CVT || 'debit',
      date: iso(v.dateISO || v.date),
      head: v.head || '',
      ac_name: v.acName || '',
      received_from: v.receivedFrom || '',
      paid_to: v.paidTo || '',
      towards: v.towards || '',
      amount: Math.round(Number(v.amount || 0)),
      amt_words: v.amtWords || '',
      mode: v.mode || 'Cash',
      cheque: v.cheque || '',
      prep_by: v.prepBy || '',
      checked_by: v.checkedBy || '',
      remarks: v.remarks || ''
    };
  }

  async function syncHeads(){
    try{
      const j = await cloud('listHeads', { college: CURRENT_COLLEGE || 'smg' });
      (j.heads || []).forEach(function(h){
        const name = h && h.name;
        if(name && Array.isArray(HEADS) && !HEADS.some(function(x){ return String(x).toLowerCase() === String(name).toLowerCase(); })) HEADS.push(name);
      });
      if(typeof populateHeads === 'function') populateHeads();
      if(typeof populateMyHeads === 'function') populateMyHeads();
      const dl = document.getElementById('DL_HEADS');
      if(dl) dl.innerHTML = HEADS.map(function(h){ return '<option value="'+String(h).replace(/"/g,'&quot;')+'"></option>'; }).join('');
    }catch(e){ console.warn('head sync', e); }
  }

  // Old code uses this while switching Login/Signup/Reset and session restore.
  // It must NOT redirect the user away from the login screen when there is no token.
  window._refreshCredentialsCache = async function(college){
    const c = college || CURRENT_COLLEGE || 'smg';
    if(!window._CRED_CACHE) window._CRED_CACHE = {};
    if(!token()) { window._CRED_CACHE[c] = window._CRED_CACHE[c] || {}; return window._CRED_CACHE[c]; }
    try{
      const j = await cloud('validateSession', {});
      const code = uiUserCode(j.user);
      const m = {}; m[code] = '1';
      window._CRED_CACHE[c] = m;
      return m;
    }catch(e){
      setToken(''); setAuthUser(null);
      window._CRED_CACHE[c] = window._CRED_CACHE[c] || {};
      return window._CRED_CACHE[c];
    }
  };

  window.doLogin = async function(){
    const typed = document.getElementById('LU').value.trim().toLowerCase();
    const password = document.getElementById('LP').value;
    const le = document.getElementById('LE');
    const lh = document.getElementById('LH');
    if(le) le.style.display = 'none';
    if(lh) lh.style.display = 'none';
    if(!typed || !password){ if(le){ le.textContent='Enter username and password.'; le.style.display='block'; } return; }

    let ok = null, lastErr = null;
    for(const username of loginCandidates(typed)){
      try{ ok = await cloud('login', { username: username, password: password }); break; }
      catch(e){ lastErr = e; }
    }
    if(!ok){ if(le){ le.textContent = (lastErr && lastErr.message) || 'Invalid credentials. Please try again.'; le.style.display='block'; } return; }

    setToken(ok.token);
    setAuthUser(ok.user);
    CU = uiUserCode(ok.user);
    CURRENT_COLLEGE = (ok.user && ok.user.college) || CURRENT_COLLEGE || 'smg';
    HOME_COLLEGE = CURRENT_COLLEGE;

    const cp = document.getElementById('CP'); if(cp) cp.style.display='none';
    const ls = document.getElementById('LS'); if(ls) ls.style.display='none';
    const app = document.getElementById('APP'); if(app) app.style.display='block';
    const ub = document.getElementById('UB'); if(ub) ub.textContent = (ADMIN_ROLES[CU] || {label:(ok.user && ok.user.username) || CU}).label;

    updateCollegeSwitchPill();
    await syncHeads();
    await _loadVouchersFromCloud();
    setupRole();
    installUserManagement();
    initApp();
    _updateXLPill();
    const cs=document.getElementById('f_college'); if(cs){ cs.value=CURRENT_COLLEGE||'smg'; cs.disabled=true; }
    try{
      sessionStorage.setItem('smv_sess_user', CU);
      sessionStorage.setItem('smv_sess_college', CURRENT_COLLEGE || 'smg');
      sessionStorage.setItem('smv_sess_home', CURRENT_COLLEGE || 'smg');
    }catch(e){}
    _startLiveSync();
  };

  window.doSignup = function(){
    const se = document.getElementById('SE');
    if(se){ se.textContent = 'Live version uses Admin-created users only. Login as admin and open User Management.'; se.style.display='block'; }
  };
  window.doResetPassword = function(){
    const re = document.getElementById('RE');
    if(re){ re.textContent = 'Live version password reset is inside User Management after admin login.'; re.style.display='block'; }
  };
  window.logout = function(){
    CU = null; HOME_COLLEGE = null; setToken(''); setAuthUser(null); _stopLiveSync();
    try{ sessionStorage.removeItem('smv_sess_user'); sessionStorage.removeItem('smv_sess_college'); sessionStorage.removeItem('smv_sess_home'); sessionStorage.removeItem('smv_sess_page'); }catch(e){}
    const app=document.getElementById('APP'); if(app) app.style.display='none';
    const ls=document.getElementById('LS'); if(ls) ls.style.display='none';
    const lu=document.getElementById('LU'); if(lu) lu.value='';
    const lp=document.getElementById('LP'); if(lp) lp.value='';
    backToPicker();
  };

  window._loadVouchersFromCloud = async function(){
    try{
      const j = await cloud('listVouchers', { college: CURRENT_COLLEGE || 'smg' });
      VS = (Array.isArray(j.vouchers) ? j.vouchers : []).map(apiToOld);
    }catch(e){
      console.error('listVouchers', e);
      if(String(e.message || '').match(/Login required|Session expired/)) window.logout();
    }
  };

  async function maybeAddHead(v){
    const name = String(v.head || '').trim();
    if(!name) return;
    const exists = HEADS.some(function(h){ return String(h).trim().toLowerCase() === name.toLowerCase(); });
    if(exists) return;
    if(confirm('"'+name+'" is not in the dropdown. Do you want to add it and sync for all users?')){
      try{
        await cloud('addHead', { name:name, type:v.type || 'common', college:CURRENT_COLLEGE || v.college || 'smg' });
        if(!HEADS.some(function(h){ return String(h).trim().toLowerCase() === name.toLowerCase(); })) HEADS.push(name);
        await syncHeads();
      }catch(e){ _toast('Head sync failed: '+(e.message || ''), 'err'); }
    }
  }
  window._saveVoucherToCloud = async function(v){
    await maybeAddHead(v);
    const payload = oldToApi(v);
    const j = await cloud('saveVoucher', { college:payload.college, voucher:payload });
    if(j && j.id){ v.id = j.id; v.voucherNo = j.voucher_no || v.voucherNo || ''; }
    v.createdBy = CU;
    v._u = new Date().toISOString();
    return j;
  };
  window._deleteVoucherFromCloud = async function(id){
    try{ await cloud('deleteVoucher', { id:id }); }
    catch(e){ console.error('deleteVoucher', e); _toast('Delete failed: '+(e.message || ''), 'err'); }
  };
  window._startLiveSync = function(){
    _stopLiveSync();
    _LIVE_SIG = _vsSignature();
    _LIVE_TIMER = setInterval(async function(){
      if(!CU || !token() || document.hidden) return;
      try{
        const j = await cloud('listVouchers', { college: CURRENT_COLLEGE || 'smg' });
        const next = (Array.isArray(j.vouchers) ? j.vouchers : []).map(apiToOld);
        const sig = next.length + '|' + next.map(function(v){ return v.id+':'+(v._u || v.dateISO || ''); }).join(',');
        if(sig !== _LIVE_SIG){
          VS = next; _LIVE_SIG = sig;
          try{ renderVT(); }catch(e){}
          try{ renderDash(); }catch(e){}
          try{ renderMyDash(); }catch(e){}
          try{ renderMyVT(); }catch(e){}
        }
      }catch(e){}
    }, 5000);
  };

  const oldShow = window.show;
  window.show = function(id){
    if(typeof oldShow === 'function') oldShow(id);
    if(id === 'users') renderUsersLive();
  };

  function installUserManagement(){
    if(document.getElementById('sec-users')) return;
    const nav = document.getElementById('A1NAV');
    if(nav && !document.getElementById('ni-users')){
      const btn = document.createElement('button');
      btn.className = 'ni'; btn.id = 'ni-users'; btn.onclick = function(){ show('users'); };
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>User Management';
      nav.appendChild(btn);
    }
    const mc = document.querySelector('.mc');
    if(mc && !document.getElementById('sec-users')){
      const sec = document.createElement('div');
      sec.className = 'sec'; sec.id = 'sec-users';
      sec.innerHTML = '<div class="ph"><h1>User Management</h1><p>Create users, reset passwords, and block/unblock access</p></div>'+
        '<div class="card"><div class="ch"><span class="ct">Create User</span></div>'+
        '<div class="fr t"><div class="fi"><label>Username</label><input id="LIVE_NEW_USER" placeholder="user2"></div><div class="fi"><label>Password</label><input id="LIVE_NEW_PASS" type="password" placeholder="New password"></div><div class="fi"><label>Role</label><select id="LIVE_NEW_ROLE"><option value="user">User</option><option value="admin">Admin</option></select></div></div>'+
        '<div class="fr"><div class="fi"><label>College</label><select id="LIVE_NEW_COLLEGE"><option value="smg">SMG</option><option value="smwec">SMWEC</option></select></div><div class="fi" style="display:flex;align-items:end"><button class="btn bp" onclick="createUserLive()">Create User</button></div></div></div>'+
        '<div class="card"><div class="ch"><span class="ct">Users</span><button class="btn bs bsm" onclick="renderUsersLive()">↺ Refresh</button></div><div class="twrap"><table><thead><tr><th>Username</th><th>Role</th><th>Status</th><th>College</th><th>Last Login</th><th>Actions</th></tr></thead><tbody id="LIVE_USERS_BODY"></tbody></table></div></div>';
      mc.appendChild(sec);
    }
  }

  window.renderUsersLive = async function(){
    const body = document.getElementById('LIVE_USERS_BODY');
    if(!body) return;
    body.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';
    try{
      const j = await cloud('listUsers', {});
      const users = Array.isArray(j.users) ? j.users : [];
      body.innerHTML = users.map(function(u){
        const user = safeText(u.username);
        const nextStatus = u.status === 'active' ? 'blocked' : 'active';
        return '<tr><td><strong>'+user+'</strong></td><td>'+safeText(u.role)+'</td><td><span class="badge '+(u.status==='active'?'bj':'br')+'">'+safeText(u.status)+'</span></td><td>'+safeText(String(u.college||'').toUpperCase())+'</td><td>'+(u.last_login?new Date(u.last_login).toLocaleString('en-IN'):'—')+'</td><td><div class="bg-btn" style="margin-top:0"><button class="btn bs bsm" onclick="resetUserLive(\''+user+'\')">Reset</button>'+(u.username==='admin'?'':'<button class="btn '+(u.status==='active'?'br':'bp')+' bsm" onclick="toggleUserLive(\''+user+'\',\''+nextStatus+'\')">'+(u.status==='active'?'Block':'Activate')+'</button>')+'</div></td></tr>';
      }).join('') || '<tr><td colspan="6">No users</td></tr>';
    }catch(e){ body.innerHTML = '<tr><td colspan="6">'+safeText(e.message || 'Unable to load users')+'</td></tr>'; }
  };
  window.createUserLive = async function(){
    const u = document.getElementById('LIVE_NEW_USER').value.trim().toLowerCase();
    const p = document.getElementById('LIVE_NEW_PASS').value;
    const role = document.getElementById('LIVE_NEW_ROLE').value;
    const college = document.getElementById('LIVE_NEW_COLLEGE').value;
    if(!u || !p){ alert('Enter username and password.'); return; }
    try{
      await cloud('createUser', { username:u, password:p, role:role, college:college });
      _toast('User created: '+u, 'ok');
      document.getElementById('LIVE_NEW_USER').value='';
      document.getElementById('LIVE_NEW_PASS').value='';
      await renderUsersLive();
    }catch(e){ alert(e.message || 'Create user failed'); }
  };
  window.toggleUserLive = async function(username, status){
    if(!confirm('Set '+username+' as '+status+'?')) return;
    try{ await cloud('setUserStatus', { username:username, status:status }); await renderUsersLive(); }
    catch(e){ alert(e.message || 'Status update failed'); }
  };
  window.resetUserLive = async function(username){
    const p = prompt('New password for '+username+':');
    if(!p) return;
    try{ await cloud('resetPassword', { username:username, password:p }); _toast('Password reset for '+username, 'ok'); }
    catch(e){ alert(e.message || 'Password reset failed'); }
  };

  document.addEventListener('DOMContentLoaded', function(){
    installUserManagement();
    const lu = document.getElementById('LU'); if(lu) lu.placeholder = 'admin / user2 / user3';
    const lh = document.getElementById('LH'); if(lh) lh.textContent = 'Live users are managed by Admin only.';
  });

  function injectResponsiveFixes(){
    const css = '@media(max-width:900px){.body{display:block;min-height:auto}.tb{height:auto;min-height:56px;align-items:flex-start;gap:10px;flex-wrap:wrap;padding:.75rem 1rem}.tbl{min-width:0;flex:1}.tbl h2{font-size:14px}.tbl p{font-size:9px}.tbr{flex-wrap:wrap;justify-content:flex-end}.sb{position:relative;top:0;width:100%;height:auto;display:flex;overflow-x:auto;overflow-y:hidden;padding:.7rem;border-right:0;border-bottom:1px solid var(--G100);gap:8px}.ns{display:flex;align-items:center;gap:6px;flex-shrink:0}.ns p{display:none}.ni{width:auto;white-space:nowrap;margin:0;padding:8px 10px;font-size:12px}.mc{padding:1rem}.fr,.fr.t{grid-template-columns:1fr}.ag{grid-template-columns:1fr}.sg{grid-template-columns:repeat(2,minmax(130px,1fr))}.sb2{display:grid;grid-template-columns:1fr 1fr}.sb2 input{min-width:0}.md{max-width:96vw}.pv-wrap,.dv-print,.cv-print,.oa-print{width:100%;min-width:0}}@media(max-width:520px){#CP{padding:1rem}.cpc{width:min(320px,92vw)}.lc{padding:1.6rem 1.2rem}.sg{grid-template-columns:1fr}.sb2{grid-template-columns:1fr}.tb{padding:.65rem}.ubadge,.lobtn,.linkpill{font-size:10px}.btn{padding:7px 11px}th,td{padding:7px 8px;font-size:11.5px}}';
    const style = document.createElement('style');
    style.id = 'smv-live-responsive-css';
    style.textContent = css;
    document.head.appendChild(style);
  }
})();
