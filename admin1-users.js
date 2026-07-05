(function(){
  'use strict';

  const ALL_PERMS = [
    { key: 'view_dashboard', label: 'View Dashboard' },
    { key: 'view_analytics', label: 'View Analytics' },
    { key: 'create_voucher', label: 'Create Voucher' },
    { key: 'view_own_vouchers', label: 'View Own Vouchers' },
    { key: 'view_all_vouchers', label: 'View All Vouchers' },
    { key: 'edit_voucher', label: 'Edit Voucher' },
    { key: 'delete_voucher', label: 'Delete Voucher' },
    { key: 'print_voucher', label: 'Print Voucher' },
    { key: 'export_excel', label: 'Export Excel' },
    { key: 'cash_book', label: 'Cash Book' },
    { key: 'link_excel', label: 'Link Excel' },
    { key: 'printer_setup', label: 'Printer Setup' },
    { key: 'account_heads', label: 'Account Heads' },
    { key: 'create_users', label: 'Create Users' },
    { key: 'reset_passwords', label: 'Reset Passwords' },
    { key: 'block_users', label: 'Block Users' },
    { key: 'create_admin', label: 'Create Admin' },
    { key: 'manage_permissions', label: 'Manage Permissions' },
    { key: 'manage_colleges', label: 'Manage Colleges' },
    { key: 'change_admin_key', label: 'Change Admin Key' },
    { key: 'view_audit', label: 'View Audit' }
  ];

  const USER_DEFAULTS = ['create_voucher', 'view_own_vouchers', 'print_voucher'];
  const ADMIN_DEFAULTS = [
    'view_dashboard',
    'view_analytics',
    'create_voucher',
    'view_own_vouchers',
    'view_all_vouchers',
    'edit_voucher',
    'print_voucher',
    'export_excel',
    'cash_book',
    'link_excel',
    'printer_setup',
    'account_heads',
    'create_users',
    'reset_passwords',
    'block_users'
  ];

  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);});}
  function tok(){return localStorage.getItem('smv_token')||'';}
  function setTok(t){if(t)localStorage.setItem('smv_token',t);else localStorage.removeItem('smv_token');}
  function uiCode(u){const n=String((u&&u.username)||u||'').toLowerCase();if((u&&u.role==='admin')||n==='admin'||n==='admin1')return'admin1';if(n==='user3'||n==='admin3')return'admin3';return'admin2';}
  function loginNames(n){n=String(n||'').trim().toLowerCase();if(n==='admin1')return['admin1','admin'];if(n==='admin2')return['admin2','user2'];if(n==='admin3')return['admin3','user3'];return[n];}
  
  function getCurrentUser() {
    try {
      const s = localStorage.getItem('smv_auth_user');
      return s ? JSON.parse(s) : null;
    } catch(e) {
      return null;
    }
  }

  function hasPermission(user, perm) {
    if (!user) return false;
    if (user.username === 'admin' || user.username === 'admin1') return true;
    if (!user.permissions) return false;
    const perms = user.permissions.split(',').map(p => p.trim());
    return perms.includes(perm);
  }

  async function api(action,payload){
    const body=Object.assign({},payload||{},{action:action,token:tok()});
    const r=await fetch('/api/public/voucher/x',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json().catch(function(){return{error:'Invalid server response'};});
    if(j&&j.token)setTok(j.token);
    if(j&&j.user) localStorage.setItem('smv_auth_user', JSON.stringify(j.user));
    if(!r.ok||j.error) throw new Error(j.error||('HTTP '+r.status));
    return j;
  }
  async function collegeApi(action,payload){
    const body=Object.assign({},payload||{},{action:action,token:tok()});
    const r=await fetch('/api/public/colleges/x',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json().catch(function(){return{error:'Invalid server response'};});
    if(!r.ok||j.error) throw new Error(j.error||('HTTP '+r.status));
    return j;
  }

  function hideAuth(){
    const tab=document.getElementById('TAB_LOGIN');
    if(tab&&tab.parentElement)tab.parentElement.style.display='none';
    ['TAB_SIGNUP','TAB_RESET','PANEL_SIGNUP','PANEL_RESET'].forEach(function(id){const el=document.getElementById(id);if(el)el.style.display='none';});
    const panel=document.getElementById('PANEL_LOGIN');if(panel)panel.style.display='block';
    const lu=document.getElementById('LU');if(lu)lu.placeholder='admin1 / user2 / user3 / staff username';
    const lh=document.getElementById('LH');if(lh){lh.textContent='Users are created by admin1 only.';lh.style.display='block';}
  }

  window.doSignup=function(){alert('Public Sign Up is disabled. admin1 will create users from User Management.');switchAuthTab('login');hideAuth();};
  window.doResetPassword=function(){alert('Credential reset is available only inside admin1 User Management.');switchAuthTab('login');hideAuth();};

  const oldDoLogin = window.doLogin;
  window.doLogin = async function() {
    if (typeof oldDoLogin === 'function') {
      await oldDoLogin();
    }
    if (typeof applyPermissionVisibility === 'function') {
      applyPermissionVisibility();
    }
  };

  const oldShow=window.show;
  window.show=function(id){
    if(typeof oldShow==='function')oldShow(id);
    if(id==='users'){
      installAdminUsers();
      renderUsersLive();
      renderCollegesLive();
      if(document.getElementById('CARD_AUDIT_LOGS') && document.getElementById('CARD_AUDIT_LOGS').style.display !== 'none') window.renderAuditLive();
    }
    if (typeof applyPermissionVisibility === 'function') {
      applyPermissionVisibility();
    }
  };

  function renderPermissionCheckboxes(containerId, prefix) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = ALL_PERMS.map(p => `
      <label style="display:inline-flex; align-items:center; margin-right:15px; margin-bottom:5px; font-weight:normal; font-size:13px; cursor:pointer;">
        <input type="checkbox" id="${prefix}_${p.key}" class="${prefix}-perm-cb" value="${p.key}" style="margin-right:5px;">
        ${p.label}
      </label>
    `).join('');
  }

  window.applyRoleDefaults = function(prefix, role) {
    const defaults = role === 'admin' ? ADMIN_DEFAULTS : USER_DEFAULTS;
    const checkboxes = document.querySelectorAll(`.${prefix}-perm-cb`);
    checkboxes.forEach(cb => {
      cb.checked = defaults.includes(cb.value);
    });
  };

  window.renderCollegeAccessCheckboxes = function(containerId, prefix, colleges) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = (colleges || []).filter(c => c.status !== 'inactive').map(c => `
      <label style="display:inline-flex; align-items:center; margin-right:15px; margin-bottom:5px; font-weight:normal; font-size:13px; cursor:pointer;">
        <input type="checkbox" class="${prefix}-college-cb" value="${c.code}" style="margin-right:5px;">
        ${c.code.toUpperCase()}
      </label>
    `).join('') || '<span style="font-size:12px;color:var(--G600)">No active colleges</span>';
  };

  function installAdminUsers(){
    const user = getCurrentUser();
    if (!user) return;
    const isMainAdmin = user.username === 'admin' || user.username === 'admin1';
    const hasUserMgmt = isMainAdmin || hasPermission(user, 'create_users') || hasPermission(user, 'create_admin') || hasPermission(user, 'manage_permissions') || hasPermission(user, 'reset_passwords') || hasPermission(user, 'block_users') || hasPermission(user, 'manage_colleges');
    if (!hasUserMgmt) return;

    const nav=document.getElementById('A1NAV');
    if(nav&&!document.getElementById('ni-users')){
      const btn=document.createElement('button');btn.className='ni';btn.id='ni-users';btn.onclick=function(){show('users');};
      btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>User Management';
      nav.appendChild(btn);
    }
    const mc=document.querySelector('.mc');
    if(mc&&!document.getElementById('sec-users')){
      const sec=document.createElement('div');sec.className='sec';sec.id='sec-users';
      sec.innerHTML='<div class="ph"><h1>User Management</h1><p>Admin manages users, colleges and controls access</p></div>' +
        '<div class="card" id="CARD_ADMIN_KEY"><div class="ch"><span class="ct">Admin Key</span></div><div class="fr"><div class="fi"><label>New Admin Key</label><input id="LIVE_ADMIN_KEY" type="password" placeholder="Minimum 6 characters"></div><div class="fi"><label>Confirm Key</label><input id="LIVE_ADMIN_KEY2" type="password" placeholder="Repeat key"></div></div><div class="bg-btn"><button class="btn bp" onclick="changeAdminKeyLive()">Update Admin Key</button></div></div>' +
        '<div class="card" id="CARD_COLLEGE_MGMT"><div class="ch"><span class="ct">College Management</span></div><div class="fr t"><div class="fi"><label>College Name</label><input id="LIVE_COLLEGE_NAME" placeholder="College full name"></div><div class="fi"><label>Short Code</label><input id="LIVE_COLLEGE_CODE" placeholder="ex: smpharmacy"></div><div class="fi"><label>Location</label><input id="LIVE_COLLEGE_LOCATION" placeholder="City / campus"></div></div><div class="bg-btn"><button class="btn bp" onclick="createCollegeLive()">Create College</button><button class="btn bs" onclick="renderCollegesLive()">↺ Refresh Colleges</button></div><div class="twrap" style="margin-top:10px"><table><thead><tr><th>Code</th><th>College</th><th>Location</th><th>Status</th><th>Action</th></tr></thead><tbody id="LIVE_COLLEGES_BODY"></tbody></table></div></div>' +
        '<div class="card" id="CARD_CREATE_USER"><div class="ch"><span class="ct">Create Admin / User</span></div><div class="fr t"><div class="fi"><label>Full Name</label><input id="LIVE_NEW_FULLNAME" placeholder="Full name"></div><div class="fi"><label>Username</label><input id="LIVE_NEW_USER" placeholder="user2 / cashier / staff1"></div><div class="fi"><label>Password</label><input id="LIVE_NEW_PASS" type="password" placeholder="Minimum 6 characters"></div><div class="fi"><label>User Type</label><select id="LIVE_NEW_ROLE" onchange="applyRoleDefaults(\'LIVE_NEW\', this.value)"><option value="user">User</option><option value="admin">Admin</option></select></div><div class="fi"><label>Primary College</label><select id="LIVE_NEW_COLLEGE"><option value="smg">SMG</option><option value="smwec">SMWEC</option></select></div></div><div style="padding: 10px 15px;"><label style="font-weight:bold; font-size:13px; color:var(--G800); display:block; margin-bottom:5px;">College Access</label><div id="LIVE_NEW_COLLEGE_ACCESS" style="display:flex; flex-wrap:wrap; gap:10px; padding: 5px; border: 1px solid var(--G150); border-radius: 4px;"></div></div><div style="padding: 10px 15px;"><label style="font-weight:bold; font-size:13px; color:var(--G800); display:block; margin-bottom:5px;">Permissions</label><div id="LIVE_NEW_PERMS" style="display:flex; flex-wrap:wrap; gap:10px; padding: 5px; border: 1px solid var(--G150); border-radius: 4px;"></div></div><div class="bg-btn"><button class="btn bp" onclick="createUserLive()">Create User</button><button class="btn bs" onclick="renderUsersLive()">↺ Refresh Users</button></div></div>' +
        '<div class="card" id="CARD_EDIT_PERMS"><div class="ch"><span class="ct">Edit Role & Permissions</span></div><div class="fr t"><div class="fi"><label>Select User</label><select id="LIVE_EDIT_USER" onchange="loadUserToEdit(this.value)"></select></div><div class="fi"><label>Full Name</label><input id="LIVE_EDIT_FULLNAME" placeholder="Full name"></div><div class="fi"><label>Role</label><select id="LIVE_EDIT_ROLE"><option value="user">User</option><option value="admin">Admin</option></select></div><div class="fi"><label>Primary College</label><select id="LIVE_EDIT_COLLEGE"></select></div></div><div style="padding: 10px 15px;"><label style="font-weight:bold; font-size:13px; color:var(--G800); display:block; margin-bottom:5px;">College Access</label><div id="LIVE_EDIT_COLLEGE_ACCESS" style="display:flex; flex-wrap:wrap; gap:10px; padding: 5px; border: 1px solid var(--G150); border-radius: 4px;"></div></div><div style="padding: 10px 15px;"><label style="font-weight:bold; font-size:13px; color:var(--G800); display:block; margin-bottom:5px;">Permissions</label><div id="LIVE_EDIT_PERMS" style="display:flex; flex-wrap:wrap; gap:10px; padding: 5px; border: 1px solid var(--G150); border-radius: 4px;"></div></div><div class="bg-btn"><button class="btn bp" onclick="saveEditAccess()">Save Permissions</button></div></div>' +
        '<div class="card"><div class="ch"><span class="ct">Users</span></div><div class="twrap"><table><thead><tr><th>Username</th><th>Full Name</th><th>Role</th><th>Status</th><th>Primary College</th><th>College Access</th><th>Permissions Summary</th><th>Last Login</th><th>Actions</th></tr></thead><tbody id="LIVE_USERS_BODY"></tbody></table></div></div>' +
        '<div class="card" id="CARD_AUDIT_LOGS"><div class="ch"><span class="ct">Audit & Activity Logs</span></div><div class="bg-btn" style="border-bottom:1px solid var(--G100); border-top:none; margin-top:0"><button class="btn bs" onclick="renderAuditLive()">↺ Refresh Logs</button></div><div class="twrap" style="max-height:400px;overflow-y:auto"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th><th>IP</th></tr></thead><tbody id="LIVE_AUDIT_BODY"></tbody></table></div></div>';
      mc.appendChild(sec);

      renderPermissionCheckboxes('LIVE_NEW_PERMS', 'LIVE_NEW');
      renderPermissionCheckboxes('LIVE_EDIT_PERMS', 'LIVE_EDIT');
      applyRoleDefaults('LIVE_NEW', 'user');
    }
  }

  function fillCollegeSelect(colleges){
    const activeColleges = (colleges||[]).filter(function(c){return c.status!=='inactive';});
    const optionsHtml = activeColleges.map(function(c){
      return '<option value="'+esc(c.code)+'">'+esc(String(c.code||'').toUpperCase())+'</option>';
    }).join('');

    const selNew = document.getElementById('LIVE_NEW_COLLEGE');
    if (selNew) {
      const currentNew = selNew.value || 'smg';
      selNew.innerHTML = optionsHtml;
      if(Array.from(selNew.options).some(function(o){return o.value===currentNew;})) selNew.value=currentNew;
    }

    const selEdit = document.getElementById('LIVE_EDIT_COLLEGE');
    if (selEdit) {
      const currentEdit = selEdit.value || 'smg';
      selEdit.innerHTML = optionsHtml;
      if(Array.from(selEdit.options).some(function(o){return o.value===currentEdit;})) selEdit.value=currentEdit;
    }

    renderCollegeAccessCheckboxes('LIVE_NEW_COLLEGE_ACCESS', 'LIVE_NEW', colleges);
    renderCollegeAccessCheckboxes('LIVE_EDIT_COLLEGE_ACCESS', 'LIVE_EDIT', colleges);
  }

  window.loadUserToEdit = function(username) {
    if (!username) {
      clearEditForm();
      return;
    }
    const u = (window.LIVE_USERS_LIST || []).find(user => user.username === username);
    if (!u) return;

    document.getElementById('LIVE_EDIT_FULLNAME').value = u.full_name || '';
    document.getElementById('LIVE_EDIT_ROLE').value = u.role || 'user';
    document.getElementById('LIVE_EDIT_COLLEGE').value = u.college || 'smg';

    const collegeCbs = document.querySelectorAll('.LIVE_EDIT-college-cb');
    const allowedColleges = (u.college_access || '').split(',').map(c => c.trim().toLowerCase());
    collegeCbs.forEach(cb => {
      cb.checked = allowedColleges.includes(cb.value.toLowerCase());
    });

    const permCbs = document.querySelectorAll('.LIVE_EDIT-perm-cb');
    const userPerms = (u.permissions || '').split(',').map(p => p.trim());
    permCbs.forEach(cb => {
      cb.checked = userPerms.includes(cb.value);
    });
  };

  function clearEditForm() {
    const fullname = document.getElementById('LIVE_EDIT_FULLNAME');
    if (fullname) fullname.value = '';
    const role = document.getElementById('LIVE_EDIT_ROLE');
    if (role) role.value = 'user';
    const college = document.getElementById('LIVE_EDIT_COLLEGE');
    if (college) college.value = 'smg';

    const collegeCbs = document.querySelectorAll('.LIVE_EDIT-college-cb');
    collegeCbs.forEach(cb => cb.checked = false);

    const permCbs = document.querySelectorAll('.LIVE_EDIT-perm-cb');
    permCbs.forEach(cb => cb.checked = false);
  }

  window.populateEditUserSelect = function(users) {
    const sel = document.getElementById('LIVE_EDIT_USER');
    if (!sel) return;
    const current = sel.value;
    const editableUsers = users.filter(u => u.username !== 'admin1' && u.username !== 'admin');
    sel.innerHTML = '<option value="">-- Select User --</option>' + editableUsers.map(u => `
      <option value="${esc(u.username)}">${esc(u.username)}</option>
    `).join('');
    if (current && editableUsers.some(u => u.username === current)) {
      sel.value = current;
    } else {
      sel.value = '';
      clearEditForm();
    }
  };

  window.saveEditAccess = async function() {
    const username = document.getElementById('LIVE_EDIT_USER').value;
    if (!username) {
      alert('Please select a user to edit.');
      return;
    }
    const fullName = document.getElementById('LIVE_EDIT_FULLNAME').value.trim();
    const role = document.getElementById('LIVE_EDIT_ROLE').value;
    const college = document.getElementById('LIVE_EDIT_COLLEGE').value;

    const collegeCbs = document.querySelectorAll('.LIVE_EDIT-college-cb');
    const collegeAccess = Array.from(collegeCbs).filter(cb => cb.checked).map(cb => cb.value).join(',');

    const permCbs = document.querySelectorAll('.LIVE_EDIT-perm-cb');
    const permissions = Array.from(permCbs).filter(cb => cb.checked).map(cb => cb.value).join(',');

    try {
      await api('updateUserPermissions', {
        username: username,
        role: role,
        fullName: fullName,
        college: college,
        collegeAccess: collegeAccess,
        permissions: permissions
      });
      _toast('Permissions updated for ' + username, 'ok');
      await renderUsersLive();
    } catch (e) {
      alert(e.message || 'Failed to update permissions');
    }
  };

  window.renderCollegesLive=async function(){
    const body=document.getElementById('LIVE_COLLEGES_BODY');if(!body)return;
    body.innerHTML='<tr><td colspan="5">Loading...</td></tr>';
    try{
      const j=await collegeApi('listColleges',{});const colleges=Array.isArray(j.colleges)?j.colleges:[];fillCollegeSelect(colleges);
      body.innerHTML=colleges.map(function(c){
        const code=esc(c.code), status=String(c.status||'active'), next=status==='active'?'inactive':'active';
        const action=code==='smg'?'<span style="font-size:11px;color:var(--G600)">Main</span>':'<button class="btn '+(status==='active'?'br':'bp')+' bsm" onclick="toggleCollegeLive(\''+code+'\',\''+next+'\')">'+(status==='active'?'Disable':'Activate')+'</button>';
        return '<tr><td><strong>'+code.toUpperCase()+'</strong></td><td>'+esc(c.name||'')+'</td><td>'+esc(c.location||'')+'</td><td><span class="badge '+(status==='active'?'bj':'br')+'">'+esc(status)+'</span></td><td>'+action+'</td></tr>';
      }).join('')||'<tr><td colspan="5">No colleges found</td></tr>';
    }catch(e){body.innerHTML='<tr><td colspan="5">'+esc(e.message||'Unable to load colleges')+'</td></tr>';}
  };
  window.createCollegeLive=async function(){
    const name=document.getElementById('LIVE_COLLEGE_NAME').value.trim();
    const code=document.getElementById('LIVE_COLLEGE_CODE').value.trim().toLowerCase();
    const location=document.getElementById('LIVE_COLLEGE_LOCATION').value.trim();
    if(!name||!code){alert('Enter college name and short code.');return;}
    try{await collegeApi('createCollege',{name:name,code:code,location:location});_toast('College created: '+code,'ok');document.getElementById('LIVE_COLLEGE_NAME').value='';document.getElementById('LIVE_COLLEGE_CODE').value='';document.getElementById('LIVE_COLLEGE_LOCATION').value='';await renderCollegesLive();}
    catch(e){alert(e.message||'Create college failed');}
  };
  window.toggleCollegeLive=async function(code,status){
    if(!confirm('Set '+code.toUpperCase()+' as '+status+'?'))return;
    try{await collegeApi('setCollegeStatus',{code:code,status:status});await renderCollegesLive();}
    catch(e){alert(e.message||'College status update failed');}
  };

  window.renderUsersLive=async function(){
    const body=document.getElementById('LIVE_USERS_BODY');if(!body)return;
    body.innerHTML='<tr><td colspan="9">Loading...</td></tr>';
    try{
      const j=await api('listUsers',{});
      const users=Array.isArray(j.users)?j.users:[];
      window.LIVE_USERS_LIST = users;
      populateEditUserSelect(users);

      const currentUser = getCurrentUser();
      const canReset = currentUser && (currentUser.username === 'admin' || currentUser.username === 'admin1' || hasPermission(currentUser, 'reset_passwords'));
      const canBlock = currentUser && (currentUser.username === 'admin' || currentUser.username === 'admin1' || hasPermission(currentUser, 'block_users'));
      const canEditPerms = currentUser && (currentUser.username === 'admin' || currentUser.username === 'admin1' || hasPermission(currentUser, 'manage_permissions'));

      body.innerHTML=users.map(function(u){
        const name=esc(u.username);
        const isMainAdmin = name === 'admin1' || name === 'admin';
        const fullName = isMainAdmin ? 'Main Administrator' : esc(u.full_name || '');
        const role = isMainAdmin ? 'admin' : esc(u.role || 'user');
        const status = String(u.status || 'active');
        const next = status === 'active' ? 'blocked' : 'active';
        const college = esc(String(u.college || '').toUpperCase());
        const collegeAccess = isMainAdmin ? 'All' : esc(String(u.college_access || '').toUpperCase() || 'None');
        const permsSummary = isMainAdmin ? 'All' : (u.permissions ? esc(u.permissions.split(',').join(', ')) : 'None');
        const lastLogin = u.last_login ? new Date(u.last_login).toLocaleString('en-IN') : '—';
        
        let acts = '';
        if (isMainAdmin) {
          acts = '<span style="font-size:11px;color:var(--G600)">Main admin</span>';
        } else {
          if (canReset) acts += '<button class="btn bs bsm" onclick="resetUserLive(\''+name+'\')">Reset</button>';
          if (canBlock) acts += '<button class="btn '+(status==='active'?'br':'bp')+' bsm" style="margin-left:5px" onclick="toggleUserLive(\''+name+'\',\''+next+'\')">'+(status==='active'?'Block':'Activate')+'</button>';
          if (canEditPerms) acts += '<button class="btn bp bsm" style="margin-left:5px" onclick="document.getElementById(\'LIVE_EDIT_USER\').value=\''+name+'\';loadUserToEdit(\''+name+'\');document.getElementById(\'CARD_EDIT_PERMS\').scrollIntoView();">Edit</button>';
        }
        const actions = acts;

        return '<tr>' +
          '<td><strong>'+name+'</strong></td>' +
          '<td>'+fullName+'</td>' +
          '<td>'+role+'</td>' +
          '<td><span class="badge '+(status==='active'?'bj':'br')+'">'+esc(status)+'</span></td>' +
          '<td>'+college+'</td>' +
          '<td>'+collegeAccess+'</td>' +
          '<td>'+permsSummary+'</td>' +
          '<td>'+lastLogin+'</td>' +
          '<td><div class="bg-btn" style="margin-top:0">'+actions+'</div></td>' +
          '</tr>';
      }).join('')||'<tr><td colspan="9">No users found</td></tr>';
    }catch(e){body.innerHTML='<tr><td colspan="9">'+esc(e.message||'Unable to load users')+'</td></tr>';}
  };

  window.renderAuditLive=async function(){
    const body=document.getElementById('LIVE_AUDIT_BODY');if(!body)return;
    body.innerHTML='<tr><td colspan="6">Loading...</td></tr>';
    try{
      const j=await api('listAudit',{});
      const logs=Array.isArray(j.logs)?j.logs:[];
      body.innerHTML=logs.map(function(l){
        const time = new Date(l.created_at).toLocaleString('en-IN');
        return '<tr>' +
          '<td style="white-space:nowrap"><span style="font-size:12px;color:var(--G600)">'+esc(time)+'</span></td>' +
          '<td><strong>'+esc(l.actor)+'</strong></td>' +
          '<td><span class="badge bs" style="font-size:11px">'+esc(l.action)+'</span></td>' +
          '<td><span style="font-size:12px;color:var(--G800)">'+esc(l.entity_type)+'</span> <strong>'+esc(l.entity_id)+'</strong></td>' +
          '<td><span style="font-size:12px">'+esc(l.details)+'</span></td>' +
          '<td><span style="font-size:11px;color:var(--G400)">'+esc(l.ip)+'</span></td>' +
          '</tr>';
      }).join('')||'<tr><td colspan="6">No activity found</td></tr>';
    }catch(e){body.innerHTML='<tr><td colspan="6">'+esc(e.message||'Unable to load audit logs')+'</td></tr>';}
  };

  window.createUserLive=async function(){
    const u=document.getElementById('LIVE_NEW_USER').value.trim().toLowerCase();
    const p=document.getElementById('LIVE_NEW_PASS').value;
    const fullName=document.getElementById('LIVE_NEW_FULLNAME').value.trim();
    const role=document.getElementById('LIVE_NEW_ROLE').value;
    const college=document.getElementById('LIVE_NEW_COLLEGE').value;

    if(!u||!p){alert('Enter username and password.');return;}

    const collegeCbs = document.querySelectorAll('.LIVE_NEW-college-cb');
    const collegeAccess = Array.from(collegeCbs).filter(cb => cb.checked).map(cb => cb.value).join(',');

    const permCbs = document.querySelectorAll('.LIVE_NEW-perm-cb');
    const permissions = Array.from(permCbs).filter(cb => cb.checked).map(cb => cb.value).join(',');

    try{
      await api('createUser',{
        username:u,
        password:p,
        role:role,
        fullName:fullName,
        college:college,
        collegeAccess:collegeAccess,
        permissions:permissions
      });
      _toast('User created: '+u,'ok');
      document.getElementById('LIVE_NEW_USER').value='';
      document.getElementById('LIVE_NEW_PASS').value='';
      document.getElementById('LIVE_NEW_FULLNAME').value='';
      applyRoleDefaults('LIVE_NEW', 'user');
      document.getElementById('LIVE_NEW_ROLE').value = 'user';
      const newColCbs = document.querySelectorAll('.LIVE_NEW-college-cb');
      newColCbs.forEach(cb => cb.checked = false);

      await renderUsersLive();
    }catch(e){alert(e.message||'Create user failed');}
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

  window.applyPermissionVisibility = function() {
    const user = getCurrentUser();
    if (!user) return;

    const isMainAdmin = user.username === 'admin' || user.username === 'admin1';
    const perms = isMainAdmin ? [] : (user.permissions || '').split(',').map(p => p.trim());

    function has(p) {
      return isMainAdmin || perms.includes(p);
    }

    const niCreate = document.getElementById('ni-create');
    if (niCreate) {
      niCreate.style.display = has('create_voucher') ? 'flex' : 'none';
    }

    const niVouchers = document.getElementById('ni-vouchers');
    if (niVouchers) {
      niVouchers.style.display = has('view_all_vouchers') ? 'flex' : 'none';
    }

    const niMyVouchers = document.getElementById('ni-myvouchers');
    if (niMyVouchers) {
      niMyVouchers.style.display = has('view_own_vouchers') ? 'flex' : 'none';
    }

    const niAnalytics = document.getElementById('ni-analytics');
    if (niAnalytics) {
      niAnalytics.style.display = has('view_analytics') ? 'flex' : 'none';
    }

    const niExport = document.getElementById('ni-export');
    if (niExport) {
      niExport.style.display = has('export_excel') ? 'flex' : 'none';
    }

    const cashBookBtn = document.querySelector('button[onclick="doCashBook()"]');
    if (cashBookBtn) {
      cashBookBtn.style.display = has('cash_book') ? 'inline-block' : 'none';
    }

    const niPrinter = document.getElementById('ni-printersetup');
    if (niPrinter) {
      niPrinter.style.display = has('printer_setup') ? 'flex' : 'none';
    }

    const cardCollege = document.getElementById('CARD_COLLEGE_MGMT');
    if (cardCollege) {
      cardCollege.style.display = has('manage_colleges') ? 'block' : 'none';
    }

    const cardAdminKey = document.getElementById('CARD_ADMIN_KEY');
    if (cardAdminKey) {
      cardAdminKey.style.display = has('change_admin_key') ? 'block' : 'none';
    }

    const hasUserMgmt = has('create_users') || has('create_admin') || has('manage_permissions') || has('reset_passwords') || has('block_users') || has('manage_colleges');
    const niUsers = document.getElementById('ni-users');
    if (niUsers) {
      niUsers.style.display = hasUserMgmt ? 'flex' : 'none';
    }
    const cardCreateUser = document.getElementById('CARD_CREATE_USER');
    if (cardCreateUser) {
      cardCreateUser.style.display = (has('create_users') || has('create_admin')) ? 'block' : 'none';
    }
    const cardEditPerms = document.getElementById('CARD_EDIT_PERMS');
    if (cardEditPerms) {
      cardEditPerms.style.display = has('manage_permissions') ? 'block' : 'none';
    }

    const cardAudit = document.getElementById('CARD_AUDIT_LOGS');
    if (cardAudit) {
      cardAudit.style.display = has('view_audit') ? 'block' : 'none';
    }

    let styleEl = document.getElementById('smv-permission-visibility-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'smv-permission-visibility-style';
      document.head.appendChild(styleEl);
    }
    let css = '';
    if (!has('delete_voucher')) {
      css += 'button[onclick^="delV("] { display: none !important; }\n';
    }
    if (!has('edit_voucher')) {
      css += 'button[onclick^="editV("] { display: none !important; }\n';
    }
    if (!has('account_heads')) {
      css += '#AC_HEAD_ADD_FORM, .ac-head-add-form { display: none !important; }\n';
      css += 'button[onclick="showAddHead()"] { display: none !important; }\n';
    }
    styleEl.textContent = css;

    const xlPill = document.getElementById('XLPILL');
    if (xlPill) {
      xlPill.style.display = has('link_excel') ? 'inline-block' : 'none';
    }
  };

  function boot(){
    hideAuth();
    installAdminUsers();
    if (typeof applyPermissionVisibility === 'function') {
      applyPermissionVisibility();
    }
    setTimeout(hideAuth,200);
    setTimeout(function(){
      installAdminUsers();
      renderCollegesLive();
      if (typeof applyPermissionVisibility === 'function') {
        applyPermissionVisibility();
      }
    },500);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
