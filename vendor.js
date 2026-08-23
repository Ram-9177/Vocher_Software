/**
 * St. Mary's Voucher System - Vendor Management & Vendor Ledger Module
 * 
 * Features:
 * 1. Automatic permanent Vendor ID generation (V00001, V00002, etc.)
 * 2. Automatic creation & indexing of Vendor Ledger accounts upon saving
 * 3. Bidirectional linking of multiple Debit Vouchers to the permanent Vendor ID
 * 4. Interactive Vendor Ledger Statement with financial balance, disbursements, and progress tracking
 * 5. Full Agreement Generation matching the exact uploaded institutional template
 * 6. 3-Slot document attachment manager
 * 7. Excel ledger export & print statement generation
 */
(function() {
  'use strict';

  var VENDORS = [];
  var vendorEditId = null;
  var activeLedgerVendorId = null;
  var currentVendorFiles = [null, null, null]; // 3 dedicated file slots

  function getStorageKey() {
    var college = (window.CURRENT_COLLEGE || 'smgg').toLowerCase();
    return 'smv_vendors_' + college;
  }

  function loadVendors() {
    try {
      var key = getStorageKey();
      var raw = localStorage.getItem(key);
      if (!raw) {
        raw = localStorage.getItem('smv_vendors');
      }
      VENDORS = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(VENDORS)) VENDORS = [];
    } catch(e) {
      console.error('Failed to load vendors', e);
      VENDORS = [];
    }
    updateVendorDatalist();
  }
  window.loadVendors = loadVendors;
  window.getVendorsCount = function() { return VENDORS.length; };
  window.getAllVendors = function() { return VENDORS.slice(); };
  window.reloadVendorModule = function() {
    loadVendors();
    if (typeof renderVendorsTable === 'function') renderVendorsTable();
    if (typeof renderVendorLedgerTable === 'function') renderVendorLedgerTable();
  };

  function saveVendorsToStorage() {
    try {
      var key = getStorageKey();
      localStorage.setItem(key, JSON.stringify(VENDORS));
      updateVendorDatalist();
    } catch(e) {
      console.error('Failed to save vendors to localStorage', e);
      if (typeof _toast === 'function') {
        _toast('Storage notice: Large files may exceed browser storage.', 'warn');
      }
    }
  }

  // Generate next sequential permanent Vendor ID: V00001, V00002, etc.
  function getNextVendorId() {
    var maxNum = 0;
    VENDORS.forEach(function(v) {
      var vid = v.vendorId || v.id || '';
      var m = String(vid).match(/V(\d+)/i);
      if (m && m[1]) {
        var num = parseInt(m[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });
    var nextNum = maxNum + 1;
    return 'V' + String(nextNum).padStart(5, '0');
  }

  // Resolve Vendor ID from party/company name or ID string
  window.resolveVendorIdForParty = function(partyName) {
    if (!partyName) return '';
    var p = String(partyName).trim().toLowerCase();
    var found = VENDORS.find(function(v) {
      var vid = (v.vendorId || v.id || '').toLowerCase();
      var comp = (v.companyName || v.company || '').toLowerCase();
      var name = (v.vendorName || v.name || '').toLowerCase();
      if (vid && p.indexOf(vid) > -1) return true;
      if (comp && (p === comp || p.indexOf(comp) > -1 || comp.indexOf(p) > -1)) return true;
      if (name && (p === name || p.indexOf(name) > -1)) return true;
      return false;
    });
    return found ? (found.vendorId || found.id) : '';
  };

  function updateVendorDatalist() {
    var dl = document.getElementById('DL_VENDORS');
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = 'DL_VENDORS';
      document.body.appendChild(dl);
    }
    dl.innerHTML = '';
    var items = [];
    VENDORS.forEach(function(v) {
      var c = v.companyName || v.company || '';
      var n = v.vendorName || v.name || '';
      var vid = v.vendorId || v.id || '';
      if (c && items.indexOf(c) === -1) items.push(c);
      if (vid && c && items.indexOf(vid + ' - ' + c) === -1) items.push(vid + ' - ' + c);
      if (n && items.indexOf(n) === -1) items.push(n);
    });
    items.forEach(function(item) {
      var opt = document.createElement('option');
      opt.value = item;
      dl.appendChild(opt);
    });
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function sanitize(str) {
    return String(str || '').replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatCurrency(num) {
    var n = parseFloat(num) || 0;
    return '₹ ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function isoToDMY(iso) {
    if (typeof window.isoToDMY === 'function') return window.isoToDMY(iso);
    if (!iso) return '';
    var parts = String(iso).slice(0, 10).split('-');
    if (parts.length === 3) return parts[2] + '/' + parts[1] + '/' + parts[0];
    return iso;
  }

  // --- 3 DEDICATED FILE SLOTS ---
  window.handleSlotFileSelect = function(slotIdx, input) {
    if (!input || !input.files || input.files.length === 0) return;
    var file = input.files[0];

    if (file.size > 5 * 1024 * 1024) {
      alert('File "' + file.name + '" exceeds the 5MB maximum limit.');
      input.value = '';
      return;
    }

    var reader = new FileReader();
    reader.onload = function(e) {
      currentVendorFiles[slotIdx] = {
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        dataUrl: e.target.result
      };
      renderFileSlots();
    };
    reader.readAsDataURL(file);
    input.value = '';
  };

  window.removeSlotFile = function(slotIdx, e) {
    if (e && e.stopPropagation) e.stopPropagation();
    currentVendorFiles[slotIdx] = null;
    renderFileSlots();
  };

  window.previewSlotFile = function(slotIdx, e) {
    if (e && e.stopPropagation) e.stopPropagation();
    var f = currentVendorFiles[slotIdx];
    if (!f || !f.dataUrl) return;
    openFileViewerModal(f.name, f.type, f.dataUrl);
  };

  function renderFileSlots() {
    for (var i = 0; i < 3; i++) {
      var slotEl = document.getElementById('VENDOR_FILE_SLOT_' + i);
      if (!slotEl) continue;

      var file = currentVendorFiles[i];
      if (file) {
        var isPdf = file.type && file.type.indexOf('pdf') > -1;
        var iconHtml = isPdf ? '📄' : '📎';

        slotEl.className = 'vendor-file-slot active';
        slotEl.innerHTML =
          '<div style="display:flex;align-items:center;gap:10px;flex:1;overflow:hidden;" onclick="previewSlotFile(' + i + ', event)">' +
            '<span class="slot-icon">' + iconHtml + '</span>' +
            '<div style="flex:1;overflow:hidden;">' +
              '<div class="slot-title" title="' + sanitize(file.name) + '">' + sanitize(file.name) + '</div>' +
              '<div class="slot-sub">' + formatFileSize(file.size) + ' &bull; Click to Preview</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:6px;align-items:center;">' +
            '<button type="button" class="slot-btn-view" onclick="previewSlotFile(' + i + ', event)" title="View file">👁️</button>' +
            '<button type="button" class="slot-btn-remove" onclick="removeSlotFile(' + i + ', event)" title="Remove file">✕</button>' +
          '</div>';
      } else {
        slotEl.className = 'vendor-file-slot';
        slotEl.innerHTML =
          '<label style="display:flex;align-items:center;gap:10px;width:100%;cursor:pointer;margin:0;">' +
            '<span class="slot-icon">📄</span>' +
            '<div style="flex:1;">' +
              '<div class="slot-title">Choose file or drag &amp; drop</div>' +
              '<div class="slot-sub">PDF, DOC, DOCX (Max. 5MB)</div>' +
            '</div>' +
            '<input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onchange="handleSlotFileSelect(' + i + ', this)" style="display:none;">' +
          '</label>';
      }
    }
  }

  // --- PREVIEW MODAL FOR FILES ---
  function openFileViewerModal(fileName, fileType, dataUrl) {
    var modal = document.getElementById('VENDOR_FILE_MODAL');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'VENDOR_FILE_MODAL';
      modal.className = 'mo';
      modal.innerHTML =
        '<div class="md" style="max-width:900px;width:95%;height:85vh;display:flex;flex-direction:column;">' +
          '<div class="mh">' +
            '<h2 id="VFM_TITLE" style="font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">File Preview</h2>' +
            '<div style="display:flex;gap:8px;align-items:center;">' +
              '<a id="VFM_DOWNLOAD" class="btn bp bsm" download title="Download file">⬇ Download</a>' +
              '<button type="button" class="cbtn" onclick="document.getElementById(\'VENDOR_FILE_MODAL\').classList.add(\'h\')" title="Close">✕</button>' +
            '</div>' +
          '</div>' +
          '<div class="mb" id="VFM_BODY" style="flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;background:#1e1e1e;padding:10px;border-radius:8px;"></div>' +
        '</div>';
      document.body.appendChild(modal);
    }

    var titleEl = document.getElementById('VFM_TITLE');
    var dlEl = document.getElementById('VFM_DOWNLOAD');
    var bodyEl = document.getElementById('VFM_BODY');

    titleEl.textContent = fileName || 'Document Preview';
    dlEl.href = dataUrl;
    dlEl.download = fileName || 'vendor_document';

    if (fileType.indexOf('pdf') > -1) {
      bodyEl.innerHTML = '<iframe src="' + dataUrl + '" style="width:100%;height:100%;border:none;border-radius:6px;background:#fff;"></iframe>';
    } else if (fileType.indexOf('image') > -1) {
      bodyEl.innerHTML = '<img src="' + dataUrl + '" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;" alt="Preview">';
    } else {
      bodyEl.innerHTML = '<div style="color:#fff;text-align:center;">' +
        '<p style="font-size:16px;margin-bottom:12px;">📄 Document: ' + sanitize(fileName) + '</p>' +
        '<p style="color:#aaa;font-size:13px;margin-bottom:16px;">Preview is ready for download.</p>' +
        '<a href="' + dataUrl + '" download="' + sanitize(fileName) + '" class="btn bp">Click here to Download &amp; Open</a>' +
      '</div>';
    }

    modal.classList.remove('h');
  }

  window.viewSavedVendorFile = function(vendorId, fileIdx) {
    var v = VENDORS.find(function(item) { return (item.vendorId === vendorId || item.id === vendorId); });
    if (!v || !v.agreement || !v.agreement.files || !v.agreement.files[fileIdx]) {
      alert('File not found.');
      return;
    }
    var f = v.agreement.files[fileIdx];
    openFileViewerModal(f.name, f.type, f.dataUrl);
  };

  // --- SAVE VENDOR & AUTOMATICALLY CREATE VENDOR LEDGER ENTRY ---
  window.saveVendor = function() {
    var company = (document.getElementById('f_v_company').value || '').trim();
    var name = (document.getElementById('f_v_name').value || '').trim();
    var phone = (document.getElementById('f_v_phone').value || '').trim();
    var pan = (document.getElementById('f_v_pan').value || '').trim().toUpperCase();
    var email = (document.getElementById('f_v_email') ? document.getElementById('f_v_email').value : '').trim();
    var address = (document.getElementById('f_v_address') ? document.getElementById('f_v_address').value : '').trim();

    var workDesc = (document.getElementById('f_v_work_desc').value || '').trim();
    var periodStart = (document.getElementById('f_v_period_start') ? document.getElementById('f_v_period_start').value : '').trim();
    var periodEnd = (document.getElementById('f_v_period_end') ? document.getElementById('f_v_period_end').value : '').trim();

    var amount = parseFloat(document.getElementById('f_v_amount').value) || 0;
    var words = (document.getElementById('f_v_words').value || '').trim();

    var gst = (document.getElementById('f_v_gst') ? document.getElementById('f_v_gst').value : '').trim();
    var bank = (document.getElementById('f_v_bank') ? document.getElementById('f_v_bank').value : '').trim();
    var remarks = (document.getElementById('f_v_remarks') ? document.getElementById('f_v_remarks').value : '').trim();

    var authBy = (document.getElementById('f_v_auth_by') ? document.getElementById('f_v_auth_by').value : '').trim();
    var authRole = (document.getElementById('f_v_auth_role') ? document.getElementById('f_v_auth_role').value : '').trim();
    var authPlace = (document.getElementById('f_v_auth_place') ? document.getElementById('f_v_auth_place').value : '').trim() || 'Chebrolu / Guntur';

    var college = document.getElementById('f_v_college') ? document.getElementById('f_v_college').value : (window.CURRENT_COLLEGE || 'smgg');

    // Field Validations
    if (!company) { alert('Please enter Vendor Company Name.'); document.getElementById('f_v_company').focus(); return; }
    if (!name) { alert('Please enter Vendor Name.'); document.getElementById('f_v_name').focus(); return; }
    if (!phone) { alert('Please enter 10-digit Vendor Phone Number.'); document.getElementById('f_v_phone').focus(); return; }
    
    // PAN validation
    var panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    if (!pan) {
      alert('Please enter Vendor PAN Number.');
      document.getElementById('f_v_pan').focus();
      return;
    } else if (!panRegex.test(pan)) {
      if (!confirm('The entered PAN "' + pan + '" does not match standard 10-character PAN format (e.g. ABCDE1234F). Do you wish to continue?')) {
        document.getElementById('f_v_pan').focus();
        return;
      }
    }

    if (!workDesc) { alert('Please enter Work Description / Scope of Work.'); document.getElementById('f_v_work_desc').focus(); return; }
    if (!amount || amount <= 0) { alert('Please enter agreed vendor amount.'); document.getElementById('f_v_amount').focus(); return; }
    if (!periodStart) { alert('Please select Agreement Start Date.'); document.getElementById('f_v_period_start').focus(); return; }

    var user = (window.getCurrentUser && window.getCurrentUser()) || { username: window.CU || 'admin1' };
    var createdBy = user.username || 'admin1';

    // Auto-generate or preserve permanent Vendor ID
    var vendorId = vendorEditId ? vendorEditId : getNextVendorId();
    var agreementNo = 'AGR-' + vendorId + '-' + (periodStart.slice(0, 4) || new Date().getFullYear());

    // Attached files from the 3 slots
    var attachedFiles = currentVendorFiles.filter(function(f) { return f !== null; });

    // Build the master Vendor & Vendor Ledger Record
    var vendorRecord = {
      vendorId: vendorId,
      id: vendorId,
      companyName: company,
      company: company,
      vendorName: name,
      name: name,
      phone: phone,
      pan: pan,
      email: email,
      address: address,
      workDescription: workDesc,
      workDesc: workDesc,
      agreedAmount: amount,
      amount: amount,
      amountInWords: words || (typeof numToWords === 'function' ? numToWords(amount) : ''),
      amtWords: words || (typeof numToWords === 'function' ? numToWords(amount) : ''),
      periodStart: periodStart,
      periodEnd: periodEnd,
      agreementDate: periodStart,
      agreement: {
        agreementNo: agreementNo,
        agreementDate: periodStart,
        periodStart: periodStart,
        periodEnd: periodEnd,
        files: attachedFiles,
        createdUnderVendorId: vendorId,
        createdAt: new Date().toISOString()
      },
      files: attachedFiles,
      gstNumber: gst,
      bankAccountDetails: bank,
      remarks: remarks,
      authBy: authBy,
      authRole: authRole,
      authPlace: authPlace,
      college: college,
      status: 'Active',
      createdBy: createdBy,
      createdAt: vendorEditId ? (VENDORS.find(function(x){return x.vendorId===vendorEditId;})||{}).createdAt || new Date().toISOString() : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (vendorEditId) {
      var idx = VENDORS.findIndex(function(v) { return (v.vendorId === vendorEditId || v.id === vendorEditId); });
      if (idx !== -1) {
        VENDORS[idx] = vendorRecord;
      } else {
        VENDORS.unshift(vendorRecord);
      }
    } else {
      VENDORS.unshift(vendorRecord);
    }

    // Persist under College storage & index
    saveVendorsToStorage();
    renderVendorsTable();
    if (typeof renderVendorLedgerTable === 'function') renderVendorLedgerTable();

    var isNew = !vendorEditId;
    resetVendorForm();

    if (typeof _toast === 'function') {
      _toast('✅ Vendor ' + vendorId + ' & Vendor Ledger Account Created!', 'ok');
    }

    if (isNew) {
      if (confirm('🎉 Vendor Saved & Ledger Created Successfully!\n\nPermanent Vendor ID: ' + vendorId + '\nAgreement No: ' + agreementNo + '\nCompany: ' + company + '\nAgreed Amount: ' + formatCurrency(amount) + '\n\nWould you like to open this Vendor\'s Ledger Statement now?')) {
        openVendorLedgerModal(vendorId);
      }
    }
  };

  // --- RESET FORM & REFRESH AUTO-GENERATED ID ---
  window.resetVendorForm = function() {
    vendorEditId = null;
    currentVendorFiles = [null, null, null];

    var formIds = [
      'f_v_company', 'f_v_name', 'f_v_phone', 'f_v_pan', 'f_v_email',
      'f_v_address', 'f_v_work_desc', 'f_v_period_start', 'f_v_period_start_DISPLAY',
      'f_v_period_end', 'f_v_period_end_DISPLAY',
      'f_v_amount', 'f_v_words', 'f_v_gst', 'f_v_bank', 'f_v_remarks',
      'f_v_auth_by', 'f_v_auth_role', 'f_v_auth_place'
    ];

    formIds.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });

    var colEl = document.getElementById('f_v_college');
    if (colEl) colEl.value = window.CURRENT_COLLEGE || 'smgg';

    // Show Next Auto-Generated Vendor ID
    var idInput = document.getElementById('f_v_id');
    if (idInput) {
      idInput.value = getNextVendorId();
    }

    var saveBtn = document.getElementById('BTN_SAVE_VENDOR');
    if (saveBtn) saveBtn.innerHTML = '💾 Save Vendor';

    // Set today's date for agreement by default
    var today = new Date().toISOString().slice(0, 10);
    var agStartEl = document.getElementById('f_v_period_start');
    if (agStartEl) {
      agStartEl.value = today;
      if (typeof syncDateFilterDisplay === 'function') syncDateFilterDisplay('f_v_period_start');
    }

    renderFileSlots();
  };

  // --- EDIT VENDOR ---
  window.editVendor = function(id) {
    var v = VENDORS.find(function(item) { return (item.vendorId === id || item.id === id); });
    if (!v) return;

    vendorEditId = v.vendorId || v.id;

    // Load file slots
    currentVendorFiles = [null, null, null];
    var existingFiles = (v.agreement && v.agreement.files) || v.files || [];
    for (var i = 0; i < Math.min(3, existingFiles.length); i++) {
      currentVendorFiles[i] = existingFiles[i];
    }

    var idEl = document.getElementById('f_v_id');
    if (idEl) idEl.value = vendorEditId;

    document.getElementById('f_v_company').value = v.companyName || v.company || '';
    document.getElementById('f_v_name').value = v.vendorName || v.name || '';
    document.getElementById('f_v_phone').value = v.phone || '';
    document.getElementById('f_v_pan').value = v.pan || '';
    if (document.getElementById('f_v_email')) document.getElementById('f_v_email').value = v.email || '';
    if (document.getElementById('f_v_address')) document.getElementById('f_v_address').value = v.address || '';

    document.getElementById('f_v_work_desc').value = v.workDescription || v.workDesc || '';
    
    var pStart = v.periodStart || (v.agreement && v.agreement.periodStart) || v.agreementDate || '';
    var pEnd = v.periodEnd || (v.agreement && v.agreement.periodEnd) || '';

    if (document.getElementById('f_v_period_start')) {
      document.getElementById('f_v_period_start').value = pStart;
      if (typeof syncDateFilterDisplay === 'function') syncDateFilterDisplay('f_v_period_start');
    }
    if (document.getElementById('f_v_period_end')) {
      document.getElementById('f_v_period_end').value = pEnd;
      if (typeof syncDateFilterDisplay === 'function') syncDateFilterDisplay('f_v_period_end');
    }

    document.getElementById('f_v_amount').value = v.agreedAmount || v.amount || '';
    document.getElementById('f_v_words').value = v.amountInWords || v.amtWords || '';

    if (document.getElementById('f_v_gst')) document.getElementById('f_v_gst').value = v.gstNumber || '';
    if (document.getElementById('f_v_bank')) document.getElementById('f_v_bank').value = v.bankAccountDetails || '';
    if (document.getElementById('f_v_remarks')) document.getElementById('f_v_remarks').value = v.remarks || '';

    if (document.getElementById('f_v_auth_by')) document.getElementById('f_v_auth_by').value = v.authBy || '';
    if (document.getElementById('f_v_auth_role')) document.getElementById('f_v_auth_role').value = v.authRole || '';
    if (document.getElementById('f_v_auth_place')) document.getElementById('f_v_auth_place').value = v.authPlace || '';

    if (document.getElementById('f_v_college')) {
      document.getElementById('f_v_college').value = v.college || window.CURRENT_COLLEGE || 'smgg';
    }

    var saveBtn = document.getElementById('BTN_SAVE_VENDOR');
    if (saveBtn) saveBtn.innerHTML = '💾 Update Vendor (' + vendorEditId + ')';

    renderFileSlots();

    if (typeof show === 'function') show('vendor');
    var formCard = document.getElementById('CARD_VENDOR_FORM');
    if (formCard) formCard.scrollIntoView({ behavior: 'smooth' });
  };

  // --- DELETE VENDOR ---
  window.deleteVendor = function(id) {
    var v = VENDORS.find(function(item) { return (item.vendorId === id || item.id === id); });
    if (!v) return;

    var displayName = v.companyName || v.company || v.vendorId;
    if (confirm('Are you sure you want to delete Vendor ' + (v.vendorId || '') + ' (' + displayName + ') and its Ledger?')) {
      VENDORS = VENDORS.filter(function(item) { return (item.vendorId !== id && item.id !== id); });
      saveVendorsToStorage();
      renderVendorsTable();
      if (typeof renderVendorLedgerTable === 'function') renderVendorLedgerTable();
      if (vendorEditId === id) resetVendorForm();
      var vlm = document.getElementById('VENDOR_LEDGER_MODAL');
      if (vlm && !vlm.classList.contains('h')) vlm.classList.add('h');
      if (typeof _toast === 'function') _toast('Vendor deleted.', 'warn');
    }
  };

  // =========================================================================
  // VENDOR LEDGER ENGINE: FINANCIALS & LINKED DEBIT VOUCHERS
  // =========================================================================

  function normalizeCleanStr(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function getAllSystemVouchers() {
    var list = [];
    if (window.VS && Array.isArray(window.VS) && window.VS.length > 0) {
      list = window.VS;
    } else if (typeof VS !== 'undefined' && Array.isArray(VS) && VS.length > 0) {
      list = VS;
      window.VS = VS;
    }
    
    // Also fallback/merge from localStorage if in-memory list is empty
    if (list.length === 0) {
      try {
        var college = (window.CURRENT_COLLEGE || 'smgg').toLowerCase();
        var raw = localStorage.getItem('smv_vouchers_' + college);
        if (!raw) raw = localStorage.getItem('smv_vouchers');
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            list = parsed;
            window.VS = list;
          }
        }
      } catch(e) {}
    }
    return list;
  }
  window.getAllSystemVouchers = getAllSystemVouchers;

  // Retrieve all debit vouchers linked to a given vendor ID
  window.getLinkedDebitVouchers = function(vendorId) {
    if (!vendorId) return [];
    var v = VENDORS.find(function(item) { return (item.vendorId === vendorId || item.id === vendorId); });
    var vsList = getAllSystemVouchers();
    
    var vidClean = normalizeCleanStr(vendorId);
    var compClean = v ? normalizeCleanStr(v.companyName || v.company || '') : '';
    var nameClean = v ? normalizeCleanStr(v.vendorName || v.name || '') : '';

    return vsList.filter(function(item) {
      if (!item) return false;
      // Must be a debit voucher
      var t = String(item.type || '').toLowerCase();
      if (t !== 'debit') return false;

      // 1. Direct vendorId link
      var itemVid = normalizeCleanStr(item.vendorId || item.vendor_id || '');
      if (itemVid && vidClean && (itemVid === vidClean || itemVid.indexOf(vidClean) > -1 || vidClean.indexOf(itemVid) > -1)) return true;

      // 2. Matching party / paidTo
      var pt = normalizeCleanStr(item.paidTo || item.paid_to || item.party || '');
      if (pt) {
        if (vidClean && (pt === vidClean || pt.indexOf(vidClean) > -1)) return true;
        if (compClean && (pt === compClean || pt.indexOf(compClean) > -1 || compClean.indexOf(pt) > -1)) return true;
        if (nameClean && (pt === nameClean || pt.indexOf(nameClean) > -1 || nameClean.indexOf(pt) > -1)) return true;
      }

      // 3. Fallback check on towards if it explicitly mentions company name or vendor ID
      var tw = normalizeCleanStr(item.towards || '');
      if (tw) {
        if (vidClean && tw.indexOf(vidClean) > -1) return true;
        if (compClean && compClean.length > 4 && tw.indexOf(compClean) > -1) return true;
      }

      return false;
    });
  };

  // Calculate complete financial statement for a vendor
  window.getVendorFinancials = function(vendorId) {
    var v = VENDORS.find(function(item) { return (item.vendorId === vendorId || item.id === vendorId); });
    if (!v) return null;

    var agreed = parseFloat(v.agreedAmount || v.amount) || 0;
    var vouchers = window.getLinkedDebitVouchers(vendorId);

    var totalPaid = 0;
    vouchers.forEach(function(item) {
      totalPaid += (parseFloat(item.amount) || 0);
    });

    var balance = agreed - totalPaid;
    var paidPercent = agreed > 0 ? Math.min(100, Math.round((totalPaid / agreed) * 100)) : 0;
    
    var status = 'unpaid';
    if (totalPaid >= agreed && agreed > 0) {
      status = 'paid';
    } else if (totalPaid > 0) {
      status = 'partial';
    }

    return {
      vendor: v,
      agreedAmount: agreed,
      totalPaid: totalPaid,
      balance: balance,
      paidPercent: paidPercent,
      vouchersCount: vouchers.length,
      status: status,
      linkedVouchers: vouchers
    };
  };

  // --- AUTOMATIC AGREEMENT STATUS ENGINE ---
  // Calculates: Active, Expiring soon (<=30d), Expired, Not started based on periodStart and periodEnd vs today
  window.getAgreementAutomaticStatus = function(v) {
    if (!v) return { key: 'active', label: 'Active', badgeClass: 'badge-ag-active', icon: '🟢', detail: '' };

    var start = v.periodStart || (v.agreement && v.agreement.periodStart) || v.agreementDate || '';
    var end = v.periodEnd || (v.agreement && v.agreement.periodEnd) || '';

    var todayStr = new Date().toISOString().slice(0, 10);
    var todayTime = new Date(todayStr).getTime();

    // Check explicit override status if Terminated or Completed
    var explicitSt = (v.status || '').toLowerCase();
    if (explicitSt === 'terminated') {
      return { key: 'terminated', label: 'Terminated', badgeClass: 'badge-ag-terminated', icon: '⛔', detail: '' };
    }
    if (explicitSt === 'completed') {
      return { key: 'completed', label: 'Completed', badgeClass: 'badge-ag-completed', icon: '🔵', detail: '' };
    }

    if (!start && !end) {
      return { key: 'active', label: 'Active', badgeClass: 'badge-ag-active', icon: '🟢', detail: '' };
    }

    // 1. Not Started (Start date in future)
    if (start && start > todayStr) {
      var sTime = new Date(start).getTime();
      var daysToStart = Math.ceil((sTime - todayTime) / (1000 * 60 * 60 * 24));
      return {
        key: 'not_started',
        label: 'Not Started',
        detail: 'Starts in ' + daysToStart + 'd',
        badgeClass: 'badge-ag-notstarted',
        icon: '⏳',
        daysDiff: daysToStart
      };
    }

    // 2. Expired (End date in past)
    if (end && end < todayStr) {
      var eTime = new Date(end).getTime();
      var daysExpired = Math.floor((todayTime - eTime) / (1000 * 60 * 60 * 24));
      return {
        key: 'expired',
        label: 'Expired',
        detail: daysExpired + 'd ago',
        badgeClass: 'badge-ag-expired',
        icon: '🔴',
        daysDiff: -daysExpired
      };
    }

    // 3. Expiring Soon (Within 30 days of end date)
    if (end && end >= todayStr) {
      var eTime2 = new Date(end).getTime();
      var daysLeft = Math.ceil((eTime2 - todayTime) / (1000 * 60 * 60 * 24));
      if (daysLeft <= 30) {
        return {
          key: 'expiring_soon',
          label: 'Expiring Soon',
          detail: daysLeft + 'd left',
          badgeClass: 'badge-ag-expiring',
          icon: '🟡',
          daysDiff: daysLeft
        };
      }
    }

    // 4. Active (Within valid period)
    return {
      key: 'active',
      label: 'Active',
      detail: '',
      badgeClass: 'badge-ag-active',
      icon: '🟢',
      daysDiff: null
    };
  };

  // Populate Vendor Dropdown in Ledger Filters
  function populateVendorFilterDropdown() {
    var sel = document.getElementById('VL_FILTER_VENDOR');
    if (!sel) return;
    var currentVal = sel.value;
    sel.innerHTML = '<option value="">All Vendors</option>';
    VENDORS.forEach(function(v) {
      var opt = document.createElement('option');
      var vid = v.vendorId || v.id;
      opt.value = vid;
      opt.textContent = vid + ' - ' + (v.companyName || v.company || 'Vendor');
      sel.appendChild(opt);
    });
    if (currentVal) sel.value = currentVal;
  }

  window.clearVendorLedgerSearch = function() {
    var s = document.getElementById('VL_SEARCH');
    if (s) s.value = '';
    var vSel = document.getElementById('VL_FILTER_VENDOR');
    if (vSel) vSel.value = '';
    var agSt = document.getElementById('VL_FILTER_AGREEMENT_STATUS');
    if (agSt) agSt.value = '';
    var st = document.getElementById('VL_FILTER_STATUS');
    if (st) st.value = '';
    var c = document.getElementById('VL_FILTER_COLLEGE');
    if (c) c.value = '';

    var df = document.getElementById('VL_DF');
    if (df) { df.value = ''; if (typeof syncDateFilterDisplay === 'function') syncDateFilterDisplay('VL_DF'); }
    var dt = document.getElementById('VL_DT');
    if (dt) { dt.value = ''; if (typeof syncDateFilterDisplay === 'function') syncDateFilterDisplay('VL_DT'); }

    window.renderVendorLedgerTable();
  };

  window.setQuickSearch = function(val) {
    var s = document.getElementById('VL_SEARCH');
    if (s) {
      s.value = val;
      s.focus();
    }
    window.renderVendorLedgerTable();
  };

  window.setQuickFilter = function(type, val) {
    if (type === 'agreement') {
      var el = document.getElementById('VL_FILTER_AGREEMENT_STATUS');
      if (el) el.value = val;
    } else if (type === 'payment') {
      var pEl = document.getElementById('VL_FILTER_STATUS');
      if (pEl) pEl.value = val;
    }
    window.renderVendorLedgerTable();
  };

  // --- RENDER VENDOR LEDGER MASTER REGISTER TABLE ---
  window.renderVendorLedgerTable = function() {
    populateVendorFilterDropdown();

    var tbody = document.getElementById('VENDOR_LEDGER_TABLE_BODY');
    var emptyEl = document.getElementById('VENDOR_LEDGER_EMPTY_MSG');
    var countEl = document.getElementById('VL_COUNT_MSG');
    var infoEl = document.getElementById('VL_SEARCH_RESULTS_INFO');
    if (!tbody) return;

    var query = (document.getElementById('VL_SEARCH') ? document.getElementById('VL_SEARCH').value : '').toLowerCase().trim();
    var df = document.getElementById('VL_DF') ? document.getElementById('VL_DF').value : '';
    var dt = document.getElementById('VL_DT') ? document.getElementById('VL_DT').value : '';
    var vendorFilter = document.getElementById('VL_FILTER_VENDOR') ? document.getElementById('VL_FILTER_VENDOR').value : '';
    var agStatusFilter = document.getElementById('VL_FILTER_AGREEMENT_STATUS') ? document.getElementById('VL_FILTER_AGREEMENT_STATUS').value : '';
    var statusFilter = document.getElementById('VL_FILTER_STATUS') ? document.getElementById('VL_FILTER_STATUS').value : '';
    var collegeFilter = document.getElementById('VL_FILTER_COLLEGE') ? document.getElementById('VL_FILTER_COLLEGE').value : '';

    var currentCol = (window.CURRENT_COLLEGE || 'smgg').toLowerCase();

    var overallAgreed = 0;
    var overallPaid = 0;
    var overallVouchers = 0;
    var activeCount = 0;

    var ledgerList = [];

    VENDORS.forEach(function(v) {
      var fin = window.getVendorFinancials(v.vendorId || v.id);
      if (!fin) return;

      var agStatus = window.getAgreementAutomaticStatus(v);
      if (agStatus.key === 'active' || agStatus.key === 'expiring_soon') {
        activeCount++;
      }

      overallAgreed += fin.agreedAmount;
      overallPaid += fin.totalPaid;
      overallVouchers += fin.vouchersCount;

      // 1. College Filter
      if (collegeFilter && v.college !== collegeFilter) return;
      if (!collegeFilter && v.college && v.college !== currentCol && window.CU !== 'admin1') return;

      // 2. Specific Vendor Filter
      if (vendorFilter && (v.vendorId !== vendorFilter && v.id !== vendorFilter)) return;

      // 3. Date Range Filter (Agreement Start / End / Agreement Date)
      var vStart = v.periodStart || (v.agreement && v.agreement.periodStart) || v.agreementDate || '';
      var vEnd = v.periodEnd || (v.agreement && v.agreement.periodEnd) || '';
      
      if (df) {
        if (vStart && vStart < df && (!vEnd || vEnd < df)) return;
      }
      if (dt) {
        if (vStart && vStart > dt) return;
      }

      // 4. Agreement Status Filter (Active, Expiring Soon, Expired, Not Started, Completed, Terminated)
      if (agStatusFilter) {
        if (agStatus.key !== agStatusFilter) return;
      }

      // 5. Payment Status Filter
      // Options: pending, partial, paid, unpaid
      if (statusFilter) {
        if (statusFilter === 'pending') {
          if (fin.balance <= 0) return;
        } else if (statusFilter === 'partial') {
          if (fin.totalPaid <= 0 || fin.balance <= 0) return;
        } else if (statusFilter === 'paid') {
          if (fin.balance > 0 || fin.agreedAmount <= 0) return;
        } else if (statusFilter === 'unpaid') {
          if (fin.totalPaid > 0) return;
        }
      }

      // 6. Search Query (Vendor ID, Company, Name, Phone, PAN, GST, Address, Work)
      if (query) {
        var matchId = (v.vendorId || v.id || '').toLowerCase().indexOf(query) > -1;
        var matchComp = (v.companyName || v.company || '').toLowerCase().indexOf(query) > -1;
        var matchName = (v.vendorName || v.name || '').toLowerCase().indexOf(query) > -1;
        var matchPhone = (v.phone || '').toLowerCase().indexOf(query) > -1;
        var matchPan = (v.pan || '').toLowerCase().indexOf(query) > -1;
        var matchGst = (v.gstNumber || '').toLowerCase().indexOf(query) > -1;
        var matchAddr = (v.address || '').toLowerCase().indexOf(query) > -1;
        var matchWork = (v.workDescription || v.workDesc || '').toLowerCase().indexOf(query) > -1;
        if (!matchId && !matchComp && !matchName && !matchPhone && !matchPan && !matchGst && !matchAddr && !matchWork) return;
      }

      fin.agStatus = agStatus;
      ledgerList.push(fin);
    });

    // Update Top Search Info
    if (infoEl) {
      var activeFilters = [];
      if (query) activeFilters.push('Search: "' + query + '"');
      if (df || dt) activeFilters.push('Date: ' + (df || '—') + ' to ' + (dt || '—'));
      if (vendorFilter) activeFilters.push('Vendor: ' + vendorFilter);
      if (agStatusFilter) activeFilters.push('Agreement: ' + agStatusFilter);
      if (statusFilter) activeFilters.push('Payment: ' + statusFilter);
      if (collegeFilter) activeFilters.push('College: ' + collegeFilter.toUpperCase());

      if (activeFilters.length > 0) {
        infoEl.textContent = 'Found ' + ledgerList.length + ' matching vendors (' + activeFilters.join(' • ') + ')';
      } else {
        infoEl.textContent = 'Showing all ' + ledgerList.length + ' registered vendors';
      }
    }

    // Update Summary Metric Cards
    var totalCountEl = document.getElementById('VLM_TOTAL_COUNT');
    var activeCountEl = document.getElementById('VLM_ACTIVE_COUNT');
    var totalAgreedEl = document.getElementById('VLM_TOTAL_AGREED');
    var totalPaidEl = document.getElementById('VLM_TOTAL_PAID');
    var totalVouchersEl = document.getElementById('VLM_TOTAL_VOUCHERS');
    var totalBalanceEl = document.getElementById('VLM_TOTAL_BALANCE');
    var paidPercentEl = document.getElementById('VLM_PAID_PERCENT');

    if (totalCountEl) totalCountEl.textContent = VENDORS.length;
    if (activeCountEl) activeCountEl.textContent = activeCount;
    if (totalAgreedEl) totalAgreedEl.textContent = formatCurrency(overallAgreed);
    if (totalPaidEl) totalPaidEl.textContent = formatCurrency(overallPaid);
    if (totalVouchersEl) totalVouchersEl.textContent = overallVouchers + ' Linked Debit Vouchers';
    
    var overallBal = overallAgreed - overallPaid;
    if (totalBalanceEl) totalBalanceEl.textContent = formatCurrency(overallBal);
    
    var overallPct = overallAgreed > 0 ? Math.round((overallPaid / overallAgreed) * 100) : 0;
    if (paidPercentEl) paidPercentEl.textContent = overallPct + '% Disbursed';

    if (ledgerList.length === 0) {
      tbody.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
      if (countEl) countEl.textContent = 'Showing 0 vendor ledgers';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    if (countEl) countEl.textContent = 'Showing ' + ledgerList.length + ' vendor ' + (ledgerList.length === 1 ? 'ledger' : 'ledgers');

    var html = '';
    ledgerList.forEach(function(fin) {
      var v = fin.vendor;
      var vid = v.vendorId || v.id;
      var collegeBadge = v.college === 'smwec' ?
        '<span style="font-size:10px;padding:2px 6px;border-radius:10px;background:#EDE9FE;color:#5B21B6;font-weight:600;">STMW</span>' :
        '<span style="font-size:10px;padding:2px 6px;border-radius:10px;background:#FEE2E2;color:#991B1B;font-weight:600;">SMGG</span>';

      var statusBadge = fin.status === 'paid' ?
        '<span class="badge-paid">✓ Fully Paid (100%)</span>' :
        (fin.status === 'partial' ? '<span class="badge-partial">⏳ ' + fin.paidPercent + '% Paid</span>' : '<span class="badge-unpaid">Pending Payment</span>');

      var pStart = typeof isoToDMY === 'function' ? (isoToDMY(v.periodStart || v.agreementDate) || '—') : (v.periodStart || v.agreementDate || '—');
      var pEnd = typeof isoToDMY === 'function' ? (isoToDMY(v.periodEnd) || '—') : (v.periodEnd || '—');

      var agSt = fin.agStatus || window.getAgreementAutomaticStatus(v);
      var agBadgeHtml = '<span class="' + agSt.badgeClass + '">' + agSt.icon + ' ' + agSt.label + (agSt.detail ? ' <span style="font-size:9.5px;opacity:0.9;">(' + agSt.detail + ')</span>' : '') + '</span>';

      html += '<tr style="cursor:pointer;" onclick="openVendorLedgerModal(\'' + vid + '\')">' +
        '<td>' +
          '<div style="display:flex;align-items:center;gap:6px;">' +
            '<span style="font-family:monospace;font-weight:800;color:#002D72;font-size:13px;">' + sanitize(vid) + '</span> ' + collegeBadge +
          '</div>' +
          '<div style="font-weight:700;color:#b91c1c;font-size:13px;margin-top:2px;">' + sanitize(v.companyName || v.company || '—') + '</div>' +
          '<div style="font-size:11px;color:var(--G600);">' + sanitize(v.vendorName || v.name || '—') + '</div>' +
        '</td>' +
        '<td>' +
          '<div style="font-size:12px;">📞 ' + sanitize(v.phone || '—') + '</div>' +
          '<div style="font-size:11px;font-family:monospace;color:var(--G600);margin-top:2px;">PAN: <b>' + sanitize(v.pan || '—') + '</b></div>' +
        '</td>' +
        '<td>' +
          '<div style="font-weight:700;color:#b91c1c;font-size:13.5px;">' + formatCurrency(fin.agreedAmount) + '</div>' +
          '<div style="font-size:10.5px;color:var(--G600);font-style:italic;">Agreed Contract</div>' +
        '</td>' +
        '<td>' +
          '<div style="font-weight:700;color:#15803d;font-size:13.5px;">' + formatCurrency(fin.totalPaid) + '</div>' +
          '<div style="font-size:10.5px;color:#0284c7;font-weight:600;">' + fin.vouchersCount + ' Debit ' + (fin.vouchersCount === 1 ? 'Voucher' : 'Vouchers') + '</div>' +
        '</td>' +
        '<td>' +
          '<div style="font-weight:700;color:' + (fin.balance <= 0 ? '#15803d' : '#b45309') + ';font-size:13.5px;">' + formatCurrency(fin.balance) + '</div>' +
          '<div style="margin-top:2px;">' + statusBadge + '</div>' +
        '</td>' +
        '<td>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:600;margin-bottom:3px;">' +
            '<span>' + fin.paidPercent + '%</span>' +
            '<span style="color:#64748b;">' + formatCurrency(fin.totalPaid) + ' / ' + formatCurrency(fin.agreedAmount) + '</span>' +
          '</div>' +
          '<div class="progress-track">' +
            '<div class="progress-fill" style="width:' + fin.paidPercent + '%;background:' + (fin.paidPercent >= 100 ? '#16a34a' : (fin.paidPercent > 0 ? '#0284c7' : '#e2e8f0')) + '"></div>' +
          '</div>' +
        '</td>' +
        '<td>' +
          '<div style="font-size:11.5px;font-weight:600;">' + pStart + '</div>' +
          '<div style="font-size:10.5px;color:var(--G600);">to ' + pEnd + '</div>' +
          '<div style="margin-top:4px;">' + agBadgeHtml + '</div>' +
        '</td>' +
        '<td onclick="event.stopPropagation()">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;min-width:180px;">' +
            '<button class="btn bp bsm" style="padding:4px 8px;font-size:11px;justify-content:center;" onclick="openVendorLedgerModal(\'' + vid + '\')" title="View Complete Ledger">📂 View Ledger</button>' +
            '<button class="btn bs bsm" style="padding:4px 8px;font-size:11px;justify-content:center;" onclick="previewVendorAgreement(\'' + vid + '\')" title="Print Agreement">🖨 Agreement</button>' +
            '<button class="btn bg bsm" style="padding:4px 8px;font-size:11px;justify-content:center;" onclick="createVoucherForVendor(\'' + vid + '\')" title="+ Debit Voucher">+ Voucher</button>' +
            '<button class="btn br bsm" style="padding:4px 8px;font-size:11px;justify-content:center;" onclick="deleteVendor(\'' + vid + '\')" title="Delete Vendor">🗑 Delete</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    });

    tbody.innerHTML = html;
  };

  // --- OPEN INTERACTIVE VENDOR LEDGER STATEMENT MODAL ---
  window.openVendorLedgerModal = function(vendorId) {
    var fin = window.getVendorFinancials(vendorId);
    if (!fin) {
      alert('Vendor ledger not found.');
      return;
    }

    activeLedgerVendorId = vendorId;
    var v = fin.vendor;

    var modal = document.getElementById('VENDOR_LEDGER_MODAL');
    if (!modal) return;

    var agSt = window.getAgreementAutomaticStatus(v);
    var modalAgBadge = '<span class="' + agSt.badgeClass + '" style="margin-left:4px;">' + agSt.icon + ' ' + agSt.label + (agSt.detail ? ' (' + agSt.detail + ')' : '') + '</span>';

    // Header info
    var titleEl = document.getElementById('VLM_HEAD_TITLE');
    var badgeEl = document.getElementById('VLM_HEAD_BADGE');
    var subEl = document.getElementById('VLM_HEAD_SUB');

    if (titleEl) titleEl.textContent = (v.companyName || v.company || 'Vendor') + ' — Ledger Statement';
    if (badgeEl) badgeEl.textContent = vendorId;
    if (subEl) subEl.innerHTML = 'Contact: <b>' + sanitize(v.vendorName || v.name || '—') + '</b> &bull; Phone: <b>' + sanitize(v.phone || '—') + '</b> &bull; PAN: <b>' + sanitize(v.pan || '—') + '</b> &bull; College: <b>' + (v.college ? v.college.toUpperCase() : 'SMGG') + '</b> &bull; ' + modalAgBadge;

    // Financial metrics ribbon
    var agreedEl = document.getElementById('VLM_DETAIL_AGREED');
    var wordsEl = document.getElementById('VLM_DETAIL_WORDS');
    var paidEl = document.getElementById('VLM_DETAIL_PAID');
    var countEl = document.getElementById('VLM_DETAIL_VOUCHER_COUNT');
    var balEl = document.getElementById('VLM_DETAIL_BALANCE');
    var pctEl = document.getElementById('VLM_DETAIL_PERCENT');

    if (agreedEl) agreedEl.textContent = formatCurrency(fin.agreedAmount);
    if (wordsEl) wordsEl.textContent = v.amountInWords || v.amtWords || 'Rupees Only';
    if (paidEl) paidEl.textContent = formatCurrency(fin.totalPaid);
    if (countEl) countEl.textContent = fin.vouchersCount + ' linked debit ' + (fin.vouchersCount === 1 ? 'voucher' : 'vouchers');
    if (balEl) balEl.textContent = formatCurrency(fin.balance);
    if (pctEl) pctEl.textContent = fin.paidPercent + '% Disbursed of Total Contract';

    // Tab 1: Render Linked Debit Vouchers
    var tabCount = document.getElementById('VLM_TAB_COUNT');
    if (tabCount) tabCount.textContent = fin.vouchersCount;

    var vtb = document.getElementById('VLM_VOUCHERS_TABLE_BODY');
    var vtf = document.getElementById('VLM_VOUCHERS_TABLE_FOOT');
    var vEmpty = document.getElementById('VLM_VOUCHERS_EMPTY');

    if (fin.vouchersCount === 0) {
      if (vtb) vtb.innerHTML = '';
      if (vtf) vtf.innerHTML = '';
      if (vEmpty) vEmpty.style.display = 'block';
    } else {
      if (vEmpty) vEmpty.style.display = 'none';
      var vHtml = '';
      fin.linkedVouchers.forEach(function(item) {
        var dmy = typeof isoToDMY === 'function' ? (isoToDMY(item.date) || item.date) : item.date;
        var modeRef = sanitize(item.mode || 'Cash') + (item.cheque ? ' (Ref: ' + sanitize(item.cheque) + ')' : '');

        vHtml += '<tr>' +
          '<td><span style="font-family:monospace;font-weight:700;color:#002D72;">' + sanitize(item.id || item.vno || '—') + '</span></td>' +
          '<td>' + dmy + '</td>' +
          '<td><span style="font-weight:600;color:var(--T);">' + sanitize(item.head || 'Debit') + '</span></td>' +
          '<td style="max-width:220px;font-size:12px;" title="' + sanitize(item.towards || '') + '">' + sanitize(item.towards || '—') + '</td>' +
          '<td>' + modeRef + '</td>' +
          '<td style="font-weight:700;color:#15803d;font-size:13px;">' + formatCurrency(item.amount) + '</td>' +
          '<td style="font-size:11.5px;color:var(--G600);">' + sanitize(item.by || 'admin1') + '</td>' +
          '<td>' +
            '<button type="button" class="btn bs bsm" style="padding:2px 7px;font-size:11px;" onclick="if(typeof printV===\'function\'){printV(\'' + (item.id || item.vno) + '\');}else if(typeof previewV===\'function\'){previewV(\'' + (item.id || item.vno) + '\');}" title="View / Print Voucher">🖨 View</button>' +
          '</td>' +
        '</tr>';
      });

      if (vtb) vtb.innerHTML = vHtml;

      if (vtf) {
        vtf.innerHTML =
          '<tr>' +
            '<td colspan="5" style="text-align:right;padding:8px 12px;font-size:12.5px;">TOTAL AMOUNT PAID VIA DEBIT VOUCHERS:</td>' +
            '<td style="padding:8px 10px;font-size:14px;color:#15803d;">' + formatCurrency(fin.totalPaid) + '</td>' +
            '<td colspan="2"></td>' +
          '</tr>' +
          '<tr>' +
            '<td colspan="5" style="text-align:right;padding:8px 12px;font-size:12.5px;">AGREED CONTRACT VALUE:</td>' +
            '<td style="padding:8px 10px;font-size:14px;color:#b91c1c;">' + formatCurrency(fin.agreedAmount) + '</td>' +
            '<td colspan="2"></td>' +
          '</tr>' +
          '<tr style="background:#eff6ff;">' +
            '<td colspan="5" style="text-align:right;padding:8px 12px;font-size:13px;font-weight:800;color:#002D72;">OUTSTANDING BALANCE PENDING:</td>' +
            '<td style="padding:8px 10px;font-size:15px;font-weight:800;color:' + (fin.balance <= 0 ? '#15803d' : '#b45309') + ';">' + formatCurrency(fin.balance) + '</td>' +
            '<td colspan="2"><span class="badge-' + (fin.status === 'paid' ? 'paid' : (fin.status === 'partial' ? 'partial' : 'unpaid')) + '">' + (fin.paidPercent + '% Paid') + '</span></td>' +
          '</tr>';
      }
    }

    // Tab 2: Render Vendor Agreement
    var agContainer = document.getElementById('VLM_AGREEMENT_CONTAINER');
    if (agContainer) {
      agContainer.innerHTML = buildAgreementDocumentHtml(v);
    }

    // Tab 3: Render Vendor Profile
    var profContainer = document.getElementById('VLM_PROFILE_CONTAINER');
    if (profContainer) {
      profContainer.innerHTML =
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">' +
          '<div style="background:#f8fafc;padding:14px;border-radius:8px;border:1px solid #e2e8f0;">' +
            '<h3 style="font-size:13px;font-weight:700;color:#002D72;margin-top:0;margin-bottom:10px;text-transform:uppercase;">🏢 Vendor &amp; Company Info</h3>' +
            '<p style="margin:4px 0;font-size:12.5px;"><b>Vendor ID:</b> <span style="font-family:monospace;font-weight:700;color:#002D72;">' + sanitize(v.vendorId) + '</span></p>' +
            '<p style="margin:4px 0;font-size:12.5px;"><b>Company Name:</b> <span style="color:#b91c1c;font-weight:700;">' + sanitize(v.companyName || v.company) + '</span></p>' +
            '<p style="margin:4px 0;font-size:12.5px;"><b>Contact Person:</b> ' + sanitize(v.vendorName || v.name) + '</p>' +
            '<p style="margin:4px 0;font-size:12.5px;"><b>Phone Number:</b> ' + sanitize(v.phone) + '</p>' +
            '<p style="margin:4px 0;font-size:12.5px;"><b>PAN Number:</b> <span style="font-family:monospace;font-weight:700;">' + sanitize(v.pan) + '</span></p>' +
            '<p style="margin:4px 0;font-size:12.5px;"><b>Email Address:</b> ' + sanitize(v.email || '—') + '</p>' +
            '<p style="margin:4px 0;font-size:12.5px;"><b>Address:</b> ' + sanitize(v.address || '—') + '</p>' +
          '</div>' +
          '<div style="background:#f8fafc;padding:14px;border-radius:8px;border:1px solid #e2e8f0;">' +
            '<h3 style="font-size:13px;font-weight:700;color:#002D72;margin-top:0;margin-bottom:10px;text-transform:uppercase;">🏛️ Authorization &amp; Banking</h3>' +
            '<p style="margin:4px 0;font-size:12.5px;"><b>GST Number:</b> <span style="font-family:monospace;">' + sanitize(v.gstNumber || '—') + '</span></p>' +
            '<p style="margin:4px 0;font-size:12.5px;"><b>Bank Details:</b> ' + sanitize(v.bankAccountDetails || '—') + '</p>' +
            '<p style="margin:4px 0;font-size:12.5px;"><b>Authorized By:</b> ' + sanitize(v.authBy || '—') + '</p>' +
            '<p style="margin:4px 0;font-size:12.5px;"><b>Designation:</b> ' + sanitize(v.authRole || '—') + '</p>' +
            '<p style="margin:4px 0;font-size:12.5px;"><b>Place:</b> ' + sanitize(v.authPlace || 'Chebrolu / Guntur') + '</p>' +
            '<p style="margin:4px 0;font-size:12.5px;"><b>Remarks:</b> ' + sanitize(v.remarks || '—') + '</p>' +
            '<p style="margin:4px 0;font-size:12.5px;"><b>Created Date:</b> ' + (v.createdAt ? v.createdAt.slice(0,10) : '—') + '</p>' +
          '</div>' +
        '</div>';
    }

    // Default to tab 1
    switchLedgerModalTab('vouchers');
    modal.classList.remove('h');
  };

  // Switch tabs inside Ledger modal
  window.switchLedgerModalTab = function(tabKey) {
    var tabs = ['vouchers', 'agreement', 'profile'];
    tabs.forEach(function(key) {
      var btn = document.getElementById('TAB_BTN_' + key.toUpperCase());
      var content = document.getElementById('TAB_CONTENT_' + key.toUpperCase());
      if (btn) btn.className = (key === tabKey) ? 'modal-tab-btn active' : 'modal-tab-btn';
      if (content) content.style.display = (key === tabKey) ? 'block' : 'none';
    });
  };
  window.switchVendorLedgerTab = window.switchLedgerModalTab;

  // Create Debit Voucher for active vendor
  window.createDebitForActiveVendor = function() {
    if (!activeLedgerVendorId) return;
    window.createVoucherForVendor(activeLedgerVendorId);
    var modal = document.getElementById('VENDOR_LEDGER_MODAL');
    if (modal) modal.classList.add('h');
  };

  // Dynamic Real-time Vendor Quick Info Banner on Debit Voucher Form
  window.onDebitPaidToChange = function(input) {
    var banner = document.getElementById('FD_VENDOR_INFO_BANNER');
    if (!banner) return;

    var val = (input ? input.value : (document.getElementById('fd_paidto') ? document.getElementById('fd_paidto').value : '')).trim();
    if (!val) {
      banner.style.display = 'none';
      banner.innerHTML = '';
      return;
    }

    var vid = window.resolveVendorIdForParty(val);
    if (!vid) {
      banner.style.display = 'none';
      banner.innerHTML = '';
      return;
    }

    var fin = window.getVendorFinancials(vid);
    if (!fin) {
      banner.style.display = 'none';
      banner.innerHTML = '';
      return;
    }

    var v = fin.vendor;
    var agSt = window.getAgreementAutomaticStatus(v);

    var amtVal = parseFloat(document.getElementById('fd_amt') ? document.getElementById('fd_amt').value : 0) || 0;
    var warnHtml = (amtVal > fin.balance && fin.balance > 0) ? 
      '<div style="color:#b91c1c;font-weight:700;font-size:11px;margin-top:3px;">⚠️ Note: Entered voucher amount (' + formatCurrency(amtVal) + ') exceeds remaining contract balance (' + formatCurrency(fin.balance) + ').</div>' : '';

    banner.innerHTML =
      '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:6px 10px;font-size:11.5px;color:#166534;box-shadow:0 1px 3px rgba(0,0,0,0.03);">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">' +
          '<div style="display:flex;align-items:center;gap:6px;">' +
            '<span>🏢 <b>' + sanitize(v.companyName || v.company) + '</b></span>' +
            '<span style="font-family:monospace;background:#002D72;color:#fff;padding:1px 6px;border-radius:3px;font-size:10.5px;font-weight:700;">' + vid + '</span>' +
            '<span class="' + agSt.badgeClass + '">' + agSt.icon + ' ' + agSt.label + '</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span>Contract: <b style="color:#b91c1c;">' + formatCurrency(fin.agreedAmount) + '</b></span>' +
            '<span>Paid: <b style="color:#0284c7;">' + formatCurrency(fin.totalPaid) + '</b></span>' +
            '<span>Balance: <b style="color:' + (fin.balance <= 0 ? '#15803d' : '#b45309') + ';">' + formatCurrency(fin.balance) + '</b></span>' +
            '<button type="button" class="btn bs bsm" style="padding:2px 6px;font-size:10.5px;" onclick="openVendorLedgerModal(\'' + vid + '\')">📂 Statement</button>' +
          '</div>' +
        '</div>' +
        warnHtml +
      '</div>';
    banner.style.display = 'block';
  };

  // Pre-fill Debit Voucher for given vendor ID
  window.createVoucherForVendor = function(vendorId) {
    var v = VENDORS.find(function(item) { return (item.vendorId === vendorId || item.id === vendorId); });
    if (!v) return;

    if (typeof show === 'function') show('create');
    if (typeof selVT === 'function') selVT(null, 'debit');

    var paidToEl = document.getElementById('fd_paidto');
    if (paidToEl) {
      paidToEl.value = (v.companyName || v.company || '');
      window.onDebitPaidToChange(paidToEl);
    }

    var towardsEl = document.getElementById('fd_towards');
    if (towardsEl && !towardsEl.value) {
      towardsEl.value = 'Payment towards ' + (v.workDescription || v.workDesc || 'contract agreement');
    }

    if (typeof _toast === 'function') {
      _toast('Selected Vendor ' + (v.vendorId || '') + ' (' + (v.companyName || v.company) + ') for Debit Voucher.', 'ok');
    }
  };

  // --- RENDER REGISTERED VENDORS TABLE (IN VENDOR FORM SECTION) ---
  window.renderVendorsTable = function() {
    var tbody = document.getElementById('VENDOR_TABLE_BODY');
    var emptyEl = document.getElementById('VENDOR_EMPTY_MSG');
    var countEl = document.getElementById('VENDOR_COUNT_MSG');
    if (!tbody) return;

    var query = (document.getElementById('VENDOR_SEARCH') ? document.getElementById('VENDOR_SEARCH').value : '').toLowerCase().trim();
    var collegeFilter = document.getElementById('VENDOR_FILTER_COLLEGE') ? document.getElementById('VENDOR_FILTER_COLLEGE').value : '';

    var currentCol = (window.CURRENT_COLLEGE || 'smgg').toLowerCase();

    var filtered = VENDORS.filter(function(v) {
      if (collegeFilter && v.college !== collegeFilter) return false;
      if (!collegeFilter && v.college && v.college !== currentCol && window.CU !== 'admin1') return false;

      if (query) {
        var matchId = (v.vendorId || v.id || '').toLowerCase().indexOf(query) > -1;
        var matchComp = (v.companyName || v.company || '').toLowerCase().indexOf(query) > -1;
        var matchName = (v.vendorName || v.name || '').toLowerCase().indexOf(query) > -1;
        var matchPhone = (v.phone || '').toLowerCase().indexOf(query) > -1;
        var matchPan = (v.pan || '').toLowerCase().indexOf(query) > -1;
        var matchDesc = (v.workDescription || v.workDesc || '').toLowerCase().indexOf(query) > -1;
        var matchGst = (v.gstNumber || '').toLowerCase().indexOf(query) > -1;
        if (!matchId && !matchComp && !matchName && !matchPhone && !matchPan && !matchDesc && !matchGst) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
      if (countEl) countEl.textContent = 'Showing 0 vendors';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    if (countEl) countEl.textContent = 'Showing ' + filtered.length + ' registered ' + (filtered.length === 1 ? 'vendor' : 'vendors');

    var html = '';
    filtered.forEach(function(v) {
      var files = (v.agreement && v.agreement.files) || v.files || [];
      var filesCount = Array.isArray(files) ? files.length : 0;
      var fileBadgesHtml = '';

      if (filesCount === 0) {
        fileBadgesHtml = '<span style="color:var(--G400);font-size:11px;">None</span>';
      } else {
        files.forEach(function(f, fIdx) {
          var isPdf = f.type && f.type.indexOf('pdf') > -1;
          var label = isPdf ? '📄 Doc ' + (fIdx + 1) : '📎 File ' + (fIdx + 1);
          fileBadgesHtml += '<button type="button" class="file-badge-pill" onclick="viewSavedVendorFile(\'' + (v.vendorId || v.id) + '\',' + fIdx + ')" title="' + sanitize(f.name) + ' (' + formatFileSize(f.size) + ')">' + label + '</button> ';
        });
      }

      var collegeBadge = v.college === 'smwec' ?
        '<span style="font-size:10px;padding:2px 6px;border-radius:10px;background:#EDE9FE;color:#5B21B6;font-weight:600;">STMW</span>' :
        '<span style="font-size:10px;padding:2px 6px;border-radius:10px;background:#FEE2E2;color:#991B1B;font-weight:600;">SMGG</span>';

      var vid = v.vendorId || v.id || '—';
      var agDate = v.periodStart || (v.agreement && v.agreement.periodStart) || v.agreementDate || '—';
      var formattedDate = typeof isoToDMY === 'function' ? isoToDMY(agDate) : agDate;
      var agSt = window.getAgreementAutomaticStatus(v);
      var agBadgeHtml = '<span class="' + agSt.badgeClass + '">' + agSt.icon + ' ' + agSt.label + (agSt.detail ? ' <span style="font-size:9.5px;opacity:0.9;">(' + agSt.detail + ')</span>' : '') + '</span>';

      html += '<tr>' +
        '<td>' +
          '<div style="font-family:monospace;font-weight:700;color:#002D72;font-size:12.5px;">' + sanitize(vid) + ' ' + collegeBadge + '</div>' +
          '<div style="font-weight:700;color:#b91c1c;font-size:13px;margin-top:2px;">' + sanitize(v.companyName || v.company || '—') + '</div>' +
          '<div style="font-size:11px;color:var(--G600);">' + sanitize(v.vendorName || v.name || '—') + '</div>' +
        '</td>' +
        '<td>' +
          '<div style="font-size:12px;font-weight:500;">📞 ' + sanitize(v.phone || '—') + '</div>' +
          '<div style="font-size:11px;color:var(--G600);font-family:monospace;">PAN: <b>' + sanitize(v.pan || '—') + '</b></div>' +
          (v.email ? '<div style="font-size:10.5px;color:#0284c7;">✉️ ' + sanitize(v.email) + '</div>' : '') +
        '</td>' +
        '<td>' +
          '<div style="font-weight:700;color:#b91c1c;font-size:13.5px;">' + formatCurrency(v.agreedAmount || v.amount) + '</div>' +
          '<div style="font-size:10px;color:var(--G600);max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + sanitize(v.amountInWords || v.amtWords) + '">' + sanitize(v.amountInWords || v.amtWords || '') + '</div>' +
        '</td>' +
        '<td>' +
          '<div style="font-size:11.5px;line-height:1.4;max-width:200px;" title="' + sanitize(v.workDescription || v.workDesc) + '">' +
            sanitize((v.workDescription || v.workDesc) ? ((v.workDescription || v.workDesc).length > 70 ? (v.workDescription || v.workDesc).substring(0, 70) + '…' : (v.workDescription || v.workDesc)) : '—') +
          '</div>' +
        '</td>' +
        '<td>' +
          '<div style="font-size:12px;font-weight:600;color:var(--T);">' + formattedDate + '</div>' +
          '<div style="font-size:10.5px;color:var(--G600);font-family:monospace;">' + sanitize((v.agreement && v.agreement.agreementNo) || ('AGR-' + vid)) + '</div>' +
          '<div style="margin-top:3px;">' + agBadgeHtml + '</div>' +
        '</td>' +
        '<td>' + fileBadgesHtml + '</td>' +
        '<td>' +
          '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
            '<button class="btn bp bsm" style="padding:4px 8px;font-size:11px;" onclick="openVendorLedgerModal(\'' + vid + '\')" title="View Ledger">📂 Ledger</button>' +
            '<button class="btn bs bsm" style="padding:4px 8px;font-size:11px;" onclick="previewVendorAgreement(\'' + vid + '\')" title="Print Agreement">🖨 Agreement</button>' +
            '<button class="btn bs bsm" style="padding:4px 8px;font-size:11px;" onclick="editVendor(\'' + vid + '\')" title="Edit Vendor">✏️ Edit</button>' +
            '<button class="btn bd bsm" style="padding:4px 8px;font-size:11px;" onclick="deleteVendor(\'' + vid + '\')" title="Delete Vendor">🗑</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    });

    tbody.innerHTML = html;
  };

  // --- BUILD HTML FOR VENDOR AGREEMENT DOCUMENT (EXACT MATCH TO UPLOADED IMAGE) ---
  function buildAgreementDocumentHtml(v) {
    if (!v) return '';

    var files = (v.agreement && v.agreement.files) || v.files || [];
    var filesHtml = '';
    if (files.length > 0) {
      filesHtml = '<div style="margin-top:8px;font-size:11px;color:#475569;background:#f8fafc;padding:5px 8px;border-radius:4px;border:1px solid #e2e8f0;">' +
        '<b>Attached Agreement Documents (' + files.length + ' files):</b> ' +
        files.map(function(f, idx){ return (idx+1) + '. ' + sanitize(f.name) + ' (' + formatFileSize(f.size) + ')'; }).join(' &bull; ') +
      '</div>';
    }

    var pStartFormatted = typeof isoToDMY === 'function' ? (isoToDMY(v.periodStart || v.agreementDate) || '—') : (v.periodStart || v.agreementDate || '—');
    var pEndFormatted = typeof isoToDMY === 'function' ? (isoToDMY(v.periodEnd) || '—') : (v.periodEnd || '—');

    var collegeName = (v.college === 'smwec')
      ? "ST. MARY'S WOMEN'S ENGINEERING COLLEGE, BUDAMPADU"
      : "St. Mary's Group of Institutions, Guntur for Women";

    var companyUpper = (v.companyName || v.company || 'GOPI SUPPLIERS').toUpperCase();
    var vendorNameVal = v.vendorName || v.name || 'G. Gopi';
    var wordsVal = v.amountInWords || v.amtWords || 'Rupees Only';
    if (wordsVal && wordsVal.indexOf('(') === -1) wordsVal = '(' + wordsVal + ')';

    var fin = window.getVendorFinancials(v.vendorId || v.id) || {
      agreedAmount: parseFloat(v.agreedAmount || v.amount) || 0,
      totalPaid: 0,
      balance: parseFloat(v.agreedAmount || v.amount) || 0,
      vouchersCount: 0,
      paidPercent: 0
    };

    var financialRowsHtml = '';
    if (fin && fin.totalPaid > 0) {
      financialRowsHtml =
        '<tr style="background:#eff6ff;">' +
          '<td style="padding:4px 8px;border:1px solid #cbd5e1;font-weight:700;color:#1e293b;">Vendor Amount (Agreed)</td>' +
          '<td style="padding:4px 3px;border:1px solid #cbd5e1;text-align:center;font-weight:bold;">:</td>' +
          '<td style="padding:4px 8px;border:1px solid #cbd5e1;">' +
            '<span style="font-weight:700;color:#b91c1c;font-size:12px;margin-right:6px;">' + formatCurrency(fin.agreedAmount) + '</span>' +
            '<span style="font-size:10.5px;color:#334155;font-weight:500;">' + sanitize(wordsVal) + '</span>' +
          '</td>' +
        '</tr>' +
        '<tr style="background:#f0fdf4;">' +
          '<td style="padding:4px 8px;border:1px solid #cbd5e1;font-weight:700;color:#166534;">Part Payments Disbursed</td>' +
          '<td style="padding:4px 3px;border:1px solid #cbd5e1;text-align:center;font-weight:bold;">:</td>' +
          '<td style="padding:4px 8px;border:1px solid #cbd5e1;">' +
            '<span style="font-weight:700;color:#15803d;font-size:12px;margin-right:6px;">' + formatCurrency(fin.totalPaid) + '</span>' +
            '<span style="font-size:10.5px;color:#166534;font-weight:600;">(' + fin.vouchersCount + ' Debit ' + (fin.vouchersCount === 1 ? 'Voucher' : 'Vouchers') + ' Paid &bull; ' + fin.paidPercent + '% Complete)</span>' +
          '</td>' +
        '</tr>' +
        '<tr style="background:#fffbeb;">' +
          '<td style="padding:4px 8px;border:1px solid #cbd5e1;font-weight:700;color:#92400e;">Net Balance Outstanding</td>' +
          '<td style="padding:4px 3px;border:1px solid #cbd5e1;text-align:center;font-weight:bold;">:</td>' +
          '<td style="padding:4px 8px;border:1px solid #cbd5e1;">' +
            '<span style="font-weight:800;color:' + (fin.balance <= 0 ? '#15803d' : '#b45309') + ';font-size:12px;margin-right:6px;">' + formatCurrency(fin.balance) + '</span>' +
            '<span style="font-size:10.5px;color:#78350f;font-weight:600;">(' + (fin.balance <= 0 ? '✓ Contract Fully Settled' : 'Pending Remaining Payment') + ')</span>' +
          '</td>' +
        '</tr>';
    } else {
      financialRowsHtml =
        '<tr style="background:#eff6ff;">' +
          '<td style="padding:4px 8px;border:1px solid #cbd5e1;font-weight:700;color:#1e293b;">Vendor Amount (Agreed)</td>' +
          '<td style="padding:4px 3px;border:1px solid #cbd5e1;text-align:center;font-weight:bold;">:</td>' +
          '<td style="padding:4px 8px;border:1px solid #cbd5e1;">' +
            '<span style="font-weight:700;color:#b91c1c;font-size:12px;margin-right:6px;">' + formatCurrency(v.agreedAmount || v.amount) + '</span>' +
            '<span style="font-size:10.5px;color:#334155;font-weight:500;">' + sanitize(wordsVal) + '</span>' +
          '</td>' +
        '</tr>';
    }

    return '<div class="vendor-agreement-sheet" style="background:#fff;padding:18px 24px;color:#111;font-family:\'Inter\',sans-serif;line-height:1.35;max-width:760px;margin:0 auto;border:1.5px solid #cbd5e1;box-shadow:0 2px 10px rgba(0,0,0,0.06);box-sizing:border-box;page-break-inside:avoid;page-break-after:avoid;">' +
      '<!-- Main Title Header -->' +
      '<div style="text-align:center;margin-bottom:12px;">' +
        '<div style="font-family:\'Inter\',sans-serif;font-size:14.5px;font-weight:800;color:#002D72;letter-spacing:0.5px;text-transform:uppercase;margin:0 0 3px 0;">' + sanitize(collegeName) + '</div>' +
        '<h1 style="font-family:\'Inter\',sans-serif;font-size:17px;font-weight:800;color:#b91c1c;text-decoration:underline;letter-spacing:0.8px;margin:0 0 4px 0;">VENDOR AGREEMENT</h1>' +
        '<p style="font-size:11px;color:#333;margin:0;line-height:1.3;">This Vendor Agreement is made between the concerned party/organization and the following vendor:</p>' +
      '</div>' +

      '<!-- 1. VENDOR DETAILS -->' +
      '<div style="margin-bottom:10px;">' +
        '<div style="display:inline-block;background:#002D72;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:4px;">1. VENDOR DETAILS</div>' +
        '<table style="width:100%;border-collapse:collapse;border:1.5px solid #94a3b8;font-size:11px;">' +
          '<tr>' +
            '<td style="padding:4px 8px;border:1px solid #cbd5e1;font-weight:600;width:28%;color:#1e293b;">Vendor Company Name</td>' +
            '<td style="padding:4px 3px;border:1px solid #cbd5e1;text-align:center;width:3%;font-weight:bold;">:</td>' +
            '<td style="padding:4px 8px;border:1px solid #cbd5e1;font-weight:700;color:#b91c1c;text-transform:uppercase;">' + sanitize(companyUpper) + '</td>' +
          '</tr>' +
          '<tr>' +
            '<td style="padding:4px 8px;border:1px solid #cbd5e1;font-weight:600;color:#1e293b;">Vendor Name</td>' +
            '<td style="padding:4px 3px;border:1px solid #cbd5e1;text-align:center;font-weight:bold;">:</td>' +
            '<td style="padding:4px 8px;border:1px solid #cbd5e1;font-weight:600;color:#b91c1c;">' + sanitize(vendorNameVal) + '</td>' +
          '</tr>' +
          '<tr>' +
            '<td style="padding:4px 8px;border:1px solid #cbd5e1;font-weight:600;color:#1e293b;">Vendor Phone Number</td>' +
            '<td style="padding:4px 3px;border:1px solid #cbd5e1;text-align:center;font-weight:bold;">:</td>' +
            '<td style="padding:4px 8px;border:1px solid #cbd5e1;">' + sanitize(v.phone || '—') + '</td>' +
          '</tr>' +
          '<tr>' +
            '<td style="padding:4px 8px;border:1px solid #cbd5e1;font-weight:600;color:#1e293b;">Vendor PAN Number</td>' +
            '<td style="padding:4px 3px;border:1px solid #cbd5e1;text-align:center;font-weight:bold;">:</td>' +
            '<td style="padding:4px 8px;border:1px solid #cbd5e1;font-family:monospace;font-weight:700;">' + sanitize(v.pan || '—') + '</td>' +
          '</tr>' +
          '<tr>' +
            '<td style="padding:4px 8px;border:1px solid #cbd5e1;font-weight:600;color:#1e293b;">Vendor Address</td>' +
            '<td style="padding:4px 3px;border:1px solid #cbd5e1;text-align:center;font-weight:bold;">:</td>' +
            '<td style="padding:4px 8px;border:1px solid #cbd5e1;line-height:1.3;">' + sanitize(v.address || 'Narakoduru (V), Chebrole (M), Guntur (Dt), Andhra Pradesh – 522212') + '</td>' +
          '</tr>' +
          '<tr>' +
            '<td style="padding:4px 8px;border:1px solid #cbd5e1;font-weight:600;color:#1e293b;">Work Description</td>' +
            '<td style="padding:4px 3px;border:1px solid #cbd5e1;text-align:center;font-weight:bold;">:</td>' +
            '<td style="padding:4px 8px;border:1px solid #cbd5e1;line-height:1.35;white-space:pre-wrap;">' + sanitize(v.workDescription || v.workDesc || '—') + '</td>' +
          '</tr>' +
          financialRowsHtml +
        '</table>' +
        filesHtml +
      '</div>' +

      '<!-- 2. AGREEMENT PERIOD & 3. AUTHORIZATION -->' +
      '<div style="display:grid;grid-template-columns:1fr 1.2fr;gap:12px;margin-bottom:10px;align-items:start;">' +
        '<div>' +
          '<div style="display:inline-block;background:#002D72;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:4px;">2. AGREEMENT PERIOD</div>' +
          '<table style="width:100%;border-collapse:collapse;border:1px solid #94a3b8;font-size:11px;">' +
            '<tr>' +
              '<td style="padding:3px 6px;border:1px solid #cbd5e1;font-weight:600;width:35%;">Start Date</td>' +
              '<td style="padding:3px 3px;border:1px solid #cbd5e1;text-align:center;width:6%;">:</td>' +
              '<td style="padding:3px 6px;border:1px solid #cbd5e1;font-weight:500;">' + pStartFormatted + '</td>' +
            '</tr>' +
            '<tr>' +
              '<td style="padding:3px 6px;border:1px solid #cbd5e1;font-weight:600;">End Date</td>' +
              '<td style="padding:3px 3px;border:1px solid #cbd5e1;text-align:center;">:</td>' +
              '<td style="padding:3px 6px;border:1px solid #cbd5e1;font-weight:500;">' + pEndFormatted + '</td>' +
            '</tr>' +
          '</table>' +
        '</div>' +
        '<div>' +
          '<div style="display:inline-block;background:#002D72;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:4px;">3. AUTHORIZATION</div>' +
          '<p style="font-size:10.5px;color:#222;line-height:1.35;margin:0;">' +
            'By signing below, both parties acknowledge and agree to the terms and conditions stated in this Vendor Agreement.' +
          '</p>' +
        '</div>' +
      '</div>' +

      '<!-- Signatures Box -->' +
      '<div style="border:1.5px solid #94a3b8;border-radius:4px;overflow:hidden;margin-bottom:8px;font-size:11px;">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;">' +
          '<!-- FOR THE ORGANIZATION -->' +
          '<div style="padding:8px 12px;border-right:1px solid #cbd5e1;">' +
            '<div style="font-weight:700;color:#002D72;text-align:center;margin-bottom:6px;font-size:11px;letter-spacing:0.5px;">FOR THE ORGANIZATION</div>' +
            '<div style="margin-bottom:5px;color:#1e293b;"><b>Authorized Signatory</b></div>' +
            '<div style="margin-bottom:5px;display:flex;align-items:center;">' +
              '<span style="width:85px;color:#475569;">Name:</span>' +
              '<span style="border-bottom:1px solid #94a3b8;flex:1;min-height:16px;padding-bottom:1px;font-weight:600;">' + (v.authBy ? sanitize(v.authBy) : '&nbsp;') + '</span>' +
            '</div>' +
            '<div style="margin-bottom:5px;display:flex;align-items:center;">' +
              '<span style="width:85px;color:#475569;">Designation:</span>' +
              '<span style="border-bottom:1px solid #94a3b8;flex:1;min-height:16px;padding-bottom:1px;">' + (v.authRole ? sanitize(v.authRole) : '&nbsp;') + '</span>' +
            '</div>' +
            '<div style="margin-bottom:5px;display:flex;align-items:center;">' +
              '<span style="width:85px;color:#475569;">Signature:</span>' +
              '<span style="border-bottom:1px solid #94a3b8;flex:1;height:16px;display:inline-block;"></span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;">' +
              '<span style="width:85px;color:#475569;">Date:</span>' +
              '<span style="border-bottom:1px solid #94a3b8;flex:1;padding-bottom:1px;">' + pStartFormatted + '</span>' +
            '</div>' +
          '</div>' +

          '<!-- FOR VENDOR -->' +
          '<div style="padding:8px 12px;">' +
            '<div style="font-weight:700;color:#b91c1c;text-align:center;margin-bottom:6px;font-size:11px;letter-spacing:0.5px;text-transform:uppercase;">FOR ' + sanitize(companyUpper) + '</div>' +
            '<div style="margin-bottom:5px;display:flex;align-items:center;">' +
              '<span style="width:75px;color:#475569;">Vendor:</span>' +
              '<span style="font-weight:700;color:#b91c1c;">' + sanitize(vendorNameVal) + '</span>' +
            '</div>' +
            '<div style="margin-bottom:5px;display:flex;align-items:center;">' +
              '<span style="width:75px;color:#475569;">Signature:</span>' +
              '<span style="border-bottom:1px solid #94a3b8;flex:1;height:16px;display:inline-block;"></span>' +
            '</div>' +
            '<div style="margin-bottom:5px;display:flex;align-items:center;">' +
              '<span style="width:75px;color:#475569;">Date:</span>' +
              '<span style="border-bottom:1px solid #94a3b8;flex:1;padding-bottom:1px;">' + pStartFormatted + '</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;">' +
              '<span style="width:75px;color:#475569;">Seal:</span>' +
              '<span style="border-bottom:1px solid #94a3b8;flex:1;height:16px;display:inline-block;"></span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<!-- Footer Date and Place -->' +
      '<div style="display:flex;justify-content:space-between;font-size:11px;color:#334155;padding:2px 4px 0 4px;">' +
        '<div>Date: <span style="border-bottom:1px solid #94a3b8;display:inline-block;min-width:140px;padding:0 4px;">' + pStartFormatted + '</span></div>' +
        '<div>Place: <span style="border-bottom:1px solid #94a3b8;display:inline-block;min-width:140px;padding:0 4px;">' + sanitize(v.authPlace || 'Chebrolu / Guntur') + '</span></div>' +
      '</div>' +
    '</div>';
  }

  // --- PREVIEW / PRINT VENDOR AGREEMENT MODAL ---
  window.previewVendorAgreement = function(id) {
    var v = null;
    if (id) {
      v = VENDORS.find(function(item) { return (item.vendorId === id || item.id === id); });
    } else {
      // Preview from currently active form inputs
      var company = (document.getElementById('f_v_company').value || '').trim() || 'GOPI SUPPLIERS';
      var name = (document.getElementById('f_v_name').value || '').trim() || 'G. Gopi';
      var phone = (document.getElementById('f_v_phone').value || '').trim() || '8883822641';
      var pan = (document.getElementById('f_v_pan').value || '').trim().toUpperCase() || 'DFZPG5768A';
      var address = (document.getElementById('f_v_address') ? document.getElementById('f_v_address').value : '').trim() || 'Narakoduru (V), Chebrole (M), Guntur (Dt), Andhra Pradesh – 522212';
      var amount = parseFloat(document.getElementById('f_v_amount').value) || 500000;
      var words = (document.getElementById('f_v_words').value || '').trim() || (typeof numToWords === 'function' ? numToWords(amount) : 'Rupees Five Lakh Only');
      var workDesc = (document.getElementById('f_v_work_desc').value || '').trim() || 'Civil repair work, masonry materials, tile fixing and painting support for engineering lab block.';
      var periodStart = (document.getElementById('f_v_period_start') ? document.getElementById('f_v_period_start').value : '') || new Date().toISOString().slice(0,10);
      var periodEnd = (document.getElementById('f_v_period_end') ? document.getElementById('f_v_period_end').value : '') || '';
      var vid = (document.getElementById('f_v_id') ? document.getElementById('f_v_id').value : '') || getNextVendorId();

      var authBy = (document.getElementById('f_v_auth_by') ? document.getElementById('f_v_auth_by').value : '').trim();
      var authRole = (document.getElementById('f_v_auth_role') ? document.getElementById('f_v_auth_role').value : '').trim();
      var authPlace = (document.getElementById('f_v_auth_place') ? document.getElementById('f_v_auth_place').value : '').trim() || 'Chebrolu / Guntur';

      v = {
        vendorId: vid,
        companyName: company,
        vendorName: name,
        phone: phone,
        pan: pan,
        address: address,
        agreedAmount: amount,
        amountInWords: words,
        workDescription: workDesc,
        periodStart: periodStart,
        periodEnd: periodEnd,
        agreementDate: periodStart,
        agreement: {
          agreementNo: 'AGR-' + vid + '-' + periodStart.slice(0,4),
          files: currentVendorFiles.filter(function(x){return x!==null;})
        },
        authBy: authBy,
        authRole: authRole,
        authPlace: authPlace,
        gstNumber: document.getElementById('f_v_gst') ? document.getElementById('f_v_gst').value : '',
        bankAccountDetails: document.getElementById('f_v_bank') ? document.getElementById('f_v_bank').value : '',
        remarks: document.getElementById('f_v_remarks') ? document.getElementById('f_v_remarks').value : '',
        college: document.getElementById('f_v_college') ? document.getElementById('f_v_college').value : 'smgg'
      };
    }

    if (!v) {
      alert('Vendor details not found.');
      return;
    }

    var modal = document.getElementById('PM');
    if (!modal) return;

    var pa = document.getElementById('PA');
    var pmt = document.getElementById('PMT');
    if (pmt) pmt.textContent = 'Vendor Agreement Document';

    if (pa) pa.innerHTML = buildAgreementDocumentHtml(v);
    modal.classList.remove('h');
    if (typeof updatePrintInfo === 'function') updatePrintInfo();
  };

  window.printActiveVendorAgreement = function() {
    if (!activeLedgerVendorId) return;
    previewVendorAgreement(activeLedgerVendorId);
  };

  // --- PRINT COMPLETE VENDOR LEDGER STATEMENT ---
  window.printActiveVendorLedger = function() {
    if (!activeLedgerVendorId) return;
    var fin = window.getVendorFinancials(activeLedgerVendorId);
    if (!fin) return;
    var v = fin.vendor;

    var modal = document.getElementById('PM');
    if (!modal) return;

    var pa = document.getElementById('PA');
    var pmt = document.getElementById('PMT');
    if (pmt) pmt.textContent = 'Vendor Ledger Statement';

    var collegeTitle = v.college === 'smwec' ?
      "ST. MARY'S WOMEN'S ENGINEERING COLLEGE, BUDAMPADU" :
      "ST. MARY'S GROUP OF INSTITUTIONS GUNTUR (CHEBROLU)";

    var pStart = typeof isoToDMY === 'function' ? (isoToDMY(v.periodStart || v.agreementDate) || '—') : (v.periodStart || v.agreementDate || '—');
    var pEnd = typeof isoToDMY === 'function' ? (isoToDMY(v.periodEnd) || '—') : (v.periodEnd || '—');

    var rowsHtml = '';
    fin.linkedVouchers.forEach(function(item, idx) {
      var dmy = typeof isoToDMY === 'function' ? (isoToDMY(item.date) || item.date) : item.date;
      var modeRef = sanitize(item.mode || 'Cash') + (item.cheque ? ' (Ref: ' + sanitize(item.cheque) + ')' : '');

      rowsHtml += '<tr>' +
        '<td style="padding:6px;border:1px solid #cbd5e1;text-align:center;">' + (idx + 1) + '</td>' +
        '<td style="padding:6px;border:1px solid #cbd5e1;font-family:monospace;font-weight:700;">' + sanitize(item.id || item.vno || '—') + '</td>' +
        '<td style="padding:6px;border:1px solid #cbd5e1;">' + dmy + '</td>' +
        '<td style="padding:6px;border:1px solid #cbd5e1;">' + sanitize(item.head || 'Debit') + '</td>' +
        '<td style="padding:6px;border:1px solid #cbd5e1;">' + sanitize(item.towards || '—') + '</td>' +
        '<td style="padding:6px;border:1px solid #cbd5e1;">' + modeRef + '</td>' +
        '<td style="padding:6px;border:1px solid #cbd5e1;text-align:right;font-weight:700;color:#15803d;">' + formatCurrency(item.amount) + '</td>' +
      '</tr>';
    });

    var html =
      '<div class="vendor-ledger-sheet" style="background:#fff;padding:24px 28px;color:#111;font-family:\'Inter\',sans-serif;line-height:1.4;max-width:760px;margin:0 auto;border:1.5px solid #cbd5e1;box-sizing:border-box;">' +
        '<div style="text-align:center;border-bottom:2px solid #002D72;padding-bottom:10px;margin-bottom:14px;">' +
          '<h2 style="margin:0;font-size:15px;color:#002D72;font-weight:800;">' + collegeTitle + '</h2>' +
          '<h1 style="margin:4px 0 0 0;font-size:18px;color:#b91c1c;font-weight:800;letter-spacing:0.8px;">VENDOR LEDGER ACCOUNT STATEMENT</h1>' +
          '<p style="margin:2px 0 0 0;font-size:11.5px;color:#64748b;">Statement of Contract Disbursements &amp; Debit Vouchers</p>' +
        '</div>' +

        '<div style="display:grid;grid-template-columns:1.2fr 1fr;gap:12px;margin-bottom:14px;font-size:12px;background:#f8fafc;padding:12px;border-radius:6px;border:1px solid #e2e8f0;">' +
          '<div>' +
            '<p style="margin:2px 0;"><b>Vendor ID:</b> <span style="font-family:monospace;font-weight:800;color:#002D72;">' + sanitize(v.vendorId) + '</span></p>' +
            '<p style="margin:2px 0;"><b>Vendor / Company:</b> <span style="font-weight:700;color:#b91c1c;">' + sanitize(v.companyName || v.company) + '</span></p>' +
            '<p style="margin:2px 0;"><b>Contact Person:</b> ' + sanitize(v.vendorName || v.name) + ' (' + sanitize(v.phone) + ')</p>' +
            '<p style="margin:2px 0;"><b>PAN Number:</b> <span style="font-family:monospace;font-weight:700;">' + sanitize(v.pan) + '</span></p>' +
          '</div>' +
          '<div>' +
            '<p style="margin:2px 0;"><b>Agreement No:</b> <span style="font-family:monospace;">' + sanitize((v.agreement && v.agreement.agreementNo) || ('AGR-' + v.vendorId)) + '</span></p>' +
            '<p style="margin:2px 0;"><b>Contract Period:</b> ' + pStart + ' to ' + pEnd + '</p>' +
            '<p style="margin:2px 0;"><b>Agreed Contract Value:</b> <span style="font-weight:700;color:#b91c1c;">' + formatCurrency(fin.agreedAmount) + '</span></p>' +
            '<p style="margin:2px 0;"><b>Total Paid to Date:</b> <span style="font-weight:700;color:#15803d;">' + formatCurrency(fin.totalPaid) + ' (' + fin.paidPercent + '%)</span></p>' +
          '</div>' +
        '</div>' +

        '<h3 style="font-size:12.5px;font-weight:700;color:#002D72;margin-bottom:6px;text-transform:uppercase;">Itemized Debit Voucher Transactions</h3>' +
        '<table style="width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:16px;">' +
          '<thead>' +
            '<tr style="background:#002D72;color:#fff;">' +
              '<th style="padding:5px 6px;border:1px solid #002D72;width:35px;">#</th>' +
              '<th style="padding:5px 6px;border:1px solid #002D72;">Voucher No</th>' +
              '<th style="padding:5px 6px;border:1px solid #002D72;">Date</th>' +
              '<th style="padding:5px 6px;border:1px solid #002D72;">Debit Head</th>' +
              '<th style="padding:5px 6px;border:1px solid #002D72;">Towards / Purpose</th>' +
              '<th style="padding:5px 6px;border:1px solid #002D72;">Payment Mode</th>' +
              '<th style="padding:5px 6px;border:1px solid #002D72;text-align:right;">Amount (Rs.)</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' +
            (rowsHtml || '<tr><td colspan="7" style="text-align:center;padding:16px;color:#888;">No debit vouchers recorded yet.</td></tr>') +
          '</tbody>' +
          '<tfoot>' +
            '<tr>' +
              '<td colspan="6" style="text-align:right;padding:5px 8px;font-weight:700;border:1px solid #cbd5e1;">TOTAL AMOUNT DISBURSED:</td>' +
              '<td style="padding:5px 8px;text-align:right;font-weight:800;color:#15803d;border:1px solid #cbd5e1;">' + formatCurrency(fin.totalPaid) + '</td>' +
            '</tr>' +
            '<tr>' +
              '<td colspan="6" style="text-align:right;padding:5px 8px;font-weight:700;border:1px solid #cbd5e1;">AGREED CONTRACT AMOUNT:</td>' +
              '<td style="padding:5px 8px;text-align:right;font-weight:800;color:#b91c1c;border:1px solid #cbd5e1;">' + formatCurrency(fin.agreedAmount) + '</td>' +
            '</tr>' +
            '<tr style="background:#eff6ff;">' +
              '<td colspan="6" style="text-align:right;padding:6px 8px;font-weight:800;color:#002D72;border:1.5px solid #93c5fd;">OUTSTANDING BALANCE PENDING:</td>' +
              '<td style="padding:6px 8px;text-align:right;font-weight:800;font-size:13px;color:' + (fin.balance <= 0 ? '#15803d' : '#b45309') + ';border:1.5px solid #93c5fd;">' + formatCurrency(fin.balance) + '</td>' +
            '</tr>' +
          '</tfoot>' +
        '</table>' +

        '<div style="display:flex;justify-content:space-between;margin-top:35px;padding:0 20px;font-size:11.5px;">' +
          '<div style="text-align:center;"><div style="border-top:1px solid #333;width:180px;padding-top:4px;">Authorized Signatory / AO</div></div>' +
          '<div style="text-align:center;"><div style="border-top:1px solid #333;width:180px;padding-top:4px;">Principal / Management</div></div>' +
        '</div>' +
      '</div>';

    if (pa) pa.innerHTML = html;
    modal.classList.remove('h');
    if (typeof updatePrintInfo === 'function') updatePrintInfo();
  };

  // --- EXPORT ACTIVE VENDOR LEDGER TO EXCEL ---
  window.exportActiveVendorLedgerExcel = function() {
    if (!activeLedgerVendorId) return;
    var fin = window.getVendorFinancials(activeLedgerVendorId);
    if (!fin) return;
    var v = fin.vendor;

    if (typeof XLSX === 'undefined') {
      alert('SheetJS (XLSX) library not loaded.');
      return;
    }

    var rows = fin.linkedVouchers.map(function(item, idx) {
      return {
        'S.No': idx + 1,
        'Voucher No': item.id || item.vno || '',
        'Date': item.date || '',
        'Debit Head': item.head || '',
        'Towards / Purpose': item.towards || '',
        'Payment Mode': item.mode || '',
        'Cheque / Ref No': item.cheque || '',
        'Amount Paid (Rs)': parseFloat(item.amount) || 0,
        'Entered By': item.by || ''
      };
    });

    // Add summary rows
    rows.push({});
    rows.push({
      'Towards / Purpose': 'TOTAL AMOUNT PAID:',
      'Amount Paid (Rs)': fin.totalPaid
    });
    rows.push({
      'Towards / Purpose': 'AGREED CONTRACT VALUE:',
      'Amount Paid (Rs)': fin.agreedAmount
    });
    rows.push({
      'Towards / Purpose': 'OUTSTANDING BALANCE REMAINING:',
      'Amount Paid (Rs)': fin.balance
    });

    var ws = XLSX.utils.json_to_sheet(rows);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vendor Ledger');

    var filename = (v.vendorId || 'Vendor') + '_' + (v.companyName || 'Ledger').replace(/[^a-zA-Z0-9]/g, '_') + '_Statement.xlsx';
    XLSX.writeFile(wb, filename);

    if (typeof _toast === 'function') _toast('📥 Exported Ledger for ' + (v.companyName || v.vendorId) + ' to Excel!', 'ok');
  };

  // --- EXPORT ALL VENDOR LEDGERS TO EXCEL ---
  window.exportAllVendorLedgersExcel = function() {
    if (!VENDORS || VENDORS.length === 0) {
      alert('No vendors in ledger.');
      return;
    }

    if (typeof XLSX === 'undefined') {
      alert('SheetJS (XLSX) library not loaded.');
      return;
    }

    var data = VENDORS.map(function(v, idx) {
      var fin = window.getVendorFinancials(v.vendorId || v.id) || {};
      return {
        'S.No': idx + 1,
        'Vendor ID': v.vendorId || v.id || '',
        'College': v.college ? v.college.toUpperCase() : 'SMGG',
        'Vendor Company Name': v.companyName || v.company || '',
        'Contact Person': v.vendorName || v.name || '',
        'Phone Number': v.phone || '',
        'PAN Number': v.pan || '',
        'Agreed Amount (Rs)': fin.agreedAmount || 0,
        'Total Paid to Date (Rs)': fin.totalPaid || 0,
        'Outstanding Balance (Rs)': fin.balance || 0,
        'Disbursed %': (fin.paidPercent || 0) + '%',
        'Linked Debit Vouchers Count': fin.vouchersCount || 0,
        'Agreement Start Date': v.periodStart || v.agreementDate || '',
        'Agreement End Date': v.periodEnd || '',
        'Payment Status': fin.status || 'unpaid',
        'GST Number': v.gstNumber || '',
        'Bank Account Details': v.bankAccountDetails || '',
        'Work Description': v.workDescription || v.workDesc || '',
        'Authorized By': v.authBy || ''
      };
    });

    var ws = XLSX.utils.json_to_sheet(data);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vendor Ledger Register');

    var colCode = (window.CURRENT_COLLEGE || 'smgg').toUpperCase();
    var filename = 'StMarys_' + colCode + '_Master_Vendor_Ledger_' + new Date().toISOString().slice(0, 10) + '.xlsx';
    XLSX.writeFile(wb, filename);

    if (typeof _toast === 'function') _toast('📥 Exported ' + data.length + ' Vendor Ledgers to Excel!', 'ok');
  };

  // --- INITIALIZE LISTENERS & HOOKS ---
  function initVendorModule() {
    loadVendors();

    // Set next Auto-generated Vendor ID preview
    var idInput = document.getElementById('f_v_id');
    if (idInput && !vendorEditId) {
      idInput.value = getNextVendorId();
    }

    // Auto-words on amount input
    var amtInput = document.getElementById('f_v_amount');
    if (amtInput) {
      amtInput.addEventListener('input', function() {
        var v = parseFloat(this.value) || 0;
        var wordsEl = document.getElementById('f_v_words');
        if (wordsEl && typeof numToWords === 'function') {
          wordsEl.value = numToWords(v);
        }
      });
    }

    // Auto-uppercase PAN
    var panInput = document.getElementById('f_v_pan');
    if (panInput) {
      panInput.addEventListener('input', function() {
        this.value = this.value.toUpperCase();
      });
    }

    renderFileSlots();
    renderVendorsTable();
    renderVendorLedgerTable();
  }

  // Hook into show()
  var oldShow = window.show;
  window.show = function(id) {
    if (typeof oldShow === 'function') oldShow(id);
    if (id === 'vendor') {
      loadVendors();
      if (!vendorEditId) {
        var idInput = document.getElementById('f_v_id');
        if (idInput) idInput.value = getNextVendorId();
      }
      renderFileSlots();
      renderVendorsTable();
    }
    if (id === 'vendorledger') {
      loadVendors();
      renderVendorLedgerTable();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVendorModule);
  } else {
    initVendorModule();
  }

})();
