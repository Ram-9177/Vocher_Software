(function(){
  'use strict';

  var buildVersion = '20260723-ledger-date-format-v10';
  try {
    var currentSrc = document.currentScript && document.currentScript.src;
    var currentVersion = currentSrc ? new URL(currentSrc, window.location.href).searchParams.get('v') : '';
    if(currentVersion) buildVersion = currentVersion;
  } catch(e) {}

  try {
    if(!document.querySelector('script[data-smv-user-layer="1"]')){
      var us = document.createElement('script');
      us.src = 'admin1-users.js?v=' + encodeURIComponent(buildVersion);
      us.async = false;
      us.setAttribute('data-smv-user-layer','1');
      document.head.appendChild(us);
    }
  } catch(e) {}

  const _oldInitApp = window.initApp;
  if (_oldInitApp) {
    window.initApp = function() {
      _oldInitApp.apply(this, arguments);
      if (typeof window._loadDynamicHeads === 'function') window._loadDynamicHeads();
    };
  }

  window._loadDynamicHeads = async function() {
    if (typeof _api !== 'function') return;
    try {
      const college = window.CURRENT_COLLEGE || 'smgg';
      const j = await _api('listHeads', { college: college });
      if (j && Array.isArray(j.heads)) {
        j.heads.forEach(h => {
          if (window.HEADS && !window.HEADS.includes(h.name)) window.HEADS.push(h.name);
        });
        if (typeof populateHeads === 'function') populateHeads();
        if (typeof populateMyHeads === 'function') populateMyHeads();
      }
    } catch(e) {}
  };

  window.checkNewHead = async function(el) {
    if(!el) return;
    const headVal = el.value.trim();
    if (!headVal || !window.HEADS || window.HEADS.includes(headVal)) return;

    const user = window.getCurrentUser ? window.getCurrentUser() : null;
    const isMainAdmin = user && (user.username === 'admin' || user.username === 'admin1');
    const hasPerm = isMainAdmin || (window.hasPermission && window.hasPermission(user, 'account_heads'));
    
    if (hasPerm) {
      if (confirm(`"${headVal}" is a new Account Head. Do you want to add it to the dropdown for future use?`)) {
        try {
          const col = document.getElementById('f_college') ? document.getElementById('f_college').value : 'smgg';
          if(typeof window._api === 'function'){
            await window._api('addHead', { name: headVal, type: 'common', college: col });
          }
          window.HEADS.push(headVal);
          if (typeof populateHeads === 'function') populateHeads();
          if (typeof populateMyHeads === 'function') populateMyHeads();
          if (typeof _toast === 'function') _toast('Account Head added!', 'ok');
        } catch(e) {
          console.error('Failed to add head', e);
          if (typeof _toast === 'function') _toast('Failed to add Account Head: ' + (e.message||''), 'err');
        }
      } else {
        window.HEADS.push(headVal);
      }
    }
  };

  window.saveV = async function(){
    const dateISO = getVal('f_date');
    if(!dateISO){ alert('Please pick a date.'); return; }
    const date = isoToDMY(dateISO);

    let v = {
      id: editId || Date.now(),
      date: date,
      type: CVT,
      college: CURRENT_COLLEGE || getVal('f_college') || 'smgg',
      prepBy: getVal('f_prep'),
      checkedBy: getVal('f_chk'),
      remarks: getVal('f_rem'),
      createdBy: CU,
      createdAt: new Date().toISOString()
    };

    if(CVT === 'credit'){
      v.acName = 'Credit';
      v.head = 'Credit';
      v.receivedFrom = getVal('fc_from');
      v.towards = getVal('fc_towards');
      v.block = getVal('fc_block');
      v.amount = parseFloat(document.getElementById('fc_amt').value) || 0;
      v.amtWords = getVal('fc_words');
      v.mode = getVal('fc_mode');
      v.cheque = getVal('fc_cheque');
      v.party = v.receivedFrom;
      if(!v.receivedFrom || !v.towards || !v.amount){ alert('Fill Received From, Towards and Amount.'); return; }
    } else if(CVT === 'debit'){
      v.head = getVal('fd_head');
      v.paidTo = getVal('fd_paidto');
      v.towards = getVal('fd_towards');
      v.block = getVal('fd_block');
      v.amount = parseFloat(document.getElementById('fd_amt').value) || 0;
      v.amtWords = getVal('fd_words');
      v.mode = getVal('fd_mode');
      v.cheque = getVal('fd_cheque');
      v.party = v.paidTo;
      if(!v.head || !v.paidTo || !v.towards || !v.amount){ alert('Fill Account Head, Paid To, Towards and Amount.'); return; }
    } else if(CVT === 'onaccount'){
      v.head = getVal('fo_head');
      v.paidTo = getVal('fo_paidto');
      v.towards = getVal('fo_towards');
      v.block = getVal('fo_block');
      v.amount = parseFloat(document.getElementById('fo_amt').value) || 0;
      v.amtWords = getVal('fo_words');
      v.mode = getVal('fo_mode');
      v.cheque = getVal('fo_ref');
      v.party = v.paidTo;
      if(!v.head || !v.paidTo || !v.towards || !v.amount){ alert('Fill Account Head, Paid To, Towards and Amount.'); return; }
    }

    const saveBtn = document.querySelector('.bp');
    if(saveBtn) saveBtn.classList.add('saving');

    try{
      await _saveVoucherToCloud(v);
      await _loadVouchersFromCloud();

      let excelOk = false;
      if(XLHandle) excelOk = await autoSaveLinkedExcel();

      if(saveBtn) saveBtn.classList.remove('saving');
      if(XLHandle && excelOk) _toast('✅ Saved live & updated ' + XLName, 'ok');
      else if(XLHandle && !excelOk) _toast('Voucher saved live — Excel update failed', 'warn');
      else _toast('✅ Voucher saved live on ' + v.date, 'ok');

      editId = null;
      resetF();
      show(CU === 'admin1' ? 'vouchers' : 'myvouchers');
    } catch(e){
      if(saveBtn) saveBtn.classList.remove('saving');
      console.error('live save failed', e);
      alert('Voucher not saved. ' + (e.message || 'Please try again.'));
    }
  };
})();
