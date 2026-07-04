'use strict';
function showPage(page){
  qsa('.page').forEach(p=>p.classList.remove('active')); qsa('.nav').forEach(n=>n.classList.remove('active'));
  $('page-'+page)?.classList.add('active'); const nav = document.querySelector(`.nav[data-page="${page}"]`); if(nav) nav.classList.add('active');
  if($('pageTitle')) $('pageTitle').textContent = nav ? nav.textContent : 'Dashboard'; if(page === 'audit') loadAudit();
}
function applyRoleUI(){
  const admin = isAdmin(); qsa('.admin-only').forEach(el=>el.style.display=admin?'':'none');
  if($('userBadge')) $('userBadge').textContent = `${state.user.username} · ${admin?'Admin':'User'}`;
  if(!admin && document.querySelector('.page.active')?.classList.contains('admin-only')) showPage('myVouchers');
}
function populateHeads(){
  const dl=$('headsList'); if(dl) dl.innerHTML = state.heads.map(h=>`<option value="${safe(h.name)}"></option>`).join('');
  const fh=$('fHead'); if(fh){ const cur=fh.value||'__all_heads__'; fh.innerHTML='<option value="__all_heads__">All Heads</option>'+state.heads.map(h=>`<option value="${safe(h.name)}">${safe(h.name)}</option>`).join(''); fh.value=[...fh.options].some(o=>o.value===cur)?cur:'__all_heads__'; }
}
function populateUsersFilter(){ const f=$('fUser'); if(!f)return; const users=Array.from(new Set(state.vouchers.map(v=>v.created_by).filter(Boolean))); f.innerHTML='<option value="">All Users</option>'+users.map(u=>`<option>${safe(u)}</option>`).join(''); }
function renderEverything(){ populateHeads(); populateUsersFilter(); renderDashboard(); renderVoucherTables(); renderAllVouchers(); }
function renderDashboard(){
  const mine = isAdmin()?state.vouchers:state.vouchers.filter(v=>v.created_by===state.user.username); const total=mine.reduce((s,v)=>s+amountInt(v.amount),0);
  const cards=[['Total Vouchers',mine.length,'All time'],['Total Amount',money(total),'Accessible data'],...TYPE_ORDER.map(t=>[TYPE_LABEL[t],mine.filter(v=>v.type===t).length,'Voucher count'])];
  if($('dashboardCards')) $('dashboardCards').innerHTML=cards.map(c=>`<div class="card"><div class="label">${c[0]}</div><div class="value">${c[1]}</div><div class="sub">${c[2]}</div></div>`).join('');
  const recent=[...mine].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,10); if($('recentBody')) $('recentBody').innerHTML=recent.map(rowHtml).join('');
}
function rowHtml(v){ const party=v.paid_to||v.received_from||v.ac_name||'—'; return `<tr><td>${safe(dmy(v.date))}</td><td><span class="badge">${TYPE_LABEL[v.type]}</span></td><td>${safe(party)}</td><td>${safe(v.head)}</td><td><b>${money(v.amount)}</b></td><td>${safe(v.created_by||'')}</td><td><button class="btn ghost" onclick="openPrint(${Number(v.id)})">Print</button></td></tr>`; }
function filteredVouchers(){
  const f=state.filters; return state.vouchers.filter(v=>{ if(f.from&&v.date<f.from)return false; if(f.to&&v.date>f.to)return false; if(f.type&&v.type!==f.type)return false; if(f.head&&f.head!=='__all_heads__'&&norm(v.head)!==norm(f.head))return false; if(f.mode&&v.mode!==f.mode)return false; if(f.user&&v.created_by!==f.user)return false; if(f.search){ const blob=[v.voucher_no,v.head,v.paid_to,v.received_from,v.ac_name,v.towards,v.remarks,v.mode].join(' ').toLowerCase(); if(!blob.includes(f.search.toLowerCase()))return false; } return true; });
}
function renderAllVouchers(){
  if(!isAdmin()) return; const rows=filteredVouchers().sort((a,b)=>String(b.date).localeCompare(String(a.date))||b.id-a.id); const total=rows.reduce((s,v)=>s+amountInt(v.amount),0);
  if($('grandTotalBox')) $('grandTotalBox').textContent=`Grand Total: ${money(total)}`; if($('filterSummary')) $('filterSummary').textContent=`${rows.length} vouchers · ${money(total)} total`;
  const ledger=state.filters.view==='ledger'; $('voucherTableView')?.classList.toggle('hidden',ledger); $('ledgerView')?.classList.toggle('hidden',!ledger);
  if(!ledger && $('allVoucherBody')) $('allVoucherBody').innerHTML=rows.map(v=>`<tr><td>${safe(dmy(v.date))}</td><td>${safe(v.voucher_no||v.id)}</td><td>${TYPE_LABEL[v.type]}</td><td>${safe(v.paid_to||v.received_from||v.ac_name||'—')}</td><td>${safe(v.head)}</td><td>${safe(v.mode||'')}</td><td><b>${money(v.amount)}</b></td><td>${safe(v.created_by)}</td><td><button class="btn ghost" onclick="openPrint(${Number(v.id)})">Print</button> <button class="btn ghost" onclick="editVoucher(${Number(v.id)})">Edit</button> <button class="btn danger" onclick="deleteVoucher(${Number(v.id)})">Delete</button></td></tr>`).join('');
  if(ledger) renderLedger(rows);
}
function groupByHead(rows){ return rows.reduce((m,v)=>{ const h=v.head||'No Head'; (m[h] ||= []).push(v); return m; },{}); }
function renderLedger(rows){
  const groups=groupByHead(rows); $('ledgerView').innerHTML=Object.entries(groups).map(([head,items])=>{ const ht=items.reduce((s,v)=>s+amountInt(v.amount),0); return `<div class="ledger-group"><div class="ledger-title"><span>Head: ${safe(head)}</span><span>Head Total: ${money(ht)}</span></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Party</th><th>Towards</th><th>Amount</th></tr></thead><tbody>${items.map(v=>`<tr><td>${safe(dmy(v.date))}</td><td>${TYPE_LABEL[v.type]}</td><td>${safe(v.paid_to||v.received_from||v.ac_name||'—')}</td><td>${safe(v.towards)}</td><td><b>${money(v.amount)}</b></td></tr>`).join('')}<tr><td colspan="4" class="ledger-total">Head Total</td><td><b>${money(ht)}</b></td></tr></tbody></table></div></div>`; }).join('') || '<div class="muted">No data found.</div>';
}
function renderVoucherTables(){ const mine=state.vouchers.filter(v=>v.created_by===state.user?.username).sort((a,b)=>String(b.date).localeCompare(String(a.date))); if($('myVoucherBody')) $('myVoucherBody').innerHTML=mine.map(v=>`<tr><td>${safe(dmy(v.date))}</td><td>${safe(v.voucher_no||v.id)}</td><td>${TYPE_LABEL[v.type]}</td><td>${safe(v.paid_to||v.received_from||v.ac_name||'—')}</td><td>${safe(v.head)}</td><td><b>${money(v.amount)}</b></td><td><button class="btn ghost" onclick="openPrint(${Number(v.id)})">Print</button></td></tr>`).join(''); }
function renderUsers(){ if(!isAdmin()||!$('usersBody'))return; $('usersBody').innerHTML=state.users.map(u=>`<tr><td>${safe(u.username)}</td><td>${safe(u.role)}</td><td>${safe(u.status)}</td><td>${safe(u.college)}</td><td>${safe(u.last_login||'—')}</td><td>${u.username==='admin'?'Protected':`<button class="btn ghost" onclick="toggleUser('${safe(u.username)}','${u.status==='active'?'blocked':'active'}')">${u.status==='active'?'Block':'Unblock'}</button> <button class="btn ghost" onclick="resetUserPassword('${safe(u.username)}')">Reset Password</button>`}</td></tr>`).join(''); }
async function loadAudit(){ if(!isAdmin())return; const j=await api('listAudit'); state.audits=j.logs||[]; if($('auditBody')) $('auditBody').innerHTML=state.audits.map(a=>`<tr><td>${safe(a.created_at)}</td><td>${safe(a.actor)}</td><td>${safe(a.action)}</td><td>${safe(a.entity_type)} #${safe(a.entity_id||'')}</td><td>${safe(a.details||'')}</td></tr>`).join(''); }
