'use strict';
function toast(msg, kind='ok'){
  const el = $('toast'); if(!el) return alert(msg);
  el.textContent = msg; el.className = 'toast ' + kind; el.classList.remove('hidden');
  clearTimeout(el._t); el._t = setTimeout(()=>el.classList.add('hidden'), 2800);
}
async function api(action, payload={}){
  const res = await fetch(API_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,token:state.token,...payload})});
  const json = await res.json().catch(()=>({error:'Invalid server response'}));
  if(!res.ok || json.error) throw new Error(json.error || ('HTTP '+res.status));
  return json;
}
function numberToWords(num){
  num = amountInt(num); if(!num) return '';
  const a=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const b=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function t(n){ if(n<20)return a[n]; if(n<100)return b[Math.floor(n/10)]+(n%10?' '+a[n%10]:''); if(n<1000)return a[Math.floor(n/100)]+' Hundred'+(n%100?' '+t(n%100):''); if(n<100000)return t(Math.floor(n/1000))+' Thousand'+(n%1000?' '+t(n%1000):''); if(n<10000000)return t(Math.floor(n/100000))+' Lakh'+(n%100000?' '+t(n%100000):''); return t(Math.floor(n/10000000))+' Crore'+(n%10000000?' '+t(n%10000000):''); }
  return t(num) + ' Rupees Only';
}
async function login(username,password){
  const j = await api('login',{username,password});
  state.token = j.token; state.user = j.user; localStorage.setItem('smv_token',state.token);
  await enterApp();
}
async function setupAdmin(setupKey,password){
  await api('setupAdmin',{setupKey,password});
  toast('Admin created. Login with username admin.','ok');
  $('setupForm')?.classList.add('hidden'); $('loginForm')?.classList.remove('hidden');
  if($('loginUsername')) $('loginUsername').value = 'admin';
}
async function enterApp(){
  $('loginScreen')?.classList.add('hidden'); $('appScreen')?.classList.remove('hidden');
  if($('todayLabel')) $('todayLabel').textContent = new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  applyRoleUI(); resetVoucherForm(); await loadAll(true); showPage(isAdmin()?'dashboard':'create'); startLiveSync();
}
async function loadAll(full=false){
  const [vj,hj] = await Promise.all([api('listVouchers'), api('listHeads')]);
  state.vouchers = vj.vouchers || []; state.heads = mergeHeads(hj.heads || []);
  if(isAdmin() && full){ const uj = await api('listUsers'); state.users = uj.users || []; renderUsers(); }
  renderEverything();
  if($('lastSync')) $('lastSync').textContent = 'Last synced: ' + new Date().toLocaleTimeString('en-IN');
  if($('syncStatus')){ $('syncStatus').textContent='Live Sync: connected'; $('syncStatus').style.color='var(--ok)'; }
}
function startLiveSync(){
  clearInterval(state.syncTimer);
  state.syncTimer = setInterval(async()=>{ try{ await loadAll(false); }catch(e){ if($('syncStatus')){ $('syncStatus').textContent='Live Sync: reconnecting'; $('syncStatus').style.color='var(--warn)'; } } },5000);
}
function mergeHeads(serverHeads){
  const map = new Map(); DEFAULT_HEADS.forEach(h=>map.set(norm(h),{name:h,type:'common'}));
  serverHeads.forEach(h=>map.set(norm(h.name),h));
  return Array.from(map.values()).sort((a,b)=>a.name.localeCompare(b.name));
}
async function logout(){ try{ await api('logout'); }catch{} localStorage.removeItem('smv_token'); state.token=''; state.user=null; clearInterval(state.syncTimer); location.reload(); }
