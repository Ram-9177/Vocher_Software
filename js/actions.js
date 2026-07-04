'use strict';
function setVoucherType(t){ state.currentType=t; qsa('.type-btn').forEach(b=>b.classList.toggle('selected',b.dataset.type===t)); qsa('.credit-fields').forEach(e=>e.classList.toggle('hidden',t!=='credit')); qsa('.debit-fields').forEach(e=>e.classList.toggle('hidden',t!=='debit')); qsa('.onaccount-fields').forEach(e=>e.classList.toggle('hidden',t!=='onaccount')); }
function resetVoucherForm(){ $('voucherForm')?.reset(); if($('editId'))$('editId').value=''; if($('vDate'))$('vDate').value=todayISO(); setVoucherType('debit'); if($('formTitle'))$('formTitle').textContent='Create Voucher'; }
async function maybeAddHead(name,type){ name=String(name||'').trim().replace(/\s+/g,' '); if(!name)return ''; if(state.heads.some(h=>norm(h.name)===norm(name)))return name; if(confirm(`"${name}" is not in the dropdown. Do you want to add it and sync for all users?`)){ const j=await api('addHead',{name,type}); state.heads=mergeHeads(j.heads||[]); populateHeads(); toast('Account head added and synced.','ok'); } return name; }
async function saveVoucher(ev){
  ev.preventDefault(); const type=state.currentType; const headField=type==='credit'?'creditAccount':type==='onaccount'?'onAccountHead':'debitHead'; const paidField=type==='onaccount'?'onPaidTo':'paidTo';
  const head=await maybeAddHead($(headField)?.value,type); const amount=amountInt($('amount')?.value); if(!head||!amount||!$('towards')?.value.trim())return toast('Fill Head, Towards and Amount.','err');
  const v={ id:$('editId')?.value||undefined, type, date:$('vDate').value, college:$('vCollege').value, head, ac_name:$('creditAccount')?.value||'', received_from:$('receivedFrom')?.value||'', paid_to:type==='credit'?'':($(paidField)?.value||''), towards:$('towards').value, amount, amt_words:numberToWords(amount), mode:$('mode').value, cheque:$('cheque').value, prep_by:$('preparedBy').value, checked_by:$('checkedBy').value, remarks:$('remarks').value };
  await api('saveVoucher',{voucher:v}); toast('Voucher saved.','ok'); resetVoucherForm(); await loadAll(true); showPage(isAdmin()?'allVouchers':'myVouchers');
}
function applyFilters(){ state.filters={from:$('fFrom').value,to:$('fTo').value,type:$('fType').value,head:$('fHead').value,mode:$('fMode').value,user:$('fUser').value,search:$('fSearch').value.trim(),view:$('fView').value}; renderAllVouchers(); }
function clearFilters(){ ['fFrom','fTo','fType','fMode','fUser','fSearch'].forEach(id=>{if($(id))$(id).value='';}); if($('fHead'))$('fHead').value='__all_heads__'; if($('fView'))$('fView').value='table'; state.filters={from:'',to:'',type:'',head:'__all_heads__',mode:'',user:'',search:'',view:'table'}; renderAllVouchers(); }
function editVoucher(id){ if(!isAdmin())return toast('Only admin can edit.','err'); const v=state.vouchers.find(x=>Number(x.id)===Number(id)); if(!v)return; showPage('create'); setVoucherType(v.type); $('editId').value=v.id; $('formTitle').textContent='Edit Voucher'; $('vDate').value=v.date; $('vCollege').value=v.college||'smg'; $('creditAccount').value=v.ac_name||v.head||''; $('receivedFrom').value=v.received_from||''; $('debitHead').value=v.head||''; $('paidTo').value=v.paid_to||''; $('onAccountHead').value=v.head||''; $('onPaidTo').value=v.paid_to||''; $('towards').value=v.towards||''; $('amount').value=amountInt(v.amount); $('amountWords').value=numberToWords(v.amount); $('mode').value=v.mode||'Cash'; $('cheque').value=v.cheque||''; $('preparedBy').value=v.prep_by||''; $('checkedBy').value=v.checked_by||''; $('remarks').value=v.remarks||''; }
async function deleteVoucher(id){ if(!isAdmin())return; if(!confirm('Delete this voucher? It will be soft-deleted with audit log.'))return; await api('deleteVoucher',{id}); toast('Voucher deleted.','ok'); await loadAll(true); }
function openPrint(id){ const v=state.vouchers.find(x=>Number(x.id)===Number(id)); if(!v)return; $('printArea').innerHTML=printHtml(v); $('printModal').classList.remove('hidden'); }
function printHtml(v){ const title=(TYPE_LABEL[v.type]||'Voucher')+' Voucher'; return `<div class="voucher-print"><div class="voucher-head"><h2>ST. MARY'S VOUCHER SYSTEM</h2><div>${safe(title.toUpperCase())}</div></div><div class="voucher-meta"><div><b>Date:</b> ${safe(dmy(v.date))}</div><div><b>No:</b> ${safe(v.voucher_no||v.id)}</div></div><div class="print-row"><b>Head</b><span>${safe(v.head)}</span></div><div class="print-row"><b>Party</b><span>${safe(v.paid_to||v.received_from||v.ac_name||'—')}</span></div><div class="print-row"><b>Towards</b><span>${safe(v.towards)}</span></div><div class="print-row"><b>Amount</b><span><b>${money(v.amount)}</b></span></div><div class="print-row"><b>In Words</b><span>${safe(v.amt_words||numberToWords(v.amount))}</span></div><div class="print-row"><b>Mode / Ref</b><span>${safe(v.mode||'')} ${safe(v.cheque||'')}</span></div><div class="sign-row"><div>Prepared By<br><br>____________</div><div>Receiver / Depositor<br><br>____________</div></div></div>`; }
function doPrint(){ const html=$('printArea').innerHTML; const w=window.open('', '_blank'); w.document.write(`<!doctype html><html><head><title>Voucher</title><link rel="stylesheet" href="style.css"></head><body class="print-document">${html}<script>setTimeout(()=>print(),300)<\/script></body></html>`); w.document.close(); }

function typeLabel(t){ return TYPE_LABEL[t] || t || ''; }
function exportDate(){ return new Date().toLocaleDateString('en-IN').replaceAll('/','-'); }
function rangeLine(){ const from=state.filters.from?dmy(state.filters.from):'…'; const to=state.filters.to?dmy(state.filters.to):'…'; return (state.filters.from||state.filters.to) ? `Date Range: ${from} to ${to}` : 'Date Range: All'; }
function voucherExportRows(rows){ return rows.map((v,i)=>({
  'S.No': i+1,
  'Date': dmy(v.date),
  'Voucher No': v.voucher_no || v.id,
  'Voucher Type': typeLabel(v.type),
  'Account Name / Credit A/c': v.ac_name || '',
  'Account Head / Debit A/c': v.head || '',
  'Received From': v.received_from || '',
  'Paid To': v.paid_to || '',
  'Towards (Purpose)': v.towards || '',
  'Amount (Rs.)': amountInt(v.amount),
  'Amount in Words': v.amt_words || numberToWords(v.amount),
  'Payment Mode': v.mode || '',
  'Cheque / Ref No.': v.cheque || '',
  'Prepared By': v.prep_by || '',
  'Checked By': v.checked_by || '',
  'Remarks': v.remarks || '',
  'Created By': v.created_by || '',
  'Created At': v.created_at ? new Date(v.created_at).toLocaleString('en-IN') : ''
})); }
function applyOldVoucherSheetFormat(ws){
  ws['!cols']=[{wch:5},{wch:12},{wch:18},{wch:14},{wch:24},{wch:28},{wch:22},{wch:22},{wch:42},{wch:14},{wch:40},{wch:14},{wch:18},{wch:18},{wch:18},{wch:28},{wch:13},{wch:22}];
  ws['!freeze']={xSplit:0,ySplit:1};
  if(!ws['!ref'])return;
  const range=XLSX.utils.decode_range(ws['!ref']);
  for(let R=1;R<=range.e.r;R++){ const addr=XLSX.utils.encode_cell({r:R,c:9}); if(ws[addr]) ws[addr].z='#,##0'; }
}
function addSummarySheet(wb,rows,title='Voucher Export'){
  const total=rows.reduce((s,v)=>s+amountInt(v.amount),0);
  const counts={Credit:0,Debit:0,'On Account':0}, amounts={Credit:0,Debit:0,'On Account':0};
  rows.forEach(v=>{ const k=typeLabel(v.type); counts[k]=(counts[k]||0)+1; amounts[k]=(amounts[k]||0)+amountInt(v.amount); });
  const sumData=[
    ["ST. MARY'S GROUP OF INSTITUTIONS GUNTUR FOR WOMEN",'', ''],
    [title+' — '+exportDate(),'', ''],
    [rangeLine(),'', ''],
    ['', '', ''],
    ['SUMMARY','',''],
    ['Total Vouchers',rows.length,''],
    ['Total Amount (Rs.)',total,''],
    ['', '', ''],
    ['Voucher Type','Count','Total Amount (Rs.)'],
    ['Debit',counts.Debit||0,amounts.Debit||0],
    ['On Account',counts['On Account']||0,amounts['On Account']||0],
    ['Credit',counts.Credit||0,amounts.Credit||0],
    ['', '', ''],
    ['Grand Total',rows.length,total]
  ];
  const ws2=XLSX.utils.aoa_to_sheet(sumData); ws2['!cols']=[{wch:42},{wch:14},{wch:20}];
  ['B7','C10','C11','C12','C14'].forEach(a=>{ if(ws2[a]) ws2[a].z='#,##0'; });
  XLSX.utils.book_append_sheet(wb,ws2,'Summary');
}
function exportRows(rows,name){
  if(typeof XLSX==='undefined')return toast('Excel library not loaded.','err');
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.json_to_sheet(voucherExportRows(rows));
  applyOldVoucherSheetFormat(ws);
  XLSX.utils.book_append_sheet(wb,ws,'Vouchers');
  addSummarySheet(wb,rows,'Voucher Export');
  XLSX.writeFile(wb,name+'.xlsx');
}
function exportFiltered(){ exportRows(filteredVouchers(),'StMarys_Filtered_Vouchers_'+todayISO()); }
function exportMine(){ exportRows(state.vouchers.filter(v=>v.created_by===state.user.username),'My_Vouchers_'+todayISO()); }
function exportLedger(){
  if(typeof XLSX==='undefined')return toast('Excel library not loaded.','err');
  const rows=filteredVouchers(); const wb=XLSX.utils.book_new();
  const aoa=[]; let grand=0;
  Object.entries(groupByHead(rows)).forEach(([head,items])=>{
    const ht=items.reduce((s,v)=>s+amountInt(v.amount),0); grand+=ht;
    aoa.push(['Head: '+head,'','','','Head Total',ht]);
    aoa.push(['Date','Voucher Type','Party','Towards','Mode','Amount']);
    items.forEach(v=>aoa.push([dmy(v.date),typeLabel(v.type),v.paid_to||v.received_from||v.ac_name||'',v.towards||'',v.mode||'',amountInt(v.amount)]));
    aoa.push(['','','','','','']);
  });
  aoa.push(['Grand Total','','','','',grand]);
  const ws=XLSX.utils.aoa_to_sheet(aoa); ws['!cols']=[{wch:16},{wch:16},{wch:28},{wch:45},{wch:14},{wch:14}];
  if(ws['!ref']){ const r=XLSX.utils.decode_range(ws['!ref']); for(let R=0;R<=r.e.r;R++){ const a=XLSX.utils.encode_cell({r:R,c:5}); if(ws[a]) ws[a].z='#,##0'; }}
  XLSX.utils.book_append_sheet(wb,ws,'Ledger');
  addSummarySheet(wb,rows,'Ledger Report');
  XLSX.writeFile(wb,'Ledger_Report_'+todayISO()+'.xlsx');
}
function exportCashBook(){
  if(typeof XLSX==='undefined')return toast('Excel library not loaded.','err');
  const rows=filteredVouchers(); if(!rows.length)return toast('No vouchers to export.','warn');
  const wb=XLSX.utils.book_new();
  const colleges={smg:"St. Mary's Group Of Institutions Guntur For Women",smwec:"St. Mary's Women's Engineering College"};
  Object.entries(colleges).forEach(([key,label])=>{
    const sub=rows.filter(v=>(v.college||'smg')===key); if(!sub.length)return;
    const receipts=sub.filter(v=>v.type==='credit'), payments=sub.filter(v=>v.type==='debit'||v.type==='onaccount');
    const n=Math.max(receipts.length,payments.length,1); let rCash=0,rBank=0,pCash=0,pBank=0;
    const isCash=v=>String(v.mode||'Cash').toLowerCase()==='cash';
    const aoa=[[label+' Cash Book','','','','','',''],['Particulars','Amount','Amount','Head Account','Particulars','Amount','Amount']];
    for(let i=0;i<n;i++){
      const r=receipts[i],p=payments[i]; const ra=r?amountInt(r.amount):0, pa=p?amountInt(p.amount):0;
      if(r){ if(isCash(r)) rCash+=ra; else rBank+=ra; } if(p){ if(isCash(p)) pCash+=pa; else pBank+=pa; }
      aoa.push([
        r?((r.received_from||r.ac_name||'')+' t/w '+(r.towards||'')):'', r&&isCash(r)?ra:'', r&&!isCash(r)?ra:'',
        p?(p.head||''):(r?(r.head||''):''),
        p?((p.paid_to||'')+' t/w '+(p.towards||'')):'', p&&isCash(p)?pa:'', p&&!isCash(p)?pa:''
      ]);
    }
    aoa.push(['Total',rCash,rBank,'','Total',pCash,pBank]);
    const ws=XLSX.utils.aoa_to_sheet(aoa); ws['!cols']=[{wch:38},{wch:12},{wch:12},{wch:22},{wch:44},{wch:12},{wch:12}]; ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:6}}]; ws['!freeze']={xSplit:0,ySplit:2};
    if(ws['!ref']){ const rg=XLSX.utils.decode_range(ws['!ref']); for(let R=2;R<=rg.e.r;R++){ [1,2,5,6].forEach(C=>{ const a=XLSX.utils.encode_cell({r:R,c:C}); if(ws[a]) ws[a].z='#,##0'; }); }}
    XLSX.utils.book_append_sheet(wb,ws,label.replace(/[\\/?*\[\]:]/g,' ').slice(0,31));
  });
  XLSX.writeFile(wb,'CashBook_Filtered_'+todayISO()+'.xlsx');
}
async function createUser(ev){ ev.preventDefault(); await api('createUser',{username:$('newUsername').value,password:$('newPassword').value,role:$('newRole').value,college:$('newCollege').value}); toast('User created.','ok'); $('userForm').reset(); const j=await api('listUsers'); state.users=j.users||[]; renderUsers(); }
async function toggleUser(username,status){ if(!confirm(`Set ${username} as ${status}?`))return; await api('setUserStatus',{username,status}); const j=await api('listUsers'); state.users=j.users||[]; renderUsers(); }
async function resetUserPassword(username){ const password=prompt('Enter new password for '+username); if(!password)return; await api('resetPassword',{username,password}); toast('Password reset.','ok'); }
function bindEvents(){ $('loginForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await login($('loginUsername').value.trim(),$('loginPassword').value);}catch(err){$('loginError').hidden=false;$('loginError').textContent=err.message;}}); $('setupForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await setupAdmin($('setupKey').value,$('setupPassword').value);}catch(err){toast(err.message,'err');}}); $('showSetupBtn')?.addEventListener('click',()=>{$('loginForm').classList.add('hidden');$('setupForm').classList.remove('hidden');}); $('backLoginBtn')?.addEventListener('click',()=>{$('setupForm').classList.add('hidden');$('loginForm').classList.remove('hidden');}); qsa('.nav').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page))); qsa('.type-btn').forEach(b=>b.addEventListener('click',()=>setVoucherType(b.dataset.type))); $('amount')?.addEventListener('input',()=>{$('amountWords').value=numberToWords($('amount').value);}); $('voucherForm')?.addEventListener('submit',saveVoucher); $('resetVoucherBtn')?.addEventListener('click',resetVoucherForm); $('applyFilterBtn')?.addEventListener('click',applyFilters); $('clearFilterBtn')?.addEventListener('click',clearFilters); $('downloadExcelBtn')?.addEventListener('click',exportFiltered); $('downloadLedgerBtn')?.addEventListener('click',exportLedger); $('downloadCashBookBtn')?.addEventListener('click',exportCashBook); $('downloadMyExcelBtn')?.addEventListener('click',exportMine); $('closePrintBtn')?.addEventListener('click',()=>$('printModal').classList.add('hidden')); $('printBtn')?.addEventListener('click',doPrint); $('userForm')?.addEventListener('submit',createUser); $('reloadAuditBtn')?.addEventListener('click',loadAudit); $('refreshBtn')?.addEventListener('click',()=>loadAll(true)); $('logoutBtn')?.addEventListener('click',logout); }
window.openPrint=openPrint; window.editVoucher=editVoucher; window.deleteVoucher=deleteVoucher; window.toggleUser=toggleUser; window.resetUserPassword=resetUserPassword;
window.initVoucherApp = async function(){
  bindEvents();
  if(state.token){ try{ const j=await api('validateSession'); state.user=j.user; await enterApp(); } catch{ localStorage.removeItem('smv_token'); } }
};
