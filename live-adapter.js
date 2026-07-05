(function(){
  'use strict';

  const API_URL = '/api/public/voucher/x';
  const USER_ALIAS = { admin:'admin1', admin1:'admin1', user2:'admin2', admin2:'admin2', user3:'admin3', admin3:'admin3' };

  injectResponsiveFixes();

  function token(){ return localStorage.getItem('smv_token') || ''; }
  function setToken(t){ if(t) localStorage.setItem('smv_token', t); else localStorage.removeItem('smv_token'); }
  function setAuthUser(u){ if(u) localStorage.setItem('smv_auth_user', JSON.stringify(u)); else localStorage.removeItem('smv_auth_user'); }
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

  async function cloud(action, payload){
    const body = Object.assign({}, payload || {}, { action: action, token: token() });
    const res = await fetch(API_URL, { method:'POST', credentials:'same-origin', headers:{ 'content-type':'application/json' }, body:JSON.stringify(body) });
    const json = await res.json().catch(function(){ return { error:'Invalid server response' }; });
    if(json && json.token) setToken(json.token);
    if(json && json.user) setAuthUser(json.user);
    if(!res.ok || json.error) throw new Error(json.error || ('HTTP '+res.status));
    return json;
  }
  window._api = cloud;
  try { _api = cloud; } catch(e) {}

  window._refreshCredentialsCache = async function(college){
    const c = college || CURRENT_COLLEGE || 'smg';
    if(!window._CRED_CACHE) window._CRED_CACHE = {};
    try{
      const j = await cloud('listAdmins', { college:c });
      const m = {};
      (j.usernames || []).forEach(function(u){ m[u] = '1'; });
      window._CRED_CACHE[c] = m;
      return m;
    }catch(e){
      return window._CRED_CACHE[c] || {};
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
    if(!ADMIN_ROLES[typed] && typed !== 'admin' && typed !== 'user2' && typed !== 'user3'){
      if(le){ le.textContent='Unknown username. Use admin1, admin2, or admin3.'; le.style.display='block'; }
      return;
    }
    const college = CURRENT_COLLEGE || 'smg';
    const hash = await _hashPassword(password);
    let ok = null, lastErr = null;
    for(const username of loginCandidates(typed)){
      try{ ok = await cloud('login', { college:college, username:username, password:password, passwordHash:hash }); break; }
      catch(e){ lastErr = e; }
    }
    if(!ok){
      const msg = (lastErr && lastErr.message) || '';
      if(/No such account/i.test(msg)){
        if(le){ le.textContent='No account for '+typed+'. Please sign up first.'; le.style.display='block'; }
        if(lh){ lh.textContent='Click "Sign Up" tab to create this account.'; lh.style.display='block'; }
      } else if(le){
        le.textContent = msg || 'Incorrect password. Please try again.';
        le.style.display='block';
      }
      return;
    }

    CU = uiUserCode(ok.user || typed);
    const a = ADMIN_ROLES[CU] || { label:CU };
    document.getElementById('CP').style.display='none';
    document.getElementById('LS').style.display='none';
    document.getElementById('APP').style.display='block';
    document.getElementById('UB').textContent=a.label;
    if(le) le.style.display='none';
    HOME_COLLEGE=CURRENT_COLLEGE || college;
    updateCollegeSwitchPill();
    await _loadVouchersFromCloud();
    setupRole();initApp();_updateXLPill();
    const cs=document.getElementById('f_college'); if(cs){ cs.value=CURRENT_COLLEGE||'smg'; cs.disabled=true; }
    try{
      sessionStorage.setItem('smv_sess_user',CU);
      sessionStorage.setItem('smv_sess_college',CURRENT_COLLEGE||'smg');
      sessionStorage.setItem('smv_sess_home',HOME_COLLEGE||CURRENT_COLLEGE||'smg');
    }catch(e){}
    _startLiveSync();
  };

  window.doSignup = async function(){
    const u=document.getElementById('SU').value;
    const p=document.getElementById('SP').value;
    const p2=document.getElementById('SP2').value;
    const se=document.getElementById('SE');
    se.style.display='none';
    if(!u){se.textContent='Please select a username.';se.style.display='block';return;}
    if(p.length<6){se.textContent='Password must be at least 6 characters.';se.style.display='block';return;}
    if(p!==p2){se.textContent='Passwords do not match.';se.style.display='block';return;}
    const college=CURRENT_COLLEGE||'smg';
    const hash=await _hashPassword(p);
    try{ await cloud('signup',{college,username:u,password:p,passwordHash:hash}); }
    catch(e){ se.textContent=e.message||'Sign up failed.'; se.style.display='block'; return; }
    await _refreshCredentialsCache(college);
    _toast('Account created! You can now sign in.','ok');
    document.getElementById('SP').value='';
    document.getElementById('SP2').value='';
    switchAuthTab('login');
    document.getElementById('LU').value=u;
  };

  window.doResetPassword = async function(){
    const college=CURRENT_COLLEGE||'smg';
    const u=document.getElementById('RU').value;
    const p=document.getElementById('RP').value;
    const p2=document.getElementById('RP2').value;
    const ap=document.getElementById('RAP').value;
    const re=document.getElementById('RE');
    const rh=document.getElementById('RH');
    re.style.display='none'; if(rh) rh.style.display='none';
    const creds=await _refreshCredentialsCache(college);
    if(!creds['admin1']){ re.textContent='No admin1 account exists at this institution. admin1 must sign up first before resetting any passwords.'; re.style.display='block';return; }
    if(!ADMIN_ROLES[u]){ re.textContent='Please select a valid admin username to reset.'; re.style.display='block';return; }
    if(!creds[u]){ re.textContent='No account for '+u+' at this institution. Please sign up first.'; re.style.display='block'; return; }
    if(p.length<6){ re.textContent='Password must be at least 6 characters.'; re.style.display='block'; return; }
    if(p!==p2){ re.textContent='Passwords do not match.'; re.style.display='block'; return; }
    const hash=await _hashPassword(p);
    const payload={college,username:u,password:p,passwordHash:hash};
    if(u!=='admin1'){
      if(!ap){ re.textContent="Enter admin1's current password to authorize this reset."; re.style.display='block'; return; }
      payload.authPassword=ap;
      payload.authHash=await _hashPassword(ap);
    }
    try{ await cloud('resetPassword',payload); }
    catch(e){ re.textContent=e.message||'Reset failed.'; re.style.display='block'; return; }
    _toast('Password reset successful for '+u+'.','ok');
    ['RAP','RP','RP2'].forEach(function(id){ const el=document.getElementById(id); if(el) el.value=''; });
    switchAuthTab('login');
    document.getElementById('LU').value=u;
  };

  const oldLogout = window.logout;
  window.logout = function(){
    try{ cloud('logout',{}).catch(function(){}); }catch(e){}
    setToken(''); setAuthUser(null);
    if(typeof oldLogout === 'function') return oldLogout();
  };

  window._loadVouchersFromCloud = async function(){
    const college=CURRENT_COLLEGE||'smg';
    try{
      const j=await cloud('listVouchers',{college});
      VS=Array.isArray(j.vouchers)?j.vouchers:[];
    }catch(e){
      console.error('listVouchers',e);
      if(/Login required|Session expired|Invalid session/i.test(e.message||'')){ window.logout(); }
    }
  };
  window._saveVoucherToCloud = async function(v){
    const college=CURRENT_COLLEGE||v.college||'smg';
    const j = await cloud('saveVoucher',{college,voucher:v});
    if(j && j.id) v.id = j.id;
    if(j && j.voucher_no) v.voucherNo = j.voucher_no;
    return j;
  };
  window._deleteVoucherFromCloud = async function(id){
    await cloud('deleteVoucher',{id});
  };
  window._startLiveSync=function(){
    _stopLiveSync();
    _LIVE_SIG=_vsSignature();
    _LIVE_TIMER=setInterval(async function(){
      if(!CU||!CURRENT_COLLEGE||document.hidden) return;
      try{
        const j=await cloud('listVouchers',{college:CURRENT_COLLEGE});
        const next=Array.isArray(j.vouchers)?j.vouchers:[];
        const nextSig=next.length+'|'+next.map(function(v){return v.id+':'+(v._u||v.dateISO||'');}).join(',');
        if(nextSig!==_LIVE_SIG){
          VS=next; _LIVE_SIG=nextSig;
          try{ if(typeof renderVT==='function') renderVT(); }catch(e){}
          try{ if(typeof renderDash==='function') renderDash(); }catch(e){}
          try{ if(typeof renderMyDash==='function') renderMyDash(); }catch(e){}
          try{ if(typeof renderMyVT==='function') renderMyVT(); }catch(e){}
        }
      }catch(e){}
    },3000);
  };

  function injectResponsiveFixes(){
    const css = '@media(max-width:900px){.body{display:block;min-height:auto}.tb{height:auto;min-height:56px;align-items:flex-start;gap:10px;flex-wrap:wrap;padding:.75rem 1rem}.tbl{min-width:0;flex:1}.tbl h2{font-size:14px}.tbl p{font-size:9px}.tbr{flex-wrap:wrap;justify-content:flex-end}.sb{position:relative;top:0;width:100%;height:auto;display:flex;overflow-x:auto;overflow-y:hidden;padding:.7rem;border-right:0;border-bottom:1px solid var(--G100);gap:8px}.ns{display:flex;align-items:center;gap:6px;flex-shrink:0}.ns p{display:none}.ni{width:auto;white-space:nowrap;margin:0;padding:8px 10px;font-size:12px}.mc{padding:1rem}.fr,.fr.t{grid-template-columns:1fr}.ag{grid-template-columns:1fr}.sg{grid-template-columns:repeat(2,minmax(130px,1fr))}.sb2{display:grid;grid-template-columns:1fr 1fr}.sb2 input{min-width:0}.md{max-width:96vw}.pv-wrap,.dv-print,.cv-print,.oa-print{width:100%;min-width:0}}@media(max-width:520px){#CP{padding:1rem}.cpc{width:min(320px,92vw)}.lc{padding:1.6rem 1.2rem}.sg{grid-template-columns:1fr}.sb2{grid-template-columns:1fr}.tb{padding:.65rem}.ubadge,.lobtn,.linkpill{font-size:10px}.btn{padding:7px 11px}th,td{padding:7px 8px;font-size:11.5px}}';
    const style = document.createElement('style');
    style.id = 'smv-live-responsive-css';
    style.textContent = css;
    document.head.appendChild(style);
  }
})();
