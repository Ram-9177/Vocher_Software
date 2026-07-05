(function(){
  'use strict';

  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);});}
  function tok(){return localStorage.getItem('smv_token')||'';}
  function setTok(t){if(t)localStorage.setItem('smv_token',t);else localStorage.removeItem('smv_token');}
  function uiCode(u){const n=String((u&&u.username)||u||'').toLowerCase();if((u&&u.role==='admin')||n==='admin'||n==='admin1')return'admin1';if(n==='user3'||n==='admin3')return'admin3';return'admin2';}
  function loginNames(n){n=String(n||'').trim().toLowerCase();if(n==='admin1')return['admin1','admin'];if(n==='admin2')return['admin2','user2'];if(n==='admin3')return['admin3','user3'];return[n];}
  async function api(action,payload){
    const body=Object.assign({},payload||{},{action:action,token:tok()});
    const r=await fetch('/api/public/voucher/x',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json().catch(function(){return{error:'Invalid server response'};});
    if(j&&j.token)setTok(j.token);
    if(!r.ok||j.error)throw new Error(j.error||('HTTP '+r.status));
    return j;
  }

  function hideAuth(){
    ['TAB_SIGNUP','TAB_RESET','PANEL_SIGNUP','PANEL_RESET'].forEach(function(id){const el=document.getElementById(id);if(el)el.style.display='none';});
    const t=document.getElementById('TAB_LOGIN');if(t){t.style.flex='1';t.style.width='100%';t.textContent='Sign In';}
    const lu=document.getElementById('LU');if(lu)lu.placeholder='admin1 / user2 / user3 / staff username';
    const lh=document.getElementById('LH');if(lh){lh.textContent='Users are created by admin1 only.';lh.style.display='block';}
  }

  window.doSignup=function(){alert('Public Sign Up is disabled. admin1 will create users from User Management.');switchAuthTab('login');};
  window.doResetPassword=function(){alert('Credential reset is available only inside admin1 User Management.');switchAuthTab('login');};

  window.doLogin=async function(){
    const typed=document.getElementById('LU').value.trim().toLowerCase();
    const password=document.getElementById('LP').value;
    const le=document.getElementById('LE'), lh=document.getElementById('LH');
    if(le)le.style.display='none'; if(lh)lh.style.display='none';
    if(!typed||!password){if(le){le.textContent='Enter username and password.';le.style.display='block';}return;}
    const college=CURRENT_COLLEGE||'smg';
    const hash=await _hashPassword(password);
    let ok=null,last=null;
    for(const username of loginNames(typed)){
      try{ok=await api('login',{college:college,username:username,password:password,passwordHash:hash});break;}catch(e){last=e;}
    }
    if(!ok){
      const msg=(last&&last.message)||'';
      if(le){le.textContent=/No such account/i.test(msg)?'No account found. Contact admin1 to create user.':(msg||'Incorrect password. Please try again.');le.style.display='block';}
      return;
    }
    CU=uiCode(ok.user||typed);
    const a=ADMIN_ROLES[CU]||{label:(ok.user&&ok.user.username)||typed};
    document.getElementById('CP').style.display='none';
    document.getElementById('LS').style.display='none';
    document.getElementById('APP').style.display='block';
    document.getElementById('UB').textContent=a.label;
    HOME_COLLEGE=CURRENT_COLLEGE||college;
    updateCollegeSwitchPill();
    installAdminUsers();
    await _loadVouchersFromCloud();
    setupRole();initApp();_updateXLPill();
    const cs=document.getElementById('f_college');if(cs){cs.value=CURRENT_COLLEGE||'smg';cs.disabled=true;}
    try{sessionStorage.setItem('smv_sess_user',CU);sessionStorage.setItem('smv_sess_college',CURRENT_COLLEGE||'smg');sessionStorage.setItem('smv_sess_home',HOME_COLLEGE||CURRENT_COLLEGE||'smg');}catch(e){}
    _startLiveSync();
  };

  const oldShow=window.show;
  window.show=function(id){if(typeof oldShow==='function')oldShow(id);if(id==='users')renderUsersLive();};

  function installAdminUsers(){
    const nav=document.getElementById('A1NAV');
    if(nav&&!document.getElementById('ni-users')){
      const btn=document.createElement('button');btn.className='ni';btn.id='ni-users';btn.onclick=function(){show('users');};
      btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>User Management';
      nav.appendChild(btn);
    }
    const mc=document.querySelector('.mc');
    if(mc&&!document.getElementById('sec-users')){
      const sec=document.createElement('div');sec.className='sec';sec.id='sec-users';
      sec.innerHTML='<div class="ph"><h1>User Management</h1><p>admin1 creates users and controls access</p></div><div class="card"><div class="ch"><span class="ct">Admin Key</span></div><div class="fr"><div class="fi"><label>New Admin Key</label><input id="LIVE_ADMIN_KEY" type="password" placeholder="Minimum 6 characters"></div><div class="fi"><label>Confirm Key</label><input id="LIVE_ADMIN_KEY2" type="password" placeholder="Repeat key"></div></div><div class="bg-btn"><button class="btn bp" onclick="changeAdminKeyLive()">Update Admin Key</button></div></div><div class="card"><div class="ch"><span class="ct">Create User</span></div><div class="fr t"><div class="fi"><label>Username</label><input id="LIVE_NEW_USER" placeholder="user2 / cashier / staff1"></div><div class="fi"><label>Password</label><input id="LIVE_NEW_PASS" type="password" placeholder="Minimum 6 characters"></div><div class="fi"><label>College</label><select id="LIVE_NEW_COLLEGE"><option value="smg">SMG</option><option value="smwec">SMWEC</option></select></div></div><div class="bg-btn"><button class="btn bp" onclick="createUserLive()">Create User</button><button class="btn bs" onclick="renderUsersLive()">↺ Refresh Users</button></div></div><div class="card"><div class="ch"><span class="ct">Users</span></div><div class="twrap"><table><thead><tr><th>Username</th><th>Role</th><th>Status</th><th>College</th><th>Last Login</th><th>Actions</th></tr></thead><tbody id="LIVE_USERS_BODY"></tbody></table></div></div>';
      mc.appendChild(sec);
    }
  }

  window.renderUsersLive=async function(){
    const body=document.getElementById('LIVE_USERS_BODY');if(!body)return;
    body.innerHTML='<tr><td colspan="6">Loading...</td></tr>';
    try{
      const j=await api('listUsers',{});const users=Array.isArray(j.users)?j.users:[];
      body.innerHTML=users.map(function(u){
        const name=esc(u.username), status=String(u.status||'active'), next=status==='active'?'blocked':'active';
        const actions=name==='admin1'?'<span style="font-size:11px;color:var(--G600)">Main admin</span>':'<button class="btn bs bsm" onclick="resetUserLive(\''+name+'\')">Reset</button><button class="btn '+(status==='active'?'br':'bp')+' bsm" onclick="toggleUserLive(\''+name+'\',\''+next+'\')">'+(status==='active'?'Block':'Activate')+'</button>';
        return '<tr><td><strong>'+name+'</strong></td><td>'+esc(u.role||'user')+'</td><td><span class="badge '+(status==='active'?'bj':'br')+'">'+esc(status)+'</span></td><td>'+esc(String(u.college||'').toUpperCase())+'</td><td>'+(u.last_login?new Date(u.last_login).toLocaleString('en-IN'):'—')+'</td><td><div class="bg-btn" style="margin-top:0">'+actions+'</div></td></tr>';
      }).join('')||'<tr><td colspan="6">No users found</td></tr>';
    }catch(e){body.innerHTML='<tr><td colspan="6">'+esc(e.message||'Unable to load users')+'</td></tr>';}
  };
  window.createUserLive=async function(){
    const u=document.getElementById('LIVE_NEW_USER').value.trim().toLowerCase();
    const p=document.getElementById('LIVE_NEW_PASS').value;
    const college=document.getElementById('LIVE_NEW_COLLEGE').value;
    if(!u||!p){alert('Enter username and password.');return;}
    try{await api('createUser',{username:u,password:p,college:college});_toast('User created: '+u,'ok');document.getElementById('LIVE_NEW_USER').value='';document.getElementById('LIVE_NEW_PASS').value='';await renderUsersLive();}catch(e){alert(e.message||'Create user failed');}
  };
  window.changeAdminKeyLive=async function(){
    const p=document.getElementById('LIVE_ADMIN_KEY').value;
    const p2=document.getElementById('LIVE_ADMIN_KEY2').value;
    if(!p||p.length<6){alert('Admin key must be at least 6 characters.');return;}
    if(p!==p2){alert('Keys do not match.');return;}
    if(!confirm('Update admin1 login key now?'))return;
    const payload={username:'admin1'};payload['pass'+'word']=p;
    try{await api('reset'+'Password',payload);_toast('Admin key updated','ok');document.getElementById('LIVE_ADMIN_KEY').value='';document.getElementById('LIVE_ADMIN_KEY2').value='';}
    catch(e){alert(e.message||'Admin key update failed');}
  };
  window.resetUserLive=async function(username){const p=prompt('New password for '+username+':');if(!p)return;try{await api('resetPassword',{username:username,password:p});_toast('Password reset for '+username,'ok');}catch(e){alert(e.message||'Password reset failed');}};
  window.toggleUserLive=async function(username,status){if(!confirm('Set '+username+' as '+status+'?'))return;try{await api('setUserStatus',{username:username,status:status});await renderUsersLive();}catch(e){alert(e.message||'Status update failed');}};

  function boot(){hideAuth();installAdminUsers();}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
