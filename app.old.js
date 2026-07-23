const HEADS=['Building Maintenance','Garden Maintenance','Aquarium Maintenance','Staff Welfare Account','Guest Lecture Account','Workshop Account','Training & Placements Account','Transportation Account','Bank Deposits Account','Salary Account','Repairs & Maintenance','Hostel Mess Maintenance','Furniture Maintenance','Electricity Bill','Vehicle Maintenance','Electrical Expenses','Xerox Machine Maintenance','Transfer Account','Library Maintenance Account','Sports Maintenance Account','Function Celebration Account','Printing & Stationery Account','Office Maintenance Account','Professional Tax','Postage & Telegram','Admission & Promotion Account','On Account','Marketing','Advertisement','Loan Account','Audit Expenses Account','Diesel Account','Bank Charges Account','Courier Expenses','Telephone Expenses','Legal Expenses','Internet Expenses','Lab Maintenance','Conveyance Expenses','Computer Maintenance','Donation Account'];
const BLOCKS=[];
// ===== AUTH SYSTEM (no hardcoded passwords) =====
// Credentials stored in localStorage as hashed passwords.
// Up to 3 accounts: admin1, admin2, admin3
// Role: admin1 = full admin; admin2/admin3 = limited
const ADMIN_ROLES={admin1:{label:'Admin 1',role:'admin1'},admin2:{label:'Admin 2',role:'admin2'},admin3:{label:'Admin 3',role:'admin3'}};
const ADMINS=ADMIN_ROLES;
let CURRENT_COLLEGE=null;
let HOME_COLLEGE=null; // college the user logged into; only SMGG admin1 can cross over
let SMWEC_LOGO_SRC='assets/logo_smwec.jpg';
const COLLEGES={smgg:{label:"St. Mary's Group Of Institutions Guntur For Women"},smwec:{label:"St. Mary's Women's Engineering College, Budampadu",logo:SMWEC_LOGO_SRC}};
let SMGG_LOGO_SRC='assets/logo_smgg.png';
function _credKey(){return 'smv_creds_v1__'+(CURRENT_COLLEGE||'smgg');}
function _vsKey(){return 'smv3__'+(CURRENT_COLLEGE||'smgg');}
// Clear all legacy data on first run of this version
(function(){
  const VER='smv_v3_clean';
  if(!localStorage.getItem(VER)){
    // Remove old credentials and voucher data
    localStorage.removeItem('smv_creds_v1');
    localStorage.removeItem('smv3');
    localStorage.setItem(VER,'1');
  }
  // Migration for SMG to SMGG rename
  if (localStorage.getItem('smv_last_college') === 'smg') {
    localStorage.setItem('smv_last_college', 'smgg');
  }
  const oldVouchers = localStorage.getItem('smv3__smg');
  if (oldVouchers && !localStorage.getItem('smv3__smgg')) {
    localStorage.setItem('smv3__smgg', oldVouchers.replace(/"college":"smg"/g, '"college":"smgg"'));
  }
  const oldCreds = localStorage.getItem('smv_creds_v1__smg');
  if (oldCreds && !localStorage.getItem('smv_creds_v1__smgg')) {
    localStorage.setItem('smv_creds_v1__smgg', oldCreds);
  }
  if (localStorage.getItem('smv_sess_college') === 'smg') {
    localStorage.setItem('smv_sess_college', 'smgg');
  }
  if (localStorage.getItem('smv_sess_home') === 'smg') {
    localStorage.setItem('smv_sess_home', 'smgg');
  }
})();
// === Cloud-backed credentials (replaces localStorage) ===
const _CRED_CACHE={};
async function _api(action, payload){
  const r=await fetch('/api/public/voucher/x',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...payload})});
  const j=await r.json().catch(()=>({error:'Network'}));
  if(!r.ok) throw new Error(j.error||('HTTP '+r.status));
  return j;
}
// Sync stub kept for legacy callers that read the credentials map; returns cached usernames map.
function _getCredentials(){const c=CURRENT_COLLEGE||'smgg';return _CRED_CACHE[c]||{};}
async function _refreshCredentialsCache(college){
  const c=college||CURRENT_COLLEGE||'smgg';
  try{const j=await _api('listAdmins',{college:c});const m={};(j.usernames||[]).forEach(u=>{m[u]='1';});_CRED_CACHE[c]=m;return m;}catch(e){return _CRED_CACHE[c]||{};}
}
function _saveCredentials(_obj){/* no-op: writes go through signup/reset API */}
async function _hashPassword(pw){
  const enc=new TextEncoder();
  const buf=await crypto.subtle.digest('SHA-256',enc.encode(pw));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
// =============================================
let VS=[];
let CU=null,CVT='debit',editId=null;
function _setSess(k,v){try{sessionStorage.setItem(k,v);localStorage.setItem(k,v);}catch(e){}}
function _getSess(k){try{return sessionStorage.getItem(k)||localStorage.getItem(k)||'';}catch(e){return'';}}
function _delSess(k){try{sessionStorage.removeItem(k);localStorage.removeItem(k);}catch(e){}}
function _clearSess(){['smv_sess_user','smv_sess_college','smv_sess_home','smv_sess_page'].forEach(_delSess);}

// === EXCEL FILE LINKING (File System Access API) ===
let XLHandle=null, XLName=null;
// ===== IndexedDB persistence for the linked Excel file handle (auto-relink after refresh) =====
const XL_IDB={db:'stmv_xl',store:'h',key:'linked'};
function _idb(){return new Promise((res,rej)=>{const r=indexedDB.open(XL_IDB.db,1);r.onupgradeneeded=()=>r.result.createObjectStore(XL_IDB.store);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function _idbPut(h){try{const db=await _idb();const tx=db.transaction(XL_IDB.store,'readwrite');tx.objectStore(XL_IDB.store).put(h,XL_IDB.key);return new Promise(r=>tx.oncomplete=r);}catch(e){}}
async function _idbGet(){try{const db=await _idb();const tx=db.transaction(XL_IDB.store,'readonly');return await new Promise(res=>{const q=tx.objectStore(XL_IDB.store).get(XL_IDB.key);q.onsuccess=()=>res(q.result||null);q.onerror=()=>res(null);});}catch(e){return null;}}
async function _idbDel(){try{const db=await _idb();const tx=db.transaction(XL_IDB.store,'readwrite');tx.objectStore(XL_IDB.store).delete(XL_IDB.key);}catch(e){}}
async function restoreLinkedExcel(){
  try{
    const h=await _idbGet(); if(!h) return;
    XLHandle=h; XLName=h.name||'Excel'; _updateXLPill();
    // Try silent permission check; if not granted, mark pill as "needs click"
    const perm=await h.queryPermission?.({mode:'readwrite'});
    if(perm==='granted'){ _toast('🔗 Auto-relinked: '+XLName,'ok'); return; }
    const p=document.getElementById('XLPILL');
    if(p){ p.classList.add('linked'); p.classList.add('needs-grant'); p.innerHTML='🔓 Click to restore: '+XLName; p.title='Click and approve to re-enable auto-save'; }
  }catch(e){}
}
function _toast(msg, kind){
  const t=document.createElement('div');
  t.className='toast '+(kind||'');
  t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity .3s';},2200);
  setTimeout(()=>t.remove(),2600);
}
function _updateXLPill(){
  const p=document.getElementById('XLPILL'); if(!p) return;
  if(XLHandle){p.classList.add('linked'); p.innerHTML='✅ '+(XLName||'Excel linked'); p.title='Click to unlink. Saves write to this file.';}
  else{p.classList.remove('linked'); p.innerHTML='📎 Link Excel'; p.title='Pick an Excel file — saves will update it directly.';}
}
async function linkExcelFile(){
  // Case A: a handle was restored from IDB but lacks permission — request it now (user gesture)
  if(XLHandle){
    const pill=document.getElementById('XLPILL');
    const needsGrant=pill&&pill.classList.contains('needs-grant');
    if(needsGrant){
      try{
        const p=await XLHandle.requestPermission({mode:'readwrite'});
        if(p==='granted'){ pill.classList.remove('needs-grant'); _updateXLPill(); _toast('🔗 Re-linked: '+XLName,'ok'); }
        else{ _toast('Permission denied','err'); }
      }catch(e){_toast('Restore failed: '+e.message,'err');}
      return;
    }
    if(confirm('Unlink "'+XLName+'"? Future saves will not auto-write to it.')){XLHandle=null;XLName=null;await _idbDel();_updateXLPill();_toast('Excel unlinked','warn');}
    return;
  }
  if(!('showSaveFilePicker' in window)){
    _toast('Browser does not support direct save. Use Chrome/Edge.','err'); return;
  }
  try{
    let h;
    if('showOpenFilePicker' in window){
      const picks=await window.showOpenFilePicker({
        types:[{description:'Excel',accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}}],
        excludeAcceptAllOption:false, multiple:false
      });
      h=picks[0];
      const perm=await h.requestPermission({mode:'readwrite'});
      if(perm!=='granted'){_toast('Write permission denied','err');return;}
    } else {
      h=await window.showSaveFilePicker({
        suggestedName:'StMarys_Vouchers.xlsx',
        types:[{description:'Excel',accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}}]
      });
    }
    XLHandle=h; XLName=h.name; await _idbPut(h); _updateXLPill();
    _toast('Linked: '+XLName,'ok');
  }catch(e){if(e.name!=='AbortError') _toast('Link failed: '+e.message,'err');}
}
async function autoSaveLinkedExcel(){
  if(!XLHandle) return false;
  try{
    if(typeof XLSX==='undefined'){_toast('Excel lib not ready','err');return false;}
    // Build the same workbook as doExcel but write to handle
    const typeLabel=t=>t==='credit'?'Credit':t==='debit'?'Debit':'On- Account';
    const rows=VS.map((v,i)=>({
      'S.No':i+1,'Date':v.date||'','Voucher Type':typeLabel(v.type),
      'Account Name / Credit A/c':v.acName||'','Account Head / Debit A/c':v.head||'',
      'Received From':v.receivedFrom||'','Paid To':v.paidTo||'',
      'Towards (Purpose)':v.towards||'',
      'Block':v.block||'',
      'Amount (Rs.)':Math.round(Number(v.amount)||0),
      'Amount in Words':v.amtWords||'','Payment Mode':v.mode||'',
      'Cheque / Ref No.':v.cheque||'','Checked By':v.checkedBy||'',
      'Remarks':v.remarks||'','Created By':v.createdBy||'',
      'Created At':v.createdAt?new Date(v.createdAt).toLocaleString('en-IN'):''
    }));
    const ws=XLSX.utils.json_to_sheet(rows);
    ws['!cols']=[{wch:5},{wch:12},{wch:13},{wch:22},{wch:28},{wch:22},{wch:22},{wch:42},{wch:14},{wch:40},{wch:13},{wch:18},{wch:18},{wch:28},{wch:13},{wch:22}];
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'Vouchers');
    const total=VS.reduce((s,v)=>s+(Number(v.amount)||0),0);
    const counts={Debit:0,'On- Account':0,Credit:0},amounts={Debit:0,'On- Account':0,Credit:0};
    VS.forEach(v=>{const k=typeLabel(v.type);counts[k]=(counts[k]||0)+1;amounts[k]=(amounts[k]||0)+(Number(v.amount)||0);});
    const sumData=[
      ["ST. MARY'S GROUP OF INSTITUTIONS GUNTUR FOR WOMEN","",""],
      ["Voucher Export — "+today(),"",""],["","",""],["SUMMARY","",""],
      ["Total Vouchers",VS.length,""],["Total Amount (Rs.)",total,""],["","",""],
      ["Voucher Type","Count","Total Amount (Rs.)"],
      ["Debit",counts['Debit'],amounts['Debit']],
      ["On- Account",counts['On- Account'],amounts['On- Account']],
      ["Credit",counts['Credit'],amounts['Credit']],
      ["","",""],["Grand Total",VS.length,total]
    ];
    const ws2=XLSX.utils.aoa_to_sheet(sumData);
    ws2['!cols']=[{wch:38},{wch:14},{wch:20}];
    XLSX.utils.book_append_sheet(wb,ws2,'Summary');
    const out=XLSX.write(wb,{bookType:'xlsx',type:'array'});
    // Re-check permission (some browsers drop it)
    if((await XLHandle.queryPermission({mode:'readwrite'}))!=='granted'){
      const p=await XLHandle.requestPermission({mode:'readwrite'});
      if(p!=='granted'){_toast('Lost write permission','err');return false;}
    }
    const w=await XLHandle.createWritable();
    await w.write(new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    await w.close();
    return true;
  }catch(e){console.error(e); _toast('Auto-save failed: '+e.message,'err'); return false;}
}


// AUTH
// Auth tab switcher
function switchAuthTab(tab){
  const loginPanel=document.getElementById('PANEL_LOGIN');
  const signupPanel=document.getElementById('PANEL_SIGNUP');
  const resetPanel=document.getElementById('PANEL_RESET');
  const tabLogin=document.getElementById('TAB_LOGIN');
  const tabSignup=document.getElementById('TAB_SIGNUP');
  const tabReset=document.getElementById('TAB_RESET');
  const offBg='var(--G100)',offFg='var(--G800)',onBg='var(--M)',onFg='#fff';
  loginPanel.style.display=(tab==='login')?'':'none';
  signupPanel.style.display=(tab==='signup')?'':'none';
  if(resetPanel) resetPanel.style.display=(tab==='reset')?'':'none';
  tabLogin.style.background=(tab==='login')?onBg:offBg; tabLogin.style.color=(tab==='login')?onFg:offFg;
  tabSignup.style.background=(tab==='signup')?onBg:offBg; tabSignup.style.color=(tab==='signup')?onFg:offFg;
  if(tabReset){ tabReset.style.background=(tab==='reset')?onBg:offBg; tabReset.style.color=(tab==='reset')?onFg:offFg; }
  if(tab==='signup') _refreshSignupOptions();
  if(tab==='reset') _refreshResetOptions();
}
function _credKeyFor(college){return 'smv_creds_v1__'+(college||'smgg');}
async function _refreshResetOptions(){
  const ru=document.getElementById('RU');
  if(!ru) return;
  const college=CURRENT_COLLEGE||'smgg';
  const creds=await _refreshCredentialsCache(college);
  Array.from(ru.options).forEach(opt=>{
    if(!opt.value) return;
    const exists=!!creds[opt.value];
    opt.disabled=!exists;
    opt.text=opt.value+(exists?'':' (no account)');
  });
  const re=document.getElementById('RE'); if(re) re.style.display='none';
  const rh=document.getElementById('RH'); if(rh) rh.style.display='none';
}
async function doResetPassword(){
  const college=CURRENT_COLLEGE||'smgg';
  const u=document.getElementById('RU').value;
  const p=document.getElementById('RP').value;
  const p2=document.getElementById('RP2').value;
  const ap=document.getElementById('RAP').value;
  const re=document.getElementById('RE');
  const rh=document.getElementById('RH');
  re.style.display='none'; if(rh) rh.style.display='none';
  const creds=await _refreshCredentialsCache(college);
  if(!creds['admin1']){
    re.textContent='No admin1 account exists at this institution. admin1 must sign up first before resetting any passwords.';
    re.style.display='block';return;
  }
  if(!ADMIN_ROLES[u]){re.textContent='Please select a valid admin username to reset.';re.style.display='block';return;}
  if(!creds[u]){
    re.textContent='No account for '+u+' at this institution. Please sign up first.';
    re.style.display='block';
    return;
  }
  if(p.length<6){re.textContent='Password must be at least 6 characters.';re.style.display='block';return;}
  if(p!==p2){re.textContent='Passwords do not match.';re.style.display='block';return;}
  const hash=await _hashPassword(p);
  const payload={college,username:u,passwordHash:hash};
  if(u!=='admin1'){
    if(!ap){re.textContent="Enter admin1's current password to authorize this reset.";re.style.display='block';return;}
    payload.authHash=await _hashPassword(ap);
  }
  try{ await _api('resetPassword',payload); }
  catch(e){ re.textContent=e.message||'Reset failed.'; re.style.display='block'; return; }
  _toast('Password reset for '+u+' by admin1.','ok');
  document.getElementById('RP').value='';
  document.getElementById('RP2').value='';
  document.getElementById('RAP').value='';
  if(rh){ rh.textContent='Password updated. Switch to Sign In to continue.'; rh.style.display='block'; }
}
async function _refreshSignupOptions(){
  const college=CURRENT_COLLEGE||'smgg';
  const creds=await _refreshCredentialsCache(college);
  const sel=document.getElementById('SU');
  if(!sel) return;
  Array.from(sel.options).forEach(opt=>{
    if(!opt.value) return;
    opt.disabled=!!creds[opt.value];
    opt.text=opt.value+(creds[opt.value]?' (registered)':'');
  });
  const sh=document.getElementById('SH');
  if(sh){
    const taken=Object.keys(creds).length;
    sh.textContent=taken>=3?'All 3 accounts are registered. Use Sign In.':'Only 3 accounts allowed (admin1, admin2, admin3).';
  }
}
async function doSignup(){
  const u=document.getElementById('SU').value;
  const p=document.getElementById('SP').value;
  const p2=document.getElementById('SP2').value;
  const se=document.getElementById('SE');
  se.style.display='none';
  if(!u){se.textContent='Please select a username.';se.style.display='block';return;}
  if(p.length<6){se.textContent='Password must be at least 6 characters.';se.style.display='block';return;}
  if(p!==p2){se.textContent='Passwords do not match.';se.style.display='block';return;}
  const college=CURRENT_COLLEGE||'smgg';
  const hash=await _hashPassword(p);
  try{ await _api('signup',{college,username:u,passwordHash:hash}); }
  catch(e){ se.textContent=e.message||'Sign up failed.'; se.style.display='block'; return; }
  await _refreshCredentialsCache(college);
  _toast('Account created! You can now sign in.','ok');
  document.getElementById('SP').value='';
  document.getElementById('SP2').value='';
  switchAuthTab('login');
  document.getElementById('LU').value=u;
}
async function doLogin(){
  const u=document.getElementById('LU').value.trim().toLowerCase();
  const p=document.getElementById('LP').value;
  const le=document.getElementById('LE');
  const lh=document.getElementById('LH');
  le.style.display='none';
  if(lh) lh.style.display='none';
  if(!ADMIN_ROLES[u]){le.textContent='Unknown username. Use admin1, admin2, or admin3.';le.style.display='block';return;}
  const college=CURRENT_COLLEGE||'smgg';
  const hash=await _hashPassword(p);
  try{
    await _api('login',{college,username:u,passwordHash:hash});
  }catch(e){
    const msg=e.message||'';
    if(/No such account/i.test(msg)){
      le.textContent='No account for '+u+'. Please sign up first.';
      le.style.display='block';
      if(lh){lh.textContent='Click "Sign Up" tab to create this account.';lh.style.display='block';}
    } else {
      le.textContent='Incorrect password. Please try again.';
      le.style.display='block';
    }
    return;
  }
  CU=u;
  const a=ADMIN_ROLES[u];
  document.getElementById('LS').style.display='none';
  document.getElementById('APP').style.display='block';
  document.getElementById('UB').textContent=a.label;
  le.style.display='none';
  HOME_COLLEGE=CURRENT_COLLEGE; updateCollegeSwitchPill();
  await _loadVouchersFromCloud();
  setupRole();initApp();_updateXLPill();{const cs=document.getElementById('f_college');if(cs){cs.value=CURRENT_COLLEGE||'smgg';cs.disabled=true;}}
  _setSess('smv_sess_user',u);_setSess('smv_sess_college',CURRENT_COLLEGE||'smgg');_setSess('smv_sess_home',CURRENT_COLLEGE||'smgg');
  _startLiveSync();
}
function logout(){CU=null;HOME_COLLEGE=null;_stopLiveSync();_clearSess();document.getElementById('APP').style.display='none';document.getElementById('LS').style.display='none';document.getElementById('LU').value='';document.getElementById('LP').value='';backToPicker();}
function backToPicker(){CU=null;HOME_COLLEGE=null;CURRENT_COLLEGE=null;VS=[];_stopLiveSync();_clearSess();const cp=document.getElementById('CP');if(cp)cp.style.display='flex';const ls=document.getElementById('LS');if(ls)ls.style.display='none';const ap=document.getElementById('APP');if(ap)ap.style.display='none';}
function selectCollege(c){CURRENT_COLLEGE=c;localStorage.setItem('smv_last_college',c);VS=[];const info=COLLEGES[c]||COLLEGES.smgg;const lbl=document.getElementById('LS_COLLEGE_LABEL');if(lbl)lbl.textContent=info.label;const img=document.getElementById('LS_COLLEGE_LOGO');if(img){img.src=(c==='smgg')?SMGG_LOGO_SRC:(info.logo||SMGG_LOGO_SRC);}document.getElementById('CP').style.display='none';document.getElementById('LS').style.display='flex';document.getElementById('LU').value='';document.getElementById('LP').value='';const le=document.getElementById('LE');if(le)le.style.display='none';if(typeof switchAuthTab==='function')switchAuthTab('login');}
function updateCollegeSwitchPill(){
  const pill=document.getElementById('CSWPILL');if(!pill)return;
  // Cross-college access: ONLY admin1 who logged in via SMGG can switch into STMW
  const allowed=(_isPrimaryAdminSession() && HOME_COLLEGE==='smgg');
  pill.style.display=allowed?'':'none';
  const lbl=document.getElementById('CSWLBL');
  if(lbl) lbl.textContent=(CURRENT_COLLEGE==='smgg')?'Switch to STMW':'Back to SMGG';
  const heading=document.getElementById('APP_HEADING');
  if(heading){
    if(CURRENT_COLLEGE==='smgg') heading.textContent="St.Mary's Group Of Institutions Guntur For women";
    else if(CURRENT_COLLEGE==='smwec') heading.textContent="St.Mary's Womens Engineering College";
    else heading.textContent="St. Mary's Institutions";
  }
}
async function switchCollegeCtx(){
  if(!(_isPrimaryAdminSession() && HOME_COLLEGE==='smgg')){alert('You do not have access to switch colleges.');return;}
  const target=(CURRENT_COLLEGE==='smgg')?'smwec':'smgg';
  CURRENT_COLLEGE=target;
  localStorage.setItem('smv_last_college',target);
  _setSess('smv_sess_college',target);
  await _loadVouchersFromCloud();
  const cs=document.getElementById('f_college');if(cs){cs.value=target;cs.disabled=true;}
  updateCollegeSwitchPill();
  if(typeof initApp==='function') initApp();
  if(typeof setupRole==='function') setupRole();
  if(typeof _updateXLPill==='function') _updateXLPill();
  _startLiveSync();
}
function _authUserFromStorage(){
  try{const s=localStorage.getItem('smv_auth_user');return s?JSON.parse(s):null;}catch(e){return null;}
}
function _isOwnVoucher(v){
  const u=_authUserFromStorage();
  const identities=[u&&u.username,CU].filter(Boolean).map(x=>String(x).toLowerCase());
  const owners=[v&&v.created_by,v&&v.createdBy].filter(Boolean).map(x=>String(x).toLowerCase());
  return owners.some(owner=>identities.includes(owner));
}
function _isPrimaryAdminSession(){
  const u=_authUserFromStorage();
  if(u && u.role === 'head') return true;
  const n=String((u&&u.username)||'').toLowerCase();
  return n==='admin'||n==='admin1'||n==='admin_stmw';
}
function _uiUserCodeFromAuth(u,fallback){
  if(window._smvUiUserCode) return window._smvUiUserCode(u||fallback);
  const n=String((u&&u.username)||fallback||'').toLowerCase();
  if(n==='admin'||n==='admin1'||n==='admin_stmw'||(u&&u.role==='admin'))return'admin1';
  if(n==='user3'||n==='admin3'||n.indexOf('3')>-1)return'admin3';
  return'admin2';
}

// === Cloud voucher sync ===
async function _loadVouchersFromCloud(){
  const college=CURRENT_COLLEGE||'smgg';
  try{
    const j=await _api('listVouchers',{college});
    VS=Array.isArray(j.vouchers)?j.vouchers:[];
  }catch(e){ console.error('listVouchers',e); }
}
async function _saveVoucherToCloud(v){
  const college=CURRENT_COLLEGE||v.college||'smgg';
  try{ await _api('saveVoucher',{college,voucher:v}); }
  catch(e){ console.error('saveVoucher',e); _toast('Cloud save failed: '+(e.message||''),'err'); }
}
async function _deleteVoucherFromCloud(id){
  try{ await _api('deleteVoucher',{id}); }
  catch(e){ console.error('deleteVoucher',e); }
}
let _LIVE_TIMER=null, _LIVE_SIG='';
function _vsSignature(){ return VS.length+'|'+VS.map(v=>v.id+':'+(v._u||v.dateISO||'')).join(','); }
function _startLiveSync(){
  _stopLiveSync();
  _LIVE_SIG=_vsSignature();
  _LIVE_TIMER=setInterval(async ()=>{
    if(!CU||!CURRENT_COLLEGE) return;
    if(document.hidden) return;
    try{
      const college=CURRENT_COLLEGE;
      const j=await _api('listVouchers',{college});
      const next=Array.isArray(j.vouchers)?j.vouchers:[];
      const nextSig=next.length+'|'+next.map(v=>v.id+':'+(v._u||v.dateISO||'')).join(',');
      if(nextSig!==_LIVE_SIG){
        VS=next;
        _LIVE_SIG=nextSig;
        try{ if(typeof renderVT==='function') renderVT(); }catch(e){}
        try{ if(typeof renderDashboard==='function') renderDashboard(); }catch(e){}
        try{ if(typeof renderMyDashboard==='function') renderMyDashboard(); }catch(e){}
      }
      if (typeof fetchDynamicHeads === 'function') {
        fetchDynamicHeads();
      }
      if (typeof fetchDynamicBlocks === 'function') {
        fetchDynamicBlocks();
      }
    }catch(e){}
  }, 3000);
}
function _stopLiveSync(){ if(_LIVE_TIMER){ clearInterval(_LIVE_TIMER); _LIVE_TIMER=null; } }

function setupRole(){
  const a1=CU==='admin1';
  const a2=(CU==='admin2'||CU==='admin3');
  document.getElementById('A1NAV').style.display=a1?'':'none';
  document.getElementById('A2NAV').style.display=a2?'':'none';
  if(a1){show('dashboard');}
  else if(a2){show('mydashboard');}
  else{show('create');}
  
  document.querySelectorAll('.admin-only-add').forEach(el => {
    el.style.display = a1 ? 'inline' : 'none';
  });
}

// INIT
async function fetchDynamicHeads() {
  try {
    const res = await _api('listHeads', { college: CURRENT_COLLEGE || 'smgg' });
    if (res && res.heads) {
      const dl = document.getElementById('DL_HEADS');
      res.heads.forEach(h => {
        if (!HEADS.some(existing => existing.toLowerCase() === h.name.toLowerCase())) {
          HEADS.push(h.name);
          if (dl) dl.innerHTML += `<option>${h.name}</option>`;
        }
      });
      populateHeads();
      if(typeof populateMyHeads==='function') populateMyHeads();
    }
  } catch(e) {
    console.warn("Failed to fetch custom heads:", e);
  }
}

async function fetchDynamicBlocks() {
  try {
    const res = await _api('listBlocks', { college: CURRENT_COLLEGE || 'smgg' });
    if (res && res.blocks) {
      const dl = document.getElementById('DL_BLOCKS');
      res.blocks.forEach(b => {
        if (!BLOCKS.some(existing => existing.toLowerCase() === b.name.toLowerCase())) {
          BLOCKS.push(b.name);
          if (dl) dl.innerHTML += `<option>${b.name}</option>`;
        }
      });
    }
  } catch(e) {
    console.warn("Failed to fetch custom blocks:", e);
  }
}

function initApp(){
  fetchDynamicHeads();
  fetchDynamicBlocks();
  setupCustomHeadDropdowns();
  populateHeads();populateMyHeads();setDate();renderDash();renderMyDash();
  const today_str=new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const el=document.getElementById('DD');if(el)el.textContent='Today: '+today_str;
  const mel=document.getElementById('MDD');if(mel)mel.textContent='Today: '+today_str;
}
function today(){
  const t=new Date();
  const d=String(t.getDate()).padStart(2,'0');
  const m=String(t.getMonth()+1).padStart(2,'0');
  const y=t.getFullYear();
  return d+'-'+m+'-'+y;
}
function todayISO(){return new Date().toISOString().split('T')[0];}
function setDate(){
  document.getElementById('f_date').value=todayISO();
}
function isoToDMY(s){if(!s)return'';const p=s.split('-');if(p.length!==3)return s;return p[2]+'-'+p[1]+'-'+p[0];}
function dmyToISO(s){if(!s)return'';const p=s.split('-');if(p.length!==3)return s;return p[2]+'-'+p[1]+'-'+p[0];}
function autoDate(el){
  let v=el.value.replace(/[^0-9]/g,'');
  if(v.length>2&&v.length<=4)v=v.slice(0,2)+'-'+v.slice(2);
  else if(v.length>4)v=v.slice(0,2)+'-'+v.slice(2,4)+'-'+v.slice(4,8);
  el.value=v;
}
function parseDMY(s){
  const p=s.split('-');if(p.length!==3)return null;
  const d=parseInt(p[0]),m=parseInt(p[1])-1,y=parseInt(p[2]);
  return new Date(y,m,d);
}
function populateHeads(){
  const el=document.getElementById('FH');if(!el)return;
  el.innerHTML='<option value="">All Heads</option>';
  HEADS.forEach(h=>el.innerHTML+=`<option>${h}</option>`);
}

async function addNewHead(type) {
  const name = prompt("Enter new Head Name:");
  if(!name) return;
  const cleanName = name.trim();
  if(!cleanName) return;
  
  const lowerName = cleanName.toLowerCase();
  const exists = HEADS.some(h => h.toLowerCase() === lowerName);
  if (exists) {
    alert("This Head already exists!");
    return;
  }
  
  try {
    await _api('addHead', {
      name: cleanName,
      type: type,
      college: CURRENT_COLLEGE || 'smgg'
    });
    
    if (!HEADS.some(h => h.toLowerCase() === lowerName)) {
      HEADS.push(cleanName);
    }
    const dl = document.getElementById('DL_HEADS');
    if (dl) dl.innerHTML += `<option>${cleanName}</option>`;
    
    populateHeads();
    if(typeof populateMyHeads === 'function') populateMyHeads();
    
    if (type === 'credit') {
      const el = document.getElementById('fc_head');
      if (el) el.value = cleanName;
    } else if (type === 'onaccount') {
      const el = document.getElementById('fo_head');
      if (el) el.value = cleanName;
    }
    
    _toast("New Head added successfully!", "ok");
  } catch (err) {
    alert("Error adding Head: " + err.message);
  }
}

async function addNewBlock(type) {
  const name = prompt("Enter new Block Name:");
  if(!name) return;
  const cleanName = name.trim();
  if(!cleanName) return;
  
  const lowerName = cleanName.toLowerCase();
  const exists = BLOCKS.some(b => b.toLowerCase() === lowerName);
  if (exists) {
    alert("This Block already exists!");
    return;
  }
  
  try {
    await _api('addBlock', {
      name: cleanName,
      college: CURRENT_COLLEGE || 'smgg'
    });
    
    if (!BLOCKS.some(b => b.toLowerCase() === lowerName)) {
      BLOCKS.push(cleanName);
    }
    const dl = document.getElementById('DL_BLOCKS');
    if (dl) dl.innerHTML += `<option>${cleanName}</option>`;
    
    if (type === 'credit') {
      const el = document.getElementById('fc_block');
      if (el) el.value = cleanName;
    } else if (type === 'debit') {
      const el = document.getElementById('fd_block');
      if (el) el.value = cleanName;
    } else if (type === 'onaccount') {
      const el = document.getElementById('fo_block');
      if (el) el.value = cleanName;
    }
    
    _toast("New Block added successfully!", "ok");
  } catch (err) {
    alert("Error adding Block: " + err.message);
  }
}

// NAVIGATION
function show(id){
  document.querySelectorAll('.sec').forEach(s=>s.classList.remove('act'));
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('act'));
  const s=document.getElementById('sec-'+id);if(s)s.classList.add('act');
  const n=document.getElementById('ni-'+id);if(n)n.classList.add('act');
  if(id==='create' && !editId){
    resetF();
    const dbEl = document.querySelector('.vtc[data-t="debit"]');
    if(dbEl) selVT(dbEl, 'debit');
  }
  if(id==='dashboard')renderDash();
  if(id==='vouchers'){
    const sdf=document.getElementById('SDF'),sdt=document.getElementById('SDT');
    if(sdf&&sdt&&sdf.dataset.defaultDateSet!=='1'){
      const now=new Date(),localToday=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
      sdf.value=localToday;sdt.value=localToday;sdf.dataset.defaultDateSet='1';
    }
    renderVT();
  }
  if(id==='analytics')renderAnalytics();
  if(id==='mydashboard')renderMyDash();
  if(id==='myvouchers')renderMyVT();
  // Persist current page so refresh lands on same section
  _setSess('smv_sess_page',id);
}

// VOUCHER TYPE SELECT
function selVT(el,t){
  if(typeof el==='string'){t=el;el=document.querySelector(`.vtc[data-t="${t}"]`);}
  if(!['credit','debit','onaccount'].includes(t)||!el)return;
  document.querySelectorAll('.vtc').forEach(c=>{
    const active=c.dataset.t===t;
    c.classList.toggle('sel',active);
    c.setAttribute('aria-selected',active?'true':'false');
  });
  CVT=t;
  const labels={credit:'Credit Voucher',debit:'Debit Voucher',onaccount:'On- Account Voucher'};
  document.getElementById('FT').textContent=labels[t];
  ['credit','debit','onaccount'].forEach(type=>{
    const panel=document.getElementById('R_'+type);
    if(panel)panel.style.display=type===t?'':'none';
  });
  
}

document.addEventListener('keydown',function(e){
  const card=e.target.closest&&e.target.closest('.vtc[data-t]');
  if(card&&(e.key==='Enter'||e.key===' ')){
    e.preventDefault();
    selVT(card.dataset.t);
  }
});

// AMOUNT TO WORDS
function numToWords(n){
  if(!n||isNaN(n))return'';
  const a=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const b=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function t(n){if(n<20)return a[n];if(n<100)return b[Math.floor(n/10)]+(n%10?' '+a[n%10]:'');if(n<1000)return a[Math.floor(n/100)]+' Hundred'+(n%100?' '+t(n%100):'');if(n<100000)return t(Math.floor(n/1000))+' Thousand'+(n%1000?' '+t(n%1000):'');if(n<10000000)return t(Math.floor(n/100000))+' Lakh'+(n%100000?' '+t(n%100000):'');return t(Math.floor(n/10000000))+' Crore'+(n%10000000?' '+t(n%10000000):'');}
  const parts=String(n).split('.');const rs=parseInt(parts[0])||0;const ps=parseInt((parts[1]||'00').substring(0,2).padEnd(2,'0'));
  let w=t(rs)+' Rupees';if(ps>0)w+=' and '+t(ps)+' Paise';return w+' Only';
}
function autoWords(amid,wid){
  const v=parseFloat(document.getElementById(amid).value)||0;
  document.getElementById(wid).value=numToWords(v);
}

// SAVE VOUCHER
function getVal(id){const el=document.getElementById(id);return el?el.value.trim():'';}
function saveV(){
  const dateISO=getVal('f_date');if(!dateISO){alert('Please pick a date.');return;}
  const date=isoToDMY(dateISO);
  let v={id:editId||Date.now(),date,type:CVT,
    college:CURRENT_COLLEGE||getVal('f_college')||'smgg',
    prepBy:getVal('f_prep'),checkedBy:getVal('f_chk'),remarks:getVal('f_rem'),
    createdBy:CU,createdAt:new Date().toISOString()};
  if(CVT==='credit'){
    v.acName='Credit';v.head='Credit';v.receivedFrom=getVal('fc_from');
    v.towards=getVal('fc_towards');v.block=getVal('fc_block');v.amount=parseFloat(document.getElementById('fc_amt').value)||0;
    v.amtWords=getVal('fc_words');v.mode=getVal('fc_mode');v.cheque=getVal('fc_cheque');
    v.party=v.receivedFrom;
    if(!v.receivedFrom||!v.towards||!v.amount){alert('Fill Received From, Towards and Amount.');return;}
  } else if(CVT==='debit'){
    v.head=getVal('fd_head');v.paidTo=getVal('fd_paidto');v.towards=getVal('fd_towards');v.block=getVal('fd_block');
    v.amount=parseFloat(document.getElementById('fd_amt').value)||0;v.amtWords=getVal('fd_words');
    v.mode=getVal('fd_mode');v.cheque=getVal('fd_cheque');v.party=v.paidTo;
    if(!v.head||!v.paidTo||!v.towards||!v.amount){alert('Fill Account Head, Paid To, Towards and Amount.');return;}
  } else if(CVT==='onaccount'){
    v.head=getVal('fo_head');v.paidTo=getVal('fo_paidto');v.towards=getVal('fo_towards');v.block=getVal('fo_block');
    v.amount=parseFloat(document.getElementById('fo_amt').value)||0;v.amtWords=getVal('fo_words');
    v.mode=getVal('fo_mode');v.cheque=getVal('fo_ref');v.party=v.paidTo;
    if(!v.head||!v.paidTo||!v.towards||!v.amount){alert('Fill Account Head, Paid To, Towards and Amount.');return;}
  }
  if(editId){const i=VS.findIndex(x=>x.id===editId);if(i>-1){VS[i]=v;}editId=null;}
  else VS.push(v);
  v._u=new Date().toISOString();
  _saveVoucherToCloud(v);
  const saveBtn=document.querySelector('.bp');
  if(saveBtn) saveBtn.classList.add('saving');
  (async()=>{
    let ok=false;
    if(XLHandle){ ok=await autoSaveLinkedExcel(); }
    if(saveBtn) saveBtn.classList.remove('saving');
    if(XLHandle && ok) _toast('✅ Saved & updated '+XLName,'ok');
    else if(XLHandle && !ok) _toast('Voucher saved locally — Excel update failed','warn');
    else _toast('✅ Voucher saved on '+v.date+' — link an Excel file to auto-update','ok');
    resetF();show(CU==='admin1'?'vouchers':'myvouchers');
  })();
}
function resetF(){
  { const sel=document.getElementById('f_college'); if(sel){ sel.value=CURRENT_COLLEGE||'smgg'; sel.disabled=true; } }
  ['fc_from','fc_words','fc_towards','fc_block','fc_cheque',
   'fd_head','fd_paidto','fd_towards','fd_block','fd_words','fd_cheque',
   'fo_paidto','fo_towards','fo_block','fo_words','fo_ref',
   'fj_paidto','fj_towards','fj_words','fj_cheque',
   'f_prep','f_chk','f_rem'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  ['fc_amt','fd_amt','fo_amt','fj_amt'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const foHeadEl = document.getElementById('fo_head'); if(foHeadEl) foHeadEl.value = 'On Account';
  setDate();editId=null;
}


// MY DASHBOARD (admin2/admin3 — own vouchers only)
function renderMyDash(){
  if(CU==='admin1')return;
  const mdbf = document.getElementById('MDBF') ? document.getElementById('MDBF').value : '';
  const mdbt = document.getElementById('MDBT') ? document.getElementById('MDBT').value : '';
  let myVS=VS.filter(_isOwnVoucher);
  if(mdbf || mdbt) {
    myVS = myVS.filter(v => {
      const p = (v.date||'').split('-');
      if(p.length === 3) {
        const iso = p[2] + '-' + p[1] + '-' + p[0];
        if (mdbf && iso < mdbf) return false;
        if (mdbt && iso > mdbt) return false;
        return true;
      }
      return false;
    });
  }
  const lbl=ADMINS[CU]?ADMINS[CU].label:CU;
  const t=document.getElementById('MDB_TITLE');if(t)t.textContent=lbl+' — Dashboard';
  const tot=myVS.length,totAmt=myVS.reduce((s,v)=>s+v.amount,0),tod=myVS.filter(v=>v.date===today()).length;
  const sg=document.getElementById('MSG');if(!sg)return;
  sg.innerHTML=`
    <div class="sc"><div class="lbl">My Vouchers</div><div class="val">${tot}</div><div class="sub">${mdbf||mdbt ? 'Filtered' : 'All time'}</div></div>
    <div class="sc"><div class="lbl">My Total Amount</div><div class="val">₹${Math.round(totAmt)}</div><div class="sub">${mdbf||mdbt ? 'Filtered' : 'All vouchers'}</div></div>
    <div class="sc"><div class="lbl">Today</div><div class="val">${tod}</div><div class="sub">My vouchers today</div></div>
    <div class="sc"><div class="lbl">Debit</div><div class="val">${myVS.filter(v=>v.type==='debit').length}</div><div class="sub">Payments</div></div>
    <div class="sc"><div class="lbl">On- Account</div><div class="val">${myVS.filter(v=>v.type==='onaccount').length}</div><div class="sub">Transactions</div></div>
    <div class="sc"><div class="lbl">Credit</div><div class="val">${myVS.filter(v=>v.type==='credit').length}</div><div class="sub">Received</div></div>`;
  const rec=[...myVS].sort((a,b)=>(Date.parse(b.createdAt||b.created_at||'')||Number(b.id||0))-(Date.parse(a.createdAt||a.created_at||'')||Number(a.id||0))).slice(0,10);
  const bc={credit:'bc',debit:'bd',onaccount:'bo'};
  const rb=document.getElementById('MRB');if(!rb)return;
  rb.innerHTML=rec.map(v=>`<tr>
    <td><strong>${v.date}</strong></td>
    <td><span class="badge ${bc[v.type]||'bc'}">${v.type.toUpperCase()}</span></td>
    <td>${v.party||v.paidTo||v.receivedFrom||'–'}</td>
    <td style="font-size:11px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v.head||'–'}</td>
    <td>${v.mode||'Cash'}</td>
    <td style="font-weight:600">₹${Math.round(v.amount)}</td>
    <td><button class="btn bs bsm" onclick="openPM(VS.find(x=>x.id===${v.id}))" title="Print">🖨</button></td>
  </tr>`).join('');
}

// MY VOUCHERS TABLE (admin2/admin3)
function renderMyVT(){
  const myVS=VS.filter(_isOwnVoucher);
  const q=document.getElementById('MSQ').value.toLowerCase();
  const ft=document.getElementById('MFT2').value,fh=document.getElementById('MFH').value;
  const sdEl=document.getElementById('MSD'),sd=sdEl?sdEl.value:'';
  const f=myVS.filter(v=>{
    const sq=!q||((v.party||'')+(v.paidTo||'')+(v.receivedFrom||'')+(v.head||'')+' '+(v.towards||'')).toLowerCase().includes(q);
    let sdMatch=true;
    if(sd){const p=(v.date||'').split('-');if(p.length===3){const iso=p[2]+'-'+p[1]+'-'+p[0];sdMatch=(iso===sd);}else sdMatch=false;}
    return sq&&(!ft||v.type===ft)&&(!fh||v.head===fh)&&sdMatch;
  }).reverse();
  const bc={credit:'bc',debit:'bd',onaccount:'bo'};
  const tb=document.getElementById('MVTB');if(!tb)return;
  tb.innerHTML=f.map(v=>`<tr>
    <td><strong>${v.date}</strong></td>
    <td><span class="badge ${bc[v.type]||'bc'}">${v.type.toUpperCase()}</span></td>
    <td>${v.party||v.paidTo||v.receivedFrom||'–'}</td>
    <td style="font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v.head||'–'}</td>
    <td>${v.mode||'Cash'}</td>
    <td style="font-weight:600">₹${Math.round(v.amount)}</td>
    <td><div style="display:flex;gap:4px">
      <button class="btn bp bsm" onclick="quickPrint(${v.id})" title="Print">🖨</button>
      <button class="btn bs bsm" onclick="openPM(VS.find(x=>x.id===${v.id}))" title="View">👁</button>
    </div></td>
  </tr>`).join('');
  const emp=document.getElementById('MVT_EMPTY');if(emp)emp.style.display=f.length?'none':'block';
  const t=document.getElementById('MVT_TITLE');if(t)t.textContent=(ADMINS[CU]?ADMINS[CU].label:CU)+' — My Vouchers';
}

function populateMyHeads(){
  const el=document.getElementById('MFH');if(!el)return;
  el.innerHTML='<option value="">All Heads</option>';
  HEADS.forEach(h=>el.innerHTML+=`<option>${h}</option>`);
}

function doExcelMine(){
  try{
    if(typeof XLSX==='undefined'){alert('Excel library not ready.');return;}
    const myVS=VS.filter(_isOwnVoucher);
    if(!myVS.length){alert('No vouchers to export.');return;}
    const wb=XLSX.utils.book_new();
    const rows=myVS.map(v=>({
      'Date':v.date,'Type':v.type,
      'Party/Account':v.party||v.paidTo||v.receivedFrom||'',
      'Head':v.head||'','Towards':v.towards||'','Block':v.block||'','Amount':Math.round(v.amount),
      'Mode':v.mode||'','Prepared By':v.prepBy||'','Checked By':v.checkedBy||''
    }));
    const ws=XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb,ws,'My Vouchers');
    XLSX.writeFile(wb,(ADMINS[CU]?ADMINS[CU].label:'My')+'_Vouchers_'+new Date().toISOString().slice(0,10)+'.xlsx');
  }catch(e){alert('Export error: '+e.message);}
}

// BUILD PRINT HTML — pixel-perfect match to physical vouchers
function buildPrint(v){
  const isJS  = false;
  const isSMWEC = (v && v.college === 'smwec');
  const isDV  = v.type==='debit';
  const isOA  = v.type==='onaccount';
  const isCV  = v.type==='credit';

  // Background colours exactly as physical paper
  // All vouchers use the debit voucher (white) background — pink/blue removed per request
  const BG   = '#ffffff';
  // Title bar
  const TBARBG = isJS?'#1a3d2b':'#2b2b2b';
  const TYPETEXT = isCV?'CREDIT VOUCHER': isDV?'DEBIT VOUCHER': isOA?'ON ACCOUNT VOUCHER':'DEBIT VOUCHER';

  // Bottom-right signature label
  const SIGLBL = isCV?'Deposited by':'Signature of the Receiver';

  // Logo
  const LOGO_IMG = "assets/logo_smgg.png";

  // Institution name line 1
  const INST1 = isJS
    ? 'JOSEPH SRIHARSHA &amp; MARY INDRAJA EDUCATIONAL SOCIETY'
    : "ST. MARY'S GROUP OF INSTITUTIONS GUNTUR ";

  // Institution sub text
  const INST_SUB = isJS
    ? `<div style="font-size:6.5pt;font-weight:400;line-height:1.5;color:#111;text-align:center">Plot No.102, High Court Colony, Vanasthallapuram,<br>HYDERABAD – 500 070, A.P. INDIA</div>`
    : `<div style="font-size:6.5pt;font-weight:400;line-height:1.5;color:#111;text-align:center">( Formerly St. Mary Engineering College, St. Mary's PG Centre, St. Mary's College of Pharmacy)<br>(Joseph Sriharsha &amp; Mary Indraja Educational Society)<br>CHEBROLU (Vill &amp; Mdl), Guntur Dist – 522 212</div>`;
  // SMWEC override
  let _INST1_local = INST1;
  let _INST_SUB_local = INST_SUB;
  let _LOGO_local = LOGO_IMG;
  if (isSMWEC) {
    _INST1_local = "ST. MARY'S WOMEN'S ENGINEERING COLLEGE";
    _INST_SUB_local = `<div style="font-size:6.5pt;font-weight:400;line-height:1.5;color:#111;text-align:center">(Approved by AICTE, Permitted by Govt. of A.P. &amp; Affiliated to JNTU KAKINADA)<br>(Joseph Sriharsha &amp; Mary Indraja Educational Society)<br>BUDAMPADU VILLAGE, Guntur Rural, Guntur (Dt) - 522 017, A.P., INDIA</div>`;
    _LOGO_local = SMWEC_LOGO_SRC;
  }


  // Field rows — exactly 1 dotted line per field, label left, line extends to right edge
  const S = 'font-family:Arial,sans-serif;font-size:9.5pt;font-weight:700;white-space:nowrap';
  const LINE = 'border-bottom:1.5px dotted #555;flex:1;min-height:16px;padding-left:4px;font-size:9pt;font-family:Arial,sans-serif;line-height:1.5';

  // Single line row
  const ROW = (lbl,val,lw='90px') =>
    `<div style="display:flex;align-items:flex-end;margin-bottom:5px">
       <span style="${S};min-width:${lw};flex-shrink:0">${lbl}</span>
       <span style="${LINE}">${val||''}</span>
     </div>`;

  // Towards — exactly 3 dotted lines; text fills line 1 fully before spilling to line 2, then line 3
  const ROWT = (lbl,val,lw='90px') => {
    // Split text into up to 3 lines, filling each line before moving to the next
    const words = (val||'').split(' ');
    const CHARS_PER_LINE = 52; // approx chars that fit on one dotted line at 9pt
    let lines = ['','',''];
    let li = 0;
    for (const w of words) {
      if (li >= 3) break;
      const candidate = lines[li] ? lines[li] + ' ' + w : w;
      if (candidate.length <= CHARS_PER_LINE || !lines[li]) {
        lines[li] = candidate;
      } else {
        li++;
        if (li < 3) lines[li] = w;
      }
    }
    return `<div style="display:flex;align-items:flex-start;margin-bottom:5px">
       <span style="${S};min-width:${lw};flex-shrink:0;padding-top:2px">${lbl}</span>
       <div style="flex:1;display:flex;flex-direction:column;gap:4px">
         <div style="${LINE}">${lines[0]||'&nbsp;'}</div>
         <div style="${LINE}">${lines[1]||'&nbsp;'}</div>
         <div style="${LINE}">${lines[2]||'&nbsp;'}</div>
       </div>
     </div>`;
  };


  // Build field rows based on voucher type
  let FIELDS = '';
  if(isCV){
    FIELDS += ROW('Credit A/c', (v.acName||'')+(v.head?' — '+v.head:''));
    FIELDS += ROW('Received from', v.receivedFrom||'');
    FIELDS += ROW('Rupees', v.amtWords||'');
    FIELDS += ROWT('Towards', v.towards||'');
    FIELDS += ROW('Block', v.block||'');
  } else {
    FIELDS += ROW(isOA ? 'On Account' : 'Debit A/c', isOA ? '' : (v.head||''));
    FIELDS += ROW('Paid to', v.paidTo||'');
    FIELDS += ROW('Rupees', v.amtWords||'');
    FIELDS += ROWT('Towards', v.towards||'');
    FIELDS += ROW('Block', v.block||'');
  }
  if(v.remarks) FIELDS += ROW('Remarks', v.remarks);

  return `<div style="width:148mm;background:${BG};border:2px solid #111;font-family:Arial,sans-serif;box-sizing:border-box;page-break-after:always">

  <!-- HEADER -->
  <div style="display:flex;border-bottom:2px solid #111;background:${BG}">
    <div style="width:52px;flex-shrink:0;display:flex;align-items:center;justify-content:center;padding:3px;">
      <img src="${_LOGO_local}" width="46" height="46" style="object-fit:contain;display:block${isSMWEC?';mix-blend-mode:multiply;background:transparent':''}">
    </div>
    <div style="flex:1;padding:3px 6px 3px 5px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center">
      <div style="font-size:12pt;font-weight:900;line-height:1.2;font-family:Arial Black,Arial,sans-serif;letter-spacing:0.3px;text-align:center">${_INST1_local}</div>
      ${_INST_SUB_local}
    </div>
  </div>

  <!-- TYPE BANNER & DATE ROW -->
  <div style="display:flex;border-bottom:1px solid #888;background:${BG};align-items:stretch">
    <div style="flex:1;background:${TBARBG};color:#fff;font-size:13.5pt;font-weight:900;letter-spacing:3px;text-align:center;padding:4px 6px;font-family:Arial Black,Arial,sans-serif;display:flex;align-items:center;justify-content:center">
      ${TYPETEXT}
    </div>
    <div style="width:200px;flex-shrink:0;display:flex;justify-content:flex-start;align-items:center;padding:4px 8px;border-left:2px solid #111">
      <span style="font-size:10pt;font-weight:700;letter-spacing:0.5px;font-family:Arial,sans-serif;margin-right:8px">Date :</span>
      <span style="font-size:10pt;font-weight:400;font-family:Arial,sans-serif;border-bottom:1.5px dotted #555;flex:1;text-align:center">${v.date||''}</span>
    </div>
  </div>

  <!-- FIELDS -->
  <div style="padding:7px 8px 3px 8px;background:${BG}">
    ${FIELDS}
  </div>

  <!-- BOTTOM: CHECKED BY (left)|  RS (middle) | SIGNATURE (right) -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;border-top:2px solid #111;background:${BG}">
   
    <div style="padding:5px 8px;display:flex;flex-direction:column;justify-content:flex-end;min-height:55px">
      <div style="font-size:8.5pt;font-weight:700;font-family:Arial,sans-serif;border-top:1px solid #444;padding-top:3px;margin-top:32px">Checked by${v.checkedBy?' : '+v.checkedBy:''}</div>
    </div>
     <div style="padding:6px 8px;display:flex;flex-direction:column;justify-content:flex-start;min-height:55px">
      <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
        <span style="font-size:12.5pt;font-weight:900;letter-spacing:2px;font-family:Arial Black,Arial,sans-serif;flex-shrink:0">RS.</span>
        <div style="border:2px solid #111;flex:1;min-height:34px;display:flex;align-items:center;justify-content:center;font-size:11pt;font-weight:900;padding:2px 6px;font-family:Arial,sans-serif">${v.amount?Math.round(v.amount):''}</div>
      </div>
    </div>
    <div style="padding:5px 8px;display:flex;flex-direction:column;justify-content:flex-end;min-height:55px">
      <div style="font-size:8.5pt;font-weight:700;font-family:Arial,sans-serif;border-top:1px solid #444;padding-top:3px;margin-top:32px">${SIGLBL}</div>
    </div>
  </div>

  <!-- FOOTER -->
  <div style="border-top:1px solid #aaa;padding:2px 8px;font-size:7.5pt;color:#444;background:${BG};display:flex;justify-content:space-between;font-family:Arial,sans-serif">
    <span></span>
    <span>Mode: ${v.mode||'Cash'}${v.cheque?' | Ref: '+v.cheque:''}</span>
  </div>
</div>`;
}


// PREVIEW
function previewV(){
  const dateISO=getVal('f_date');if(!dateISO){alert('Pick a date first.');return;}
  const date=isoToDMY(dateISO);
  let v={id:'prev',date,type:CVT,
    college:CURRENT_COLLEGE||getVal('f_college')||'smgg',
    prepBy:getVal('f_prep'),checkedBy:getVal('f_chk'),remarks:getVal('f_rem'),createdBy:CU};
  if(CVT==='credit'){v.acName=getVal('fc_acname');v.head=getVal('fc_head');v.receivedFrom=getVal('fc_from');v.towards=getVal('fc_towards');v.block=getVal('fc_block');v.amount=parseFloat(document.getElementById('fc_amt').value)||0;v.amtWords=getVal('fc_words');v.mode=getVal('fc_mode');v.cheque=getVal('fc_cheque');}
  else if(CVT==='debit'){v.head=getVal('fd_head');v.paidTo=getVal('fd_paidto');v.towards=getVal('fd_towards');v.block=getVal('fd_block');v.amount=parseFloat(document.getElementById('fd_amt').value)||0;v.amtWords=getVal('fd_words');v.mode=getVal('fd_mode');v.cheque=getVal('fd_cheque');}
  else if(CVT==='onaccount'){v.head=getVal('fo_head');v.paidTo=getVal('fo_paidto');v.towards=getVal('fo_towards');v.block=getVal('fo_block');v.amount=parseFloat(document.getElementById('fo_amt').value)||0;v.amtWords=getVal('fo_words');v.mode=getVal('fo_mode');v.cheque=getVal('fo_ref');}
  openPM(v);
}
function openPM(v){
  const labels={credit:'CREDIT VOUCHER',debit:'DEBIT VOUCHER',onaccount:'ON- ACCOUNT VOUCHER'};
  document.getElementById('PMT').textContent=(v.date||'Preview')+' – '+labels[v.type];
  const _pa=document.getElementById('PA'); _pa.dataset.vid=String(v.id); _pa.innerHTML=buildPrint(v);
  document.getElementById('PM').classList.remove('h');
  updatePrintInfo();
}
function updatePrintInfo(){
  const sel=(document.getElementById('PRINT_SIZE')||{}).value||'a4_single';
  const el=document.getElementById('PRINT_INFO');if(!el)return;
  const msgs={
    a4_single:'📄 <strong>A4 Portrait — Full Width</strong> — A5 voucher scaled to fill the entire top half of A4. Zero margin, edge-to-edge. Recommended for all printers.',
    a4_double:'📄 <strong>A4 Portrait — 2 Per Page</strong> — two full-width vouchers stacked on one A4 sheet. Saves paper.',
    a5:'📄 <strong>A5 Direct</strong> — voucher prints at exact A5 size. Select A5 paper in your printer dialog.'
  };
  el.innerHTML=msgs[sel]||msgs['a4_single'];
}
function closeP(){document.getElementById('PM').classList.add('h');}
function doPrint(){
  const html=document.getElementById('PA').innerHTML;
  const sel=(document.getElementById('PRINT_SIZE')||{}).value||localStorage.getItem('smv_paperSize')||'a4_single';
  const behaviour=localStorage.getItem('smv_printBehaviour')||'silent';

  // If we have an active ESC/POS serial printer, use it
  if(window._serialPort && window._serialWriter){
    _serialPrintVoucher(html);
    return;
  }

  // Otherwise use browser print (dialog or silent iframe)
  _launchPrintWindow(html, sel, behaviour==='silent');
}

// Quick-print from table row — no preview modal, direct print
function quickPrint(id){
  const v = VS.find(x=>x.id===id);
  if(!v){ _toast('Voucher not found','err'); return; }
  const html = buildPrint(v);
  const sel = localStorage.getItem('smv_paperSize')||'a4_single';
  const behaviour = localStorage.getItem('smv_printBehaviour')||'silent';
  if(window._serialPort && window._serialWriter){
    _serialPrintVoucher(html); return;
  }
  _launchPrintWindow(html, sel, behaviour==='silent');
  _toast('🖨 Sending to printer…','ok');
}

// ============================================================
// SMV PRINT ENGINE v2 — Production-grade direct printing
// Priority chain:
//   1. Electron (silent, zero dialog)
//   2. QZ Tray (silent network/USB, no dialog)
//   3. ESC/POS WebSerial (thermal printers, already handled above)
//   4. Chrome Kiosk --kiosk-printing (dialog suppressed by flag)
//   5. Hidden-iframe browser print (standard, dialog opens pre-
//      selected on default printer — user just presses Enter)
// ============================================================

/* ── Environment detection ── */
var _PRINT_ENV = (function(){
  var env = {
    isElectron : typeof window !== 'undefined' && !!(window.electronAPI || (window.process && window.process.versions && window.process.versions.electron)),
    isKiosk    : /--kiosk-printing/.test(navigator.userAgent) || localStorage.getItem('smv_kioskMode')==='1',
    hasQZ      : false, // updated async below
    isMobile   : /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
    isChrome   : /Chrome/.test(navigator.userAgent) && !/Edge|OPR/.test(navigator.userAgent),
    isEdge     : /Edg\//.test(navigator.userAgent),
    hasSerial  : 'serial' in navigator,
  };
  // QZ Tray: check if qz object is loaded (user must include qz-tray.js separately)
  if(typeof qz !== 'undefined' && qz && qz.websocket) env.hasQZ = true;
  return env;
})();

/* ── Detect QZ Tray asynchronously and cache ── */
function _detectQZ(){
  return new Promise(function(resolve){
    if(typeof qz === 'undefined'){ resolve(false); return; }
    try{
      qz.websocket.connect().then(function(){ _PRINT_ENV.hasQZ=true; resolve(true); })
                            .catch(function(){ resolve(false); });
    }catch(e){ resolve(false); }
  });
}

/* ── Build the print HTML document for a given paper size ──
   KEY FIX: replace transform:scale (which clips/blurs) with
   width-based scaling using zoom + @page exact dimensions.
   The voucher is natively 148mm wide; A4 is 210mm.
   Instead of scaling a 148mm box, we declare the print page
   as 148mm wide (matching the voucher) and let @page handle
   stretching when the user picks their paper tray. This avoids
   ALL clipping, blurring, and overflow bugs.
──────────────────────────────────────────────────────────── */
function _buildPrintDoc(html, sel){
  var pageCSS, bodyHTML;

  var COLOR_EXACT = '*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}';

  if(sel === 'a4_double'){
    // Two vouchers on one A4 — use native 210mm width, no scale transform.
    // Each voucher slot is given exactly half the A4 height (148.5mm).
    // Voucher (148mm) is stretched to 210mm via width:100% + overflow:hidden.
    pageCSS = `
      @page{size:210mm 297mm portrait;margin:6mm}
      *{box-sizing:border-box;margin:0;padding:0}
      html,body{width:198mm;margin:0;padding:0;background:#fff;font-family:Arial,sans-serif}
      .a4-page{width:198mm;height:285mm;overflow:hidden;background:#fff;position:relative}
      .voucher-slot{
        width:210mm;height:148.5mm;overflow:hidden;position:relative;
        display:flex;align-items:flex-start;justify-content:center;
      }
      /* Scale voucher content (148mm native) up to 210mm without transform */
      .voucher-slot > *{
        width:148mm!important;
        transform:scale(1.41891);
        transform-origin:top left;
        flex-shrink:0;
      }
      .vs-top{border-bottom:1px dashed #ccc}
      @media print{
        @page{margin:6mm}
        ${COLOR_EXACT}
        .a4-page{page-break-after:always}
      }`;
    bodyHTML = `<div class="a4-page">
      <div class="voucher-slot vs-top"><div>${html}</div></div>
      <div class="voucher-slot"><div>${html}</div></div>
    </div>`;

  } else if(sel === 'a5'){
    // A5 direct — voucher IS A5 (148×210mm), no scaling needed.
    // We set the page to exactly 148×210mm and let the voucher fill it naturally.
    pageCSS = `
      @page{size:148mm 210mm portrait;margin:5mm}
      *{box-sizing:border-box;margin:0;padding:0}
      html,body{width:138mm;margin:0;padding:0;background:#fff;font-family:Arial,sans-serif}
      .a5-page{width:138mm;overflow:hidden;background:#fff}
      .voucher-slot{width:148mm;overflow:hidden}
      @media print{
        @page{margin:6mm}
        ${COLOR_EXACT}
        .a5-page{page-break-after:always}
      }`;
    bodyHTML = `<div class="a5-page">
      <div class="voucher-slot">${html}</div>
    </div>`;

  } else {
    // Default: A4 portrait, voucher fills top half edge-to-edge.
    // FIX: declare page width as 148mm (voucher native width) then scale
    // via zoom so it fills A4 without transform clipping.
    // zoom:1.41891 enlarges the 148mm layout to ~210mm on screen/print.
    pageCSS = `
      @page{size:210mm 297mm portrait;margin:6mm}
      *{box-sizing:border-box;margin:0;padding:0}
      html{margin:0;padding:0;background:#fff}
      body{width:148mm;margin:0;padding:0;background:#fff;font-family:Arial,sans-serif;
           zoom:1.337;-moz-transform:scale(1.337);-moz-transform-origin:top left}
      .a4-page{width:148mm;overflow:hidden;background:#fff}
      .voucher-slot{width:148mm;overflow:hidden}
      @media print{
        @page{margin:6mm}
        ${COLOR_EXACT}
        .a4-page{page-break-after:always}
      }`;
    bodyHTML = `<div class="a4-page">
      <div class="voucher-slot">${html}</div>
    </div>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>St Mary's Voucher</title>
<style>
${pageCSS}
</style></head><body>
${bodyHTML}
<script>
(function(){
  'use strict';
  // Signal parent iframe that we are ready (used by _launchPrintIframe)
  if(window.parent && window.parent !== window){
    try{ window.parent.postMessage({smvPrintReady:true},'*'); }catch(e){}
  }
  window.addEventListener('afterprint', function(){
    setTimeout(function(){ try{ window.close(); }catch(e){} }, 500);
  });
  function go(){
    try{ window.focus(); window.print(); }
    catch(e){ console.error('SMV print error:',e); }
  }
  if(document.readyState==='complete'){ setTimeout(go, 280); }
  else{ window.addEventListener('load', function(){ setTimeout(go, 280); }); }
})();
<\/script>
</body></html>`;
}

/* ── Path 1: Electron silent print ──
   Works when the app is packaged with Electron.
   Requires main process to expose: window.electronAPI.silentPrint(html, options)
   See README / Electron integration section below. ── */
function _tryElectronPrint(html, sel){
  if(!_PRINT_ENV.isElectron) return false;
  try{
    var api = window.electronAPI || (window.require && window.require('electron').ipcRenderer);
    if(api && api.silentPrint){
      var paperMap = {a4_single:'A4', a4_double:'A4', a5:'A5'};
      api.silentPrint({
        html   : _buildPrintDoc(html, sel),
        paper  : paperMap[sel]||'A4',
        silent : true,
        copies : 1
      });
      _toast('🖨 Sent to printer (Electron silent)','ok');
      return true;
    }
  }catch(e){ console.warn('Electron print failed:', e); }
  return false;
}

/* ── Path 2: QZ Tray silent print ──
   QZ Tray must be installed on the client machine and
   qz-tray.js loaded. Provides true silent printing to any
   named network or USB printer. ── */
async function _tryQZTrayPrint(html, sel){
  if(!_PRINT_ENV.hasQZ) return false;
  try{
    if(!qz.websocket.isActive()) await qz.websocket.connect();
    var printerName = localStorage.getItem('smv_qzPrinter') || await qz.printers.getDefault();
    var cfg = qz.configs.create(printerName, {
      colorType   : 'color',
      duplex      : false,
      copies      : 1,
      orientation : 'portrait',
      size        : sel==='a5' ? {width:148,height:210,units:'mm'} : {width:210,height:297,units:'mm'}
    });
    var data = [{
      type   : 'pixel',
      format : 'html',
      flavor : 'plain',
      data   : _buildPrintDoc(html, sel)
    }];
    await qz.print(cfg, data);
    _toast('🖨 Sent via QZ Tray to ' + printerName,'ok');
    return true;
  }catch(e){
    console.warn('QZ Tray print failed:', e);
    return false;
  }
}

/* ── Path 3 (main): Hidden iframe print ──
   Works in all browsers. Print dialog opens pre-loaded with
   the system default printer. In Chrome --kiosk-printing mode
   the dialog is bypassed entirely (true silent printing).
   Fixed: proper onload sequencing, message-based ready signal,
   and afterprint cleanup — no blank pages, no race conditions. ── */
function _launchPrintIframe(html, sel){
  // Remove any lingering frame from a previous print
  var old = document.getElementById('__printFrame');
  if(old) old.remove();

  var f = document.createElement('iframe');
  f.id  = '__printFrame';
  f.setAttribute('aria-hidden','true');
  // Visually hidden but NOT display:none — display:none blocks print in some browsers
  f.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none;z-index:-1';
  document.body.appendChild(f);

  var fullDoc = _buildPrintDoc(html, sel);
  var triggered = false;

  function cleanup(){
    setTimeout(function(){
      try{ if(f && f.parentNode) f.parentNode.removeChild(f); }catch(e){}
    }, 2000);
  }

  function triggerPrint(){
    if(triggered) return;
    triggered = true;
    try{
      f.contentWindow.focus();
      f.contentWindow.print();
    }catch(e){ console.error('SMV iframe print error:', e); }
    // Guaranteed cleanup even if afterprint never fires (Safari, some mobile)
    setTimeout(cleanup, 45000);
  }

  // Listen for the ready signal posted from inside the iframe
  function onMsg(e){
    if(e.data && e.data.smvPrintReady){
      window.removeEventListener('message', onMsg);
      setTimeout(triggerPrint, 100); // small buffer for final render
    }
  }
  window.addEventListener('message', onMsg);

  // afterprint cleanup
  try{ f.contentWindow.addEventListener('afterprint', cleanup); }catch(e){}

  // Write content
  try{
    var doc = f.contentDocument || f.contentWindow.document;
    doc.open('text/html','replace');
    doc.write(fullDoc);
    doc.close();
  }catch(e){
    // Cross-origin fallback (shouldn't occur with blob: or same-origin srcdoc)
    f.srcdoc = fullDoc;
  }

  // Belt-and-suspenders: if message never arrives, fall back to onload
  f.onload = function(){
    setTimeout(function(){
      if(!triggered) triggerPrint();
    }, 350);
  };
}

/* ── Main dispatcher ── */
async function _launchPrintWindow(html, sel, silentMode){
  // 1. Electron
  if(_PRINT_ENV.isElectron && _tryElectronPrint(html, sel)) return;

  // 2. QZ Tray (async detect on first use)
  if(typeof qz !== 'undefined'){
    var qzOk = await _tryQZTrayPrint(html, sel);
    if(qzOk) return;
  }

  // 3. Hidden-iframe (works for all browser print including kiosk mode)
  _launchPrintIframe(html, sel);
}

// DASHBOARD
function renderDash(){
  if(CU!=='admin1')return;
  const dbf = document.getElementById('DBF') ? document.getElementById('DBF').value : '';
  const dbt = document.getElementById('DBT') ? document.getElementById('DBT').value : '';
  let fvs = VS;
  if(dbf || dbt) {
    fvs = VS.filter(v => {
      const p = (v.date||'').split('-');
      if(p.length === 3) {
        const iso = p[2] + '-' + p[1] + '-' + p[0];
        if (dbf && iso < dbf) return false;
        if (dbt && iso > dbt) return false;
        return true;
      }
      return false;
    });
  }
  const tot=fvs.length,totAmt=fvs.reduce((s,v)=>s+v.amount,0),tod=fvs.filter(v=>v.date===today()).length;
  document.getElementById('SG').innerHTML=`
    <div class="sc"><div class="lbl">Total Vouchers</div><div class="val">${tot}</div><div class="sub">${dbf||dbt ? 'Filtered' : 'All time'}</div></div>
    <div class="sc"><div class="lbl">Total Amount</div><div class="val">₹${Math.round(totAmt)}</div><div class="sub">${dbf||dbt ? 'Filtered' : 'All vouchers'}</div></div>
    <div class="sc"><div class="lbl">Today</div><div class="val">${tod}</div><div class="sub">Vouchers today</div></div>
    <div class="sc"><div class="lbl">Debit</div><div class="val">${fvs.filter(v=>v.type==='debit').length}</div><div class="sub">Payments</div></div>
    <div class="sc"><div class="lbl">On- Account</div><div class="val">${fvs.filter(v=>v.type==='onaccount').length}</div><div class="sub">Transactions</div></div>
    <div class="sc"><div class="lbl">Credit</div><div class="val">${fvs.filter(v=>v.type==='credit').length}</div><div class="sub">Received</div></div>`;
  const rec=[...fvs].sort((a,b)=>(Date.parse(b.createdAt||b.created_at||'')||Number(b.id||0))-(Date.parse(a.createdAt||a.created_at||'')||Number(a.id||0))).slice(0,10);
  const bc={credit:'bc',debit:'bd',onaccount:'bo'};
  document.getElementById('RB').innerHTML=rec.map(v=>`<tr>
    <td><strong>${v.date}</strong></td>
    <td><span class="badge ${bc[v.type]||'bc'}">${v.type.toUpperCase()}</span></td>
    <td>${v.party||v.paidTo||v.receivedFrom||'–'}</td>
    <td style="font-size:11px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v.head||'–'}</td>
    <td>${v.mode||'Cash'}</td>
    <td style="font-weight:600">₹${Math.round(v.amount)}</td>
    <td><button class="btn bs bsm" onclick="openPM(VS.find(x=>x.id===${v.id}))" title="Print">🖨</button></td>
  </tr>`).join('');
}

// VOUCHER TABLE
function getFilteredVS(){
  const qEl=document.getElementById('SQ');const q=qEl?qEl.value.toLowerCase():'';
  const ftEl=document.getElementById('FT2');const ft=ftEl?ftEl.value:'';
  const fhEl=document.getElementById('FH');const fh=fhEl?fhEl.value:'';
  const fcEl=document.getElementById('FC');const fc=fcEl?fcEl.value:'';
  const sdfEl=document.getElementById('SDF'),sdf=sdfEl?sdfEl.value:'';
  const sdtEl=document.getElementById('SDT'),sdt=sdtEl?sdtEl.value:'';
  return VS.filter(v=>{
    const sq=!q||((v.party||'')+(v.paidTo||'')+(v.receivedFrom||'')+(v.head||'')+' '+(v.towards||'')).toLowerCase().includes(q);
    let dMatch=true;
    if(sdf||sdt){
      const p=(v.date||'').split('-');
      if(p.length===3){
        const iso=p[2]+'-'+p[1]+'-'+p[0];
        if(sdf&&iso<sdf)dMatch=false;
        if(sdt&&iso>sdt)dMatch=false;
      }else dMatch=false;
    }
    return sq&&(!ft||v.type===ft)&&(!fh||v.head===fh)&&(!fc||v.college===fc)&&dMatch;
  });
}
function renderVT(){
  const f=getFilteredVS().sort((a,b)=>{
    const bt=Date.parse(b.createdAt||b.created_at||'')||0;
    const at=Date.parse(a.createdAt||a.created_at||'')||0;
    if(bt!==at)return bt-at;
    const bd=dmyToISO(b.date||''),ad=dmyToISO(a.date||'');
    if(bd!==ad)return bd.localeCompare(ad);
    return Number(b.id||0)-Number(a.id||0);
  });
  const bc={credit:'bc',debit:'bd',onaccount:'bo'};
  
  if (f.length === 0) {
    document.getElementById('VTB').innerHTML = '<tr><td colspan="10" style="text-align:center;">No vouchers found.</td></tr>';
    document.getElementById('VC').textContent=`Showing 0 of ${VS.length} vouchers`;
    return;
  }

  let grandTotal = 0;
  let html = '';
  f.forEach(v => {
      grandTotal += Math.round(Number(v.amount) || 0);
      const colName = v.college ? v.college.toUpperCase() : 'SMGG';
      const ts = v.createdAt ? new Date(v.createdAt).toLocaleString('en-IN') : '';
      html += `<tr>
    <td><strong>${v.date}</strong></td>
    <td><span class="badge ${bc[v.type]||'bc'}">${v.type.toUpperCase()}</span></td>
    <td>${v.party||v.paidTo||v.receivedFrom||'–'}</td>
    <td style="font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v.head||'–'}</td>
    <td><span style="font-size:10px;background:#eef;padding:2px 4px;border-radius:3px;font-weight:600;color:#333;">${colName}</span></td>
    <td>${v.mode||'Cash'}</td>
    <td style="font-weight:600">₹${Math.round(v.amount)}</td>
    <td style="font-size:11px">${v.createdBy||'–'}</td>
    <td style="font-size:10px;color:#666">${ts}</td>
    <td><div style="display:flex;gap:4px">
      <button class="btn bp bsm" onclick="quickPrint(${v.id})" title="Print">🖨</button>
      <button class="btn bs bsm" onclick="openPM(VS.find(x=>x.id===${v.id}))" title="View">👁</button>
      <button class="btn bs bsm" onclick="editV(${v.id})" title="Edit">✏️</button>
      <button class="btn br bsm" onclick="delV(${v.id})" title="Delete">🗑</button>
    </div></td>
  </tr>`;
  });
  
  html += `<tr>
    <td colspan="6" style="text-align:right;font-weight:900;font-size:15px;color:#000;padding-top:12px;">GRAND TOTAL:</td>
    <td style="font-weight:900;font-size:15px;color:#7B1D2E;padding-top:12px;">₹${grandTotal}</td>
    <td colspan="3"></td>
  </tr>`;

  document.getElementById('VTB').innerHTML = html;
  document.getElementById('VC').textContent=`Showing ${f.length} of ${VS.length} vouchers`;
}
function delV(id){if(!confirm('Delete this voucher?'))return;VS=VS.filter(v=>v.id!==id);_deleteVoucherFromCloud(id);renderVT();}
function editV(id){
  const v=VS.find(x=>x.id===id);if(!v)return;
  show('create');CVT=v.type;
  document.querySelectorAll('.vtc').forEach(c=>{c.classList.remove('sel');if(c.dataset.t===v.type)c.classList.add('sel');});
  selVT(document.querySelector(`.vtc[data-t="${v.type}"]`),v.type);
  document.getElementById('f_date').value=dmyToISO(v.date);
  { const sel=document.getElementById('f_college'); if(sel) sel.value=v.college||'smgg'; }
  document.getElementById('f_prep').value=v.prepBy||'';
  document.getElementById('f_chk').value=v.checkedBy||'';
  document.getElementById('f_rem').value=v.remarks||'';
  if(v.type==='credit'){
    document.getElementById('fc_acname').value=v.acName||'';
    document.getElementById('fc_head').value=v.head||'';
    document.getElementById('fc_from').value=v.receivedFrom||'';
    document.getElementById('fc_towards').value=v.towards||'';
    document.getElementById('fc_block').value=v.block||'';
    document.getElementById('fc_amt').value=v.amount||'';
    document.getElementById('fc_words').value=v.amtWords||'';
    document.getElementById('fc_mode').value=v.mode||'Cash';
    document.getElementById('fc_cheque').value=v.cheque||'';
  } else if(v.type==='debit'){
    document.getElementById('fd_head').value=v.head||'';
    document.getElementById('fd_paidto').value=v.paidTo||'';
    document.getElementById('fd_towards').value=v.towards||'';
    document.getElementById('fd_block').value=v.block||'';
    document.getElementById('fd_amt').value=v.amount||'';
    document.getElementById('fd_words').value=v.amtWords||'';
    document.getElementById('fd_mode').value=v.mode||'Cash';
    document.getElementById('fd_cheque').value=v.cheque||'';
  } else if(v.type==='onaccount'){
    document.getElementById('fo_head').value=v.head||'';
    document.getElementById('fo_paidto').value=v.paidTo||'';
    document.getElementById('fo_towards').value=v.towards||'';
    document.getElementById('fo_block').value=v.block||'';
    document.getElementById('fo_amt').value=v.amount||'';
    document.getElementById('fo_words').value=v.amtWords||'';
    document.getElementById('fo_mode').value=v.mode||'Cash';
    document.getElementById('fo_ref').value=v.cheque||'';
  }
  editId=id;
}

// ANALYTICS
function renderAnalytics(){
  const hT={};HEADS.forEach(h=>hT[h]=0);VS.forEach(v=>{if(v.head)hT[v.head]=(hT[v.head]||0)+v.amount;});
  const sorted=Object.entries(hT).filter(e=>e[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const mx=sorted[0]?sorted[0][1]:1;
  document.getElementById('HC').innerHTML=sorted.map(([h,a])=>`
    <div class="bar-row">
      <div class="bar-lbl" title="${h}">${h.length>18?h.substring(0,18)+'…':h}</div>
      <div class="bar-trk"><div class="bar-fill" style="width:${Math.round(a/mx*100)}%;background:#7B1D2E">₹${Math.round(a)}</div></div>
    </div>`).join('')||'<p style="color:#9A9488;font-size:12px">No data yet</p>';
  const types={debit:0,onaccount:0,credit:0};
  VS.forEach(v=>types[v.type]=(types[v.type]||0)+1);
  const tot=VS.length||1,cols=['#7A3800','#880E4F','#1B4F9E'],lbs=['Debit','On- Acct','Credit'];
  const tvals=[types.debit,types.onaccount,types.credit];let cum=0;
  const segs=tvals.map((val,i)=>{const p=val/tot*100;const s=`<circle cx="55" cy="55" r="38" fill="none" stroke="${cols[i]}" stroke-width="20" stroke-dasharray="${p*2.39} ${(100-p)*2.39}" stroke-dashoffset="${-cum*2.39+59.8}" transform="rotate(-90 55 55)"/>`;cum+=p;return s;});
  document.getElementById('TC').innerHTML=`<div class="dw"><svg width="110" height="110" viewBox="0 0 110 110"><circle cx="55" cy="55" r="38" fill="none" stroke="#eee" stroke-width="20"/>${segs.join('')}<text x="55" y="60" text-anchor="middle" font-size="14" font-weight="700" fill="#7B1D2E">${VS.length}</text></svg><div class="ll">${lbs.map((l,i)=>`<div style="display:flex;align-items:center;gap:6px"><div class="ld" style="background:${cols[i]}"></div><span>${l}: ${tvals[i]}</span></div>`).join('')}</div></div>`;
  const months={};VS.forEach(v=>{let m='?';if(v.date&&v.date.length>=7){const p=v.date.split('-');if(p.length===3)m=p[2]+'-'+p[1];else m=v.date.substring(0,7);}months[m]=(months[m]||0)+1;});
  const ms=Object.entries(months).sort((a,b)=>a[0].localeCompare(b[0])).slice(-8);
  const mm=ms[0]?Math.max(...ms.map(e=>e[1])):1;
  document.getElementById('MC').innerHTML=ms.map(([m,c])=>`<div class="bar-row"><div class="bar-lbl">${m}</div><div class="bar-trk"><div class="bar-fill" style="width:${Math.round(c/mm*100)}%;background:#B8960C">${c}</div></div></div>`).join('')||'<p style="color:#9A9488;font-size:12px">No data yet</p>';
}

// EXCEL EXPORT
function doExcel(silent=false){
  try{
    if(typeof XLSX==='undefined'){
      if(!silent) alert('Excel library not ready. Please wait a moment and try again.');
      return;
    }
    if(!VS.length){
      if(!silent) alert('No vouchers to export.');
      return;
    }

    const EXPVS = (typeof getFilteredVS==='function') ? getFilteredVS() : VS;
    if(!EXPVS.length){if(!silent) alert('No vouchers match the current filter to export.');return;}
    const typeLabel=t=>t==='credit'?'Credit':t==='debit'?'Debit':'On- Account';

    const rows=EXPVS.map((v,i)=>({
      'S.No': i+1,
      'Date': v.date||'',
      'Voucher Type': typeLabel(v.type),
      'Account Name / Credit A/c': v.acName||'',
      'Account Head / Debit A/c': v.head||'',
      'Received From': v.receivedFrom||'',
      'Paid To': v.paidTo||'',
      'Towards (Purpose)': v.towards||'',
      'Block': v.block||'',
      'Amount (Rs.)': Math.round(Number(v.amount)||0),
      'Amount in Words': v.amtWords||'',
      'Payment Mode': v.mode||'',
      'Cheque / Ref No.': v.cheque||'',
      'Checked By': v.checkedBy||'',
      'Remarks': v.remarks||'',
      'Created By': v.createdBy||'',
      'Created At': v.createdAt?new Date(v.createdAt).toLocaleString('en-IN'):''
    }));

    const ws = XLSX.utils.json_to_sheet(rows);

    ws['!cols']=[
      {wch:5},{wch:12},{wch:13},
      {wch:22},{wch:28},{wch:22},{wch:22},{wch:42},
      {wch:14},{wch:40},{wch:13},{wch:18},
      {wch:18},{wch:28},{wch:13},{wch:22}
    ];

    // Freeze header row
    ws['!freeze']={xSplit:0,ySplit:1};

    // Bold + colour header
    const range = XLSX.utils.decode_range(ws['!ref']);
    for(let C=range.s.c; C<=range.e.c; C++){
      const addr = XLSX.utils.encode_cell({r:0,c:C});
      if(!ws[addr]) continue;
      ws[addr].s = {
        font:{bold:true, color:{rgb:'FFFFFF'}, sz:10},
        fill:{patternType:'solid', fgColor:{rgb:'7B1D2E'}},
        alignment:{horizontal:'center', vertical:'center', wrapText:true},
        border:{bottom:{style:'thin',color:{rgb:'000000'}}}
      };
    }

    // Data rows: alternate shading, amount bold right
    for(let R=1; R<=range.e.r; R++){
      const shade = R%2===0?'F2E8EA':'FFFFFF';
      for(let C=range.s.c; C<=range.e.c; C++){
        const addr = XLSX.utils.encode_cell({r:R,c:C});
        if(!ws[addr]) ws[addr]={t:'s',v:''};
        const isAmt = C===8;
        ws[addr].s = {
          fill:{patternType:'solid', fgColor:{rgb:shade}},
          font: isAmt?{bold:true}:{},
          alignment: isAmt
            ? {horizontal:'right', vertical:'center'}
            : {vertical:'center', wrapText:true},
          border:{
            top:{style:'thin',color:{rgb:'DDDDDD'}},
            bottom:{style:'thin',color:{rgb:'DDDDDD'}},
            left:{style:'thin',color:{rgb:'DDDDDD'}},
            right:{style:'thin',color:{rgb:'DDDDDD'}}
          }
        };
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vouchers');

    // ── Summary sheet ──
    const total = EXPVS.reduce((s,v)=>s+(Number(v.amount)||0), 0);
    const counts = {Debit:0,'On- Account':0,Credit:0};
    const amounts= {Debit:0,'On- Account':0,Credit:0};
    EXPVS.forEach(v=>{
      const k=typeLabel(v.type);
      counts[k]=(counts[k]||0)+1;
      amounts[k]=(amounts[k]||0)+(Number(v.amount)||0);
    });
    const sdfV=(document.getElementById('SDF')||{}).value||'';
    const sdtV=(document.getElementById('SDT')||{}).value||'';
    const rangeLine = (sdfV||sdtV) ? ("Date Range: "+(sdfV||'…')+" to "+(sdtV||'…')) : "Date Range: All";
    const sumData=[
      ["ST. MARY'S GROUP OF INSTITUTIONS GUNTUR FOR WOMEN","",""],
      ["Voucher Export — "+today(),"",""],
      [rangeLine,"",""],
      ["","",""],
      ["SUMMARY","",""],
      ["Total Vouchers",EXPVS.length,""],
      ["Total Amount (Rs.)",total,""],
      ["","",""],
      ["Voucher Type","Count","Total Amount (Rs.)"],
      ["Debit",counts['Debit'],amounts['Debit']],
      ["On- Account",counts['On- Account'],amounts['On- Account']],
      ["Credit",counts['Credit'],amounts['Credit']],
      ["","",""],
      ["Grand Total",EXPVS.length,total]
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(sumData);
    ws2['!cols']=[{wch:38},{wch:14},{wch:20}];
    XLSX.utils.book_append_sheet(wb, ws2, 'Summary');

    const fname = 'StMarys_Vouchers_'+today()+'.xlsx';
    XLSX.writeFile(wb, fname, {bookType:'xlsx', type:'binary'});
    if(!silent){_toast('✅ Excel exported: '+fname,'ok'); if(!XLHandle) _toast('Tip: click 📎 Link Excel to auto-update on every Save','warn');}

  } catch(err){
    console.error('Excel export error:',err);
    if(!silent) alert('Export failed: '+err.message);
  }
}

// =============================================
// LEDGER REPORT EXPORT — Head wise and All Heads summary
// =============================================
function exportLedger(silent=false){
  try{
    if(typeof XLSX==='undefined'){
      if(!silent) alert('Excel library not ready. Please wait a moment and try again.');
      return;
    }
    const EXPVS = (typeof getFilteredVS==='function') ? getFilteredVS() : VS;
    if(!EXPVS.length){if(!silent) alert('No vouchers match the current filter to export.');return;}

    // Determine min/max date using ISO values, then display as DD-MM-YYYY.
    const ledgerDateISO = v => {
      const raw = String(v.dateISO || v.date || '').trim();
      if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
      if(/^\d{2}-\d{2}-\d{4}$/.test(raw)) {
        const [day,month,year] = raw.split('-');
        return `${year}-${month}-${day}`;
      }
      return '';
    };
    let minDate = '9999-12-31', maxDate = '0000-00-00';
    EXPVS.forEach(v => {
      const dateISO = ledgerDateISO(v);
      if(dateISO) {
        if(dateISO < minDate) minDate = dateISO;
        if(dateISO > maxDate) maxDate = dateISO;
      }
    });
    if(minDate === '9999-12-31') minDate = '-';
    if(maxDate === '0000-00-00') maxDate = '-';
    
    const fmtDate = (d) => {
      if(!d || d==='-') return '';
      const [y,m,day] = d.split('-');
      return `${day}-${m}-${y}`;
    };
    const dateRangeStr = `Date ${fmtDate(minDate)} to ${fmtDate(maxDate)}`;

    // Group vouchers by Head
    const heads = {};
    EXPVS.forEach(v => {
      const h = v.head || 'Uncategorized';
      if(!heads[h]) heads[h] = [];
      heads[h].push(v);
    });

    const wb = XLSX.utils.book_new();
    const headNames = Object.keys(heads).sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    
    const allHeadsData = [];
    for(let i=0; i<4; i++) allHeadsData.push([]);
    
    const collName = (CURRENT_COLLEGE==='smwec') ? 'STMW Ledger' : 'SMGG Ledger';
    
    const row5 = [];
    row5[6] = collName + '                            ' + dateRangeStr;
    allHeadsData[4] = row5;
    allHeadsData[5] = []; 
    
    const row7 = [];
    row7[6] = 'All Heads';
    row7[7] = 'Amount';
    row7[8] = 'Amount';
    allHeadsData[6] = row7;

    const isCashMode = v => String(v.mode || 'Cash').trim().toLowerCase() === 'cash';
    let grandTotCash = 0, grandTotBank = 0;

    headNames.forEach(h => {
      const hData = [];
      for(let i=0; i<6; i++) hData.push([]); // Rows 1-6 empty
      
      const headRow5 = [];
      headRow5[1] = collName + ' - ' + h;
      headRow5[2] = dateRangeStr;
      hData[4] = headRow5;

      let totDr = 0, totCr = 0, totCash = 0, totBank = 0;
      heads[h].forEach(v => {
        const row = [];
        row[1] = h;
        const pOrR = v.type === 'credit' ? (v.receivedFrom||'') : (v.paidTo||'');
        const tw = v.towards||'';
        const particulars = pOrR ? (pOrR + (tw ? ' t/w ' + tw : '')) : tw;
        row[2] = particulars;
        
        const amt = Number(v.amount)||0;
        if(isCashMode(v)) totCash += amt;
        else totBank += amt;
        if(v.type === 'credit') {
          row[4] = amt; 
          totCr += amt;
        } else {
          row[3] = amt; 
          totDr += amt;
        }
        hData.push(row);
      });
      
      hData.push([]);
      hData.push([]);
      const totRow = [];
      totRow[3] = totDr || 0;
      totRow[4] = totCr || 0;
      hData.push(totRow);

      const wsHead = XLSX.utils.aoa_to_sheet(hData);
      wsHead['!cols'] = [{wch:5}, {wch:25}, {wch:60}, {wch:12}, {wch:12}];
      
      let shName = h.substring(0, 31).replace(/[\\/?*\[\]:]/g, ' ').trim();
      if(!shName) shName = 'Unknown';
      if(wb.SheetNames.includes(shName)) {
        let cnt = 1;
        while(wb.SheetNames.includes(shName.substring(0, 28) + '_' + cnt)) cnt++;
        shName = shName.substring(0, 28) + '_' + cnt;
      }
      XLSX.utils.book_append_sheet(wb, wsHead, shName);

      const ahRow = [];
      ahRow[6] = h;
      ahRow[7] = totCash || 0;
      ahRow[8] = totBank || 0;
      allHeadsData.push(ahRow);
      
      grandTotCash += totCash;
      grandTotBank += totBank;
    });

    allHeadsData.push([]);
    allHeadsData.push([]);
    allHeadsData.push([]);
    
    const gtRow = [];
    gtRow[6] = 'Grand Total';
    gtRow[7] = grandTotCash;
    gtRow[8] = grandTotBank;
    allHeadsData.push(gtRow);

    const wsAll = XLSX.utils.aoa_to_sheet(allHeadsData);
    wsAll['!cols'] = [{wch:5},{wch:5},{wch:5},{wch:5},{wch:5},{wch:5},{wch:30},{wch:12},{wch:12}];
    XLSX.utils.book_append_sheet(wb, wsAll, 'All Heads');
    wb.SheetNames.unshift(wb.SheetNames.pop());

    const fname = 'Ledger_Report_'+today()+'.xlsx';
    XLSX.writeFile(wb, fname, {bookType:'xlsx', type:'binary'});
    if(!silent) _toast('✅ Ledger Report exported: '+fname,'ok');

  } catch(err){
    console.error('Ledger export error:',err);
    if(!silent) alert('Export failed: '+err.message);
  }
}


// =============================================
// CASH BOOK EXPORT — one sheet per institution
// Columns: Particulars | Amount | Amount | Head Account | Particulars | Amount | Amount
// Left (Receipts) = Credit vouchers · Right (Payments) = Debit + On Account vouchers
// =============================================
function doCashBook(){
  try{
    if(typeof XLSX==='undefined'){alert('Excel library not ready. Please try again.');return;}
    const EXPVS = (typeof getFilteredVS==='function') ? getFilteredVS() : VS;
    if(!EXPVS.length){alert('No vouchers match the current filter to export.');return;}

    const wb = XLSX.utils.book_new();
    const insts = (typeof COLLEGES==='object' && COLLEGES) ? COLLEGES : {smgg:{label:"St. Mary's Group"}};
    const instKeys = Object.keys(insts);

    const HDR_FILL = '7B1D2E', HDR_FONT = 'FFFFFF';
    const thinBlk = {style:'thin',color:{rgb:'000000'}};
    const allBorder = {top:thinBlk,bottom:thinBlk,left:thinBlk,right:thinBlk};

    const fcEl = document.getElementById('FC');
    const selectedInst = fcEl ? fcEl.value : '';
    const instKeysToProcess = selectedInst ? [selectedInst] : instKeys;

    instKeysToProcess.forEach(key=>{
      const instLabel = (insts[key] && insts[key].label) ? insts[key].label : key;
      const sub = EXPVS.filter(v => (v.college||'smgg') === key);
      
      if(!sub.length) return;

      // Split into receipts (credit) and payments (debit + onaccount)
      const receipts = sub.filter(v=>v.type==='credit');
      const payments = sub.filter(v=>v.type==='debit' || v.type==='onaccount');
      const nRows = Math.max(receipts.length, payments.length, 1);

      const rcvParticulars = v => {
        const a = (v.receivedFrom||'').trim();
        const b = (v.towards||'').trim();
        return (a && b) ? (a+' t/w '+b) : (a||b||'');
      };
      const payParticulars = v => {
        const a = (v.paidTo||'').trim();
        const b = (v.towards||'').trim();
        return (a && b) ? (a+' t/w '+b) : (a||b||'');
      };

      // Build AOA
      const aoa = [];
      aoa.push([instLabel+' Cash Book','','','','','','']); // row 0: title (merged)
      aoa.push(['Particulars','Amount','Amount','Head Account','Particulars','Amount','Amount']); // row 1: header
      let rcvCash=0, rcvBank=0, payCash=0, payBank=0;
      const isCash = v => ((v.mode||'Cash').toLowerCase()==='cash');
      for(let i=0;i<nRows;i++){
        const r = receipts[i], p = payments[i];
        const rAmtNum = r ? Math.round(Number(r.amount)||0) : 0;
        const pAmtNum = p ? Math.round(Number(p.amount)||0) : 0;
        const rCash = r && isCash(r) ? rAmtNum : '';
        const rBank = r && !isCash(r) ? rAmtNum : '';
        const pCash = p && isCash(p) ? pAmtNum : '';
        const pBank = p && !isCash(p) ? pAmtNum : '';
        if(r){ if(isCash(r)) rcvCash+=rAmtNum; else rcvBank+=rAmtNum; }
        if(p){ if(isCash(p)) payCash+=pAmtNum; else payBank+=pAmtNum; }
        aoa.push([
          r ? rcvParticulars(r) : '',
          rCash,
          rBank,
          p ? (p.head||'') : (r ? (r.head||'') : ''),
          p ? payParticulars(p) : '',
          pCash,
          pBank
        ]);
      }
      // Totals row
      aoa.push(['Total', rcvCash, rcvBank, '', 'Total', payCash, payBank]);

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols']=[{wch:38},{wch:12},{wch:12},{wch:22},{wch:44},{wch:12},{wch:12}];

      // Merge title across 7 cols (row 0), and merge "Amount Amount" headers if you want (kept separate per image)
      ws['!merges'] = [{s:{r:0,c:0},e:{r:0,c:6}}];

      // Freeze header rows
      ws['!freeze']={xSplit:0,ySplit:2};

      const lastRow = aoa.length - 1;

      // Title style
      if(ws['A1']){
        ws['A1'].s = {
          font:{bold:true, sz:14, color:{rgb:'000000'}},
          alignment:{horizontal:'center', vertical:'center'},
          border:allBorder
        };
      }
      // Header row style
      for(let C=0;C<=6;C++){
        const addr = XLSX.utils.encode_cell({r:1,c:C});
        if(!ws[addr]) ws[addr]={t:'s',v:''};
        ws[addr].s = {
          font:{bold:true, color:{rgb:HDR_FONT}, sz:11},
          fill:{patternType:'solid', fgColor:{rgb:HDR_FILL}},
          alignment:{horizontal:'center', vertical:'center', wrapText:true},
          border:allBorder
        };
      }
      // Body styles
      for(let R=2; R<=lastRow; R++){
        const isTotal = (R===lastRow);
        for(let C=0;C<=6;C++){
          const addr = XLSX.utils.encode_cell({r:R,c:C});
          if(!ws[addr]) ws[addr]={t:'s',v:''};
          const isAmtCol = (C===1 || C===2 || C===5 || C===6);
          ws[addr].s = {
            font: isTotal ? {bold:true} : (isAmtCol?{bold:false}:{}),
            alignment: isAmtCol
              ? {horizontal:'right', vertical:'center'}
              : {vertical:'top', wrapText:true},
            fill: isTotal ? {patternType:'solid', fgColor:{rgb:'F2E8EA'}} : undefined,
            border:allBorder
          };
          if(isAmtCol && typeof ws[addr].v === 'number'){
            ws[addr].z = '#,##0';
          }
        }
      }
      // Slightly taller title row
      ws['!rows'] = [{hpt:24},{hpt:22}];

      // Sheet name: keep <=31 chars and safe
      let sheetName = instLabel.replace(/[\\\/\?\*\[\]:]/g,' ').slice(0,31);
      if(!sheetName.trim()) sheetName = key;
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    const fname = 'CashBook_AllInstitutions_'+today()+'.xlsx';
    XLSX.writeFile(wb, fname, {bookType:'xlsx', type:'binary'});
    _toast('✅ Cash Book exported: '+fname,'ok');
  }catch(err){
    console.error('Cash Book export error:',err);
    alert('Cash Book export failed: '+err.message);
  }
}



// =============================================
// PRINTER SETUP — Web Serial API (ESC/POS USB)
// =============================================
window._serialPort = null;
window._serialWriter = null;

function _serialLog(msg){
  const el=document.getElementById('serialLog');
  if(el){ el.textContent=msg; }
  console.log('[Serial]',msg);
}

async function connectSerialPrinter(){
  if(!('serial' in navigator)){
    _serialLog('❌ Web Serial API not available. Use Chrome or Edge 89+.');
    _toast('Web Serial not supported in this browser','err');
    return;
  }
  try{
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    window._serialPort = port;
    window._serialWriter = port.writable.getWriter();
    document.getElementById('serialStatus').style.cssText='font-size:11px;padding:3px 10px;border-radius:12px;background:#dcfce7;color:#166534';
    document.getElementById('serialStatus').textContent='Connected ✓';
    document.getElementById('btnConnectSerial').disabled=true;
    document.getElementById('btnDisconnectSerial').disabled=false;
    document.getElementById('btnTestSerial').disabled=false;
    _serialLog('✅ Connected to printer. Ready to print.');
    _toast('USB Printer connected','ok');
  } catch(e){
    _serialLog('❌ Could not connect: '+(e.message||e));
    _toast('Connection failed: '+e.message,'err');
  }
}

async function disconnectSerialPrinter(){
  try{
    if(window._serialWriter){ await window._serialWriter.releaseLock(); window._serialWriter=null; }
    if(window._serialPort){ await window._serialPort.close(); window._serialPort=null; }
  }catch(e){}
  document.getElementById('serialStatus').style.cssText='font-size:11px;padding:3px 10px;border-radius:12px;background:#fee2e2;color:#991b1b';
  document.getElementById('serialStatus').textContent='Not connected';
  document.getElementById('btnConnectSerial').disabled=false;
  document.getElementById('btnDisconnectSerial').disabled=true;
  document.getElementById('btnTestSerial').disabled=true;
  _serialLog('Disconnected.');
  _toast('Printer disconnected','ok');
}

// Build ESC/POS bytes from voucher HTML (text extraction)
function _buildEscPos(htmlStr){
  // ESC/POS control bytes
  const ESC=0x1B, GS=0x1D, LF=0x0A, CR=0x0D;
  const INIT=[ESC,0x40]; // Initialize printer
  const BOLD_ON=[ESC,0x45,1];
  const BOLD_OFF=[ESC,0x45,0];
  const ALIGN_CENTER=[ESC,0x61,1];
  const ALIGN_LEFT=[ESC,0x61,0];
  const FONT_NORMAL=[ESC,0x21,0];
  const FONT_DOUBLE=[ESC,0x21,0x30]; // double height+width
  const CUT=[GS,0x56,0x41,0x10]; // partial cut

  // Strip HTML to plain text
  const tmp=document.createElement('div');
  tmp.innerHTML=htmlStr;
  const lines=[];
  // Extract key fields from the voucher DOM structure
  const texts=[];
  tmp.querySelectorAll('[style]').forEach(el=>{
    const t=el.innerText||el.textContent||'';
    if(t.trim()) texts.push(t.trim());
  });

  // Build formatted receipt
  const encoder=new TextEncoder();
  const rows=[];
  // Header
  rows.push(...INIT);
  rows.push(...ALIGN_CENTER);
  rows.push(...FONT_DOUBLE);
  const hdr=encoder.encode("St. Mary's\n");
  hdr.forEach(b=>rows.push(b));
  rows.push(...FONT_NORMAL);
  const sub=encoder.encode("Group of Institutions Guntur\n\n");
  sub.forEach(b=>rows.push(b));
  rows.push(...ALIGN_LEFT);
  // Content
  const divider=encoder.encode("--------------------------------\n");
  divider.forEach(b=>rows.push(b));
  texts.slice(0,20).forEach(t=>{
    const line=encoder.encode(t.substring(0,40)+"\n");
    line.forEach(b=>rows.push(b));
  });
  divider.forEach(b=>rows.push(b));
  const footer=encoder.encode("\n\n\n");
  footer.forEach(b=>rows.push(b));
  rows.push(...CUT);
  return new Uint8Array(rows);
}

async function _serialPrintVoucher(htmlStr){
  if(!window._serialWriter){ _toast('Printer not connected','err'); return; }
  try{
    _serialLog('Sending to printer…');
    const bytes=_buildEscPos(htmlStr);
    await window._serialWriter.write(bytes);
    _serialLog('✅ Sent to printer successfully.');
    _toast('✅ Sent to USB printer','ok');
  }catch(e){
    _serialLog('❌ Print failed: '+(e.message||e));
    _toast('Print failed: '+e.message,'err');
  }
}

async function testSerialPrint(){
  const testHtml='<div><strong>TEST PAGE</strong><br>Printer working correctly.<br>St. Marys Voucher System</div>';
  await _serialPrintVoucher(testHtml);
}

// =============================================
// PRINTER SETTINGS — Paper size & behaviour
// =============================================
function saveDefaultPaper(){
  const sel=document.getElementById('defaultPaperSize');
  if(!sel) return;
  localStorage.setItem('smv_paperSize', sel.value);
  // Sync to print modal selector too
  const ps=document.getElementById('PRINT_SIZE');
  if(ps) ps.value=sel.value;
  const fb=document.getElementById('paperSaveFeedback');
  if(fb){ fb.textContent='✓ Saved'; setTimeout(()=>{ fb.textContent=''; },2000); }
}

function savePrintBehaviour(){
  const sel=document.getElementById('printBehaviour');
  if(!sel) return;
  localStorage.setItem('smv_printBehaviour', sel.value);
  const fb=document.getElementById('paperSaveFeedback');
  if(fb){ fb.textContent='✓ Saved'; setTimeout(()=>{ fb.textContent=''; },2000); }
}

// ── Print environment status panel ──
function refreshPrintEnv(){
  var env = _PRINT_ENV;
  var items = [
    {label:'Electron (silent)',  ok: env.isElectron, desc: env.isElectron ? 'Active – zero-dialog printing' : 'Not detected'},
    {label:'QZ Tray',           ok: env.hasQZ,       desc: env.hasQZ ? 'Connected – silent printing' : 'Not running (install qz-tray.io)'},
    {label:'Chrome Kiosk Mode', ok: env.isKiosk,     desc: env.isKiosk ? 'Active – dialog suppressed' : 'Not active (see setup below)'},
    {label:'Web Serial (ESC/POS)',ok:env.hasSerial,  desc: env.hasSerial ? 'Supported (Chrome/Edge)' : 'Not supported (use Chrome)'},
    {label:'Browser (iframe)',   ok: true,            desc: 'Always available – dialog opens on default printer'},
  ];
  var grid = document.getElementById('printEnvGrid');
  if(!grid) return;
  grid.innerHTML = items.map(function(it){
    return '<div style="background:'+(it.ok?'#e8f5e9':'#fff3e0')+';border:1px solid '+(it.ok?'#a5d6a7':'#ffe082')+';border-radius:7px;padding:8px 10px">'
      +'<div style="font-weight:600;font-size:11.5px;color:'+(it.ok?'#1B5E20':'#7A3800')+'">'+(it.ok?'✅ ':'⚠ ')+it.label+'</div>'
      +'<div style="font-size:10.5px;color:#666;margin-top:2px">'+it.desc+'</div>'
      +'</div>';
  }).join('');
  // Recommendation
  var rec = document.getElementById('printEnvRec');
  if(rec){
    if(env.isElectron) rec.textContent = 'Electron silent print — zero dialog, fully automatic.';
    else if(env.hasQZ)  rec.textContent = 'QZ Tray — configure printer name above, then click Print.';
    else if(env.isKiosk) rec.textContent = 'Chrome Kiosk Printing — dialog suppressed, prints silently.';
    else if(window._serialPort) rec.textContent = 'ESC/POS USB Serial — direct thermal printer output.';
    else rec.textContent = 'Browser iframe print — dialog opens with default printer pre-selected. Press Enter to print.';
  }
  // Populate QZ printer name
  var qzEl = document.getElementById('qzPrinterName');
  if(qzEl) qzEl.value = localStorage.getItem('smv_qzPrinter')||'';
}

function loadPrinterSettings(){
  const paper=localStorage.getItem('smv_paperSize')||'a4_single'; // A4 with full-width A5 voucher at top
  const behaviour=localStorage.getItem('smv_printBehaviour')||'silent';
  const dps=document.getElementById('defaultPaperSize');
  if(dps) dps.value=paper;
  const pb=document.getElementById('printBehaviour');
  if(pb) pb.value=behaviour;
  // Also sync print modal selector
  const ps=document.getElementById('PRINT_SIZE');
  if(ps) ps.value=paper;
}


function togglePrintColor(on){
  localStorage.setItem('smv_useColor', on?'1':'0');
  // Re-render preview if open
  const pm=document.getElementById('PM');
  if(pm && !pm.classList.contains('h')){
    const pa=document.getElementById('PA');
    // Try to rebuild from last previewed voucher id stored on PA dataset
    if(pa && pa.dataset.vid){
      const v=VS.find(x=>String(x.id)===pa.dataset.vid);
      if(v){ pa.innerHTML=buildPrint(v); }
    }
  }
}

// Hook into PRINT_SIZE changes to persist preference
document.addEventListener('DOMContentLoaded', function(){
  loadPrinterSettings();
  refreshPrintEnv();
  const _pc=document.getElementById('PRINT_COLOR'); if(_pc) _pc.checked=(localStorage.getItem('smv_useColor')==='1');
  const ps=document.getElementById('PRINT_SIZE');
  if(ps) ps.addEventListener('change', function(){
    localStorage.setItem('smv_paperSize', ps.value);
    const dps=document.getElementById('defaultPaperSize');
    if(dps) dps.value=ps.value;
  });
});


// COLLEGE PICKER bootstrap
window.addEventListener('DOMContentLoaded',function(){
  const img=document.getElementById('LS_COLLEGE_LOGO');
  if(img) SMGG_LOGO_SRC=img.src;
  const cpimg=document.getElementById('CP_LOGO_SMGG');
  if(cpimg) cpimg.src=SMGG_LOGO_SRC;
  const cpimg2=document.getElementById('CP_LOGO_SMWEC');
  if(cpimg2) cpimg2.src=SMWEC_LOGO_SRC;
  // Only show college picker if no active session (session restore handles the logged-in case)
  const hasSess=!!(_getSess('smv_sess_user')&&_getSess('smv_sess_college'));
  if(!hasSess){
    const cp=document.getElementById('CP');
    const ls=document.getElementById('LS');
    if(cp) cp.style.display='flex';
    if(ls) ls.style.display='none';
  }
});

// SEED DATA

// =============================================
// SESSION RESTORE — stay on same page after refresh
// =============================================
window.addEventListener('DOMContentLoaded', async function(){
  try{
    let sessUser = _getSess('smv_sess_user');
    let sessCollege = _getSess('smv_sess_college');
    let sessHome = _getSess('smv_sess_home');
    const sessPage = _getSess('smv_sess_page');
    if(!sessUser && !localStorage.getItem('smv_token') && !localStorage.getItem('smv_auth_user')) return;
    const api=(window._api||_api);
    const session=await api('validateSession',{});
    const authUser=session&&session.user;
    if(authUser) localStorage.setItem('smv_auth_user',JSON.stringify(authUser));
    sessUser = sessUser || _uiUserCodeFromAuth(authUser,'');
    sessCollege = sessCollege || (authUser&&authUser.college) || localStorage.getItem('smv_last_college') || 'smgg';
    sessHome = sessHome || sessCollege;
    // Restore state
    CURRENT_COLLEGE = sessCollege;
    HOME_COLLEGE = sessHome || sessCollege;
    CU = _uiUserCodeFromAuth(authUser,sessUser);
    _setSess('smv_sess_user',CU);
    _setSess('smv_sess_college',CURRENT_COLLEGE);
    _setSess('smv_sess_home',HOME_COLLEGE);
    await _loadVouchersFromCloud();
    // Hide picker and login, show app
    const cp = document.getElementById('CP'); if(cp) cp.style.display='none';
    const ls = document.getElementById('LS'); if(ls) ls.style.display='none';
    const app = document.getElementById('APP'); if(app) app.style.display='block';
    const ub = document.getElementById('UB');
    if(ub){ const a=ADMIN_ROLES[CU]; ub.textContent=(authUser&&!_isPrimaryAdminSession()?(authUser.fullName||authUser.username):(a&&a.label)||CU); }
    const cs = document.getElementById('f_college');
    if(cs){ cs.value=sessCollege; cs.disabled=true; }
    updateCollegeSwitchPill();
    setupRole();
    initApp();
    _updateXLPill();
    _startLiveSync();
    // Navigate to last active page or dashboard
    if(sessPage){
      setTimeout(function(){ show(sessPage); }, 0);
    } else {
      setTimeout(function(){ show('dashboard'); }, 0);
    }
  }catch(e){
    console.error('session restore',e);
    if(/Login required|Session expired|Invalid session/i.test(e&&e.message||'')){
      _clearSess();
      localStorage.removeItem('smv_token');
      localStorage.removeItem('smv_auth_user');
      backToPicker();
    }
  }
});

// Auto-relink Excel handle from previous session
window.addEventListener('DOMContentLoaded',()=>{ restoreLinkedExcel(); });

// CUSTOM ACCOUNT HEAD DROPDOWN
function setupCustomHeadDropdowns() {
  ['fc_head', 'fd_head'].forEach(id => {
    const inp = document.getElementById(id);
    if(!inp) return;
    if(inp.dataset.headDropdownReady === '1') return;
    inp.dataset.headDropdownReady = '1';
    
    const wrapper = document.createElement('div');
    wrapper.className = 'head-dropdown-wrap';
    wrapper.style.position = 'relative';
    inp.parentNode.insertBefore(wrapper, inp);
    wrapper.appendChild(inp);
    
    const dd = document.createElement('div');
    dd.className = 'custom-head-dropdown';
    dd.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--G200);border-radius:6px;max-height:220px;overflow-y:auto;z-index:999;display:none;box-shadow:0 4px 15px rgba(0,0,0,0.1);padding:5px 0;';
    wrapper.appendChild(dd);
    
    let isMouseOver = false;
    dd.addEventListener('mouseenter', () => isMouseOver = true);
    dd.addEventListener('mouseleave', () => isMouseOver = false);
    
    function renderList() {
      dd.innerHTML = '';
      const query = inp.value.trim().toLowerCase();
      const sorted = HEADS.filter((h,i,list)=>list.findIndex(x=>x.toLowerCase()===h.toLowerCase())===i).sort((a,b)=>a.localeCompare(b));
      sorted.filter(h => !query || h.toLowerCase().includes(query)).forEach(h => {
        const item = document.createElement('div');
        item.textContent = h;
        item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:13px;color:var(--T);transition:background 0.2s;';
        item.onmouseover = () => item.style.background = 'var(--G50)';
        item.onmouseout = () => item.style.background = 'transparent';
        item.onmousedown = (e) => {
          e.preventDefault(); // Prevent blur
          inp.value = h;
          dd.style.display = 'none';
          if(typeof checkNewHead==='function') checkNewHead(inp);
        };
        dd.appendChild(item);
      });
      if(!dd.children.length){
        const empty = document.createElement('div');
        empty.textContent = 'No matching heads';
        empty.style.cssText = 'padding:8px 12px;font-size:12px;color:var(--G600);';
        dd.appendChild(empty);
      }
    }
    
    inp.addEventListener('focus', () => {
      renderList();
      dd.style.display = 'block';
    });
    
    inp.addEventListener('blur', () => {
      if(!isMouseOver) {
        dd.style.display = 'none';
      }
    });
    
    inp.addEventListener('input', () => {
      renderList();
      dd.style.display = 'block';
    });
  });
}


// Show date picker only on explicit click for date fields
document.addEventListener('click', function(e) {
  if (e.target && e.target.type === 'date') {
    try { e.target.showPicker(); } catch(err) {}
  }
});
