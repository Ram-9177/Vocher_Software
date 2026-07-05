(function(){
  'use strict';

  try {
    if(!document.querySelector('script[data-smv-user-layer="1"]')){
      var us = document.createElement('script');
      us.src = 'admin1-users.js';
      us.async = false;
      us.setAttribute('data-smv-user-layer','1');
      document.head.appendChild(us);
    }
  } catch(e) {}

  window.saveV = async function(){
    const dateISO = getVal('f_date');
    if(!dateISO){ alert('Please pick a date.'); return; }
    const date = isoToDMY(dateISO);

    let v = {
      id: editId || Date.now(),
      date: date,
      type: CVT,
      college: CURRENT_COLLEGE || getVal('f_college') || 'smg',
      prepBy: getVal('f_prep'),
      checkedBy: getVal('f_chk'),
      remarks: getVal('f_rem'),
      createdBy: CU,
      createdAt: new Date().toISOString()
    };

    if(CVT === 'credit'){
      v.acName = getVal('fc_acname');
      v.head = getVal('fc_head');
      v.receivedFrom = getVal('fc_from');
      v.towards = getVal('fc_towards');
      v.amount = parseFloat(document.getElementById('fc_amt').value) || 0;
      v.amtWords = getVal('fc_words');
      v.mode = getVal('fc_mode');
      v.cheque = getVal('fc_cheque');
      v.party = v.receivedFrom || v.acName;
      if(!v.receivedFrom || !v.towards || !v.amount){ alert('Fill Received From, Towards and Amount.'); return; }
    } else if(CVT === 'debit'){
      v.head = getVal('fd_head');
      v.paidTo = getVal('fd_paidto');
      v.towards = getVal('fd_towards');
      v.amount = parseFloat(document.getElementById('fd_amt').value) || 0;
      v.amtWords = getVal('fd_words');
      v.mode = getVal('fd_mode');
      v.cheque = getVal('fd_cheque');
      v.party = v.paidTo;
      if(!v.paidTo || !v.towards || !v.amount){ alert('Fill Paid To, Towards and Amount.'); return; }
    } else if(CVT === 'onaccount'){
      v.head = getVal('fo_head');
      v.paidTo = getVal('fo_paidto');
      v.towards = getVal('fo_towards');
      v.amount = parseFloat(document.getElementById('fo_amt').value) || 0;
      v.amtWords = getVal('fo_words');
      v.mode = getVal('fo_mode');
      v.cheque = getVal('fo_ref');
      v.party = v.paidTo;
      if(!v.paidTo || !v.towards || !v.amount){ alert('Fill Paid To, Towards and Amount.'); return; }
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
