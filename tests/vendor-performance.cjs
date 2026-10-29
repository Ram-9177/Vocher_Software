const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../vendor.js'), 'utf8').replace(
  '  function createFinancialSnapshot() {',
  '  window.__financialSnapshot = createFinancialSnapshot;\n  function createFinancialSnapshot() {'
);

function harness() {
  const elements = new Map();
  const storage = new Map();
  const listeners = new Map();
  const calls = [];
  let storageWrites = 0;
  function element(id) {
    const classes = new Set();
    let html = '';
    return {
      id, value: '', children: [], style: {}, writes: 0,
      classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) },
      appendChild(child) { this.children.push(child); },
      get innerHTML() { return html; },
      set innerHTML(value) { html = value; this.children = []; this.writes++; }
    };
  }
  for (const id of ['sec-create', 'sec-vendor', 'sec-vendorledger', 'sec-dashboard', 'DL_VENDORS', 'VENDOR_TABLE_BODY', 'VENDOR_LEDGER_TABLE_BODY', 'DASH_VENDOR_COUNT']) {
    elements.set(id, element(id));
  }
  const context = {
    console,
    document: {
      readyState: 'loading',
      addEventListener(name, callback) { listeners.set(name, callback); },
      getElementById(id) { return elements.get(id) || null; },
      createElement() { return element(); },
      createDocumentFragment() { return element(); },
      body: { appendChild() {} }
    },
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, value); storageWrites++; },
      removeItem(key) { storage.delete(key); }
    },
    VS: [],
    _api(action, payload) { calls.push({ action, payload }); return Promise.resolve({ vendors: [] }); },
    show(id) {
      for (const [key, node] of elements) if (key.startsWith('sec-')) node.classList.remove('act');
      const section = elements.get('sec-' + id);
      if (section) section.classList.add('act');
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext('let CURRENT_COLLEGE = null;', context);
  vm.runInContext(source, context);
  return {
    context, elements, storage, calls,
    storageWrites: () => storageWrites,
    college(value) { context.__nextCollege = value; vm.runInContext('CURRENT_COLLEGE = __nextCollege;', context); },
    boot() { listeners.get('DOMContentLoaded')(); }
  };
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('indexed vendor finances preserve legacy links, college/date filters and stable order', () => {
  const { context, college } = harness();
  college('smgg');
  const vendors = [
    { vendorId: 'V00001', id: 'legacy-A', college: 'smgg', periodStart: '2026-03-01', agreedAmount: 500 },
    { vendorId: 'V000010', id: 'legacy-B', college: 'stmw', agreement: { periodStart: '2026-02-01' }, amount: 100 },
    { id: 'legacy-C', createdAt: '2026-01-15T12:00:00Z', agreedAmount: 0 },
    { vendorId: 'V00001', id: 'duplicate', agreedAmount: 999 }
  ];
  context.applyServerVendors(vendors, { deferRender: true });
  context.VS = [
    { id: 2, type: 'debit', vendorId: 'V00001', dateISO: '2026-03-02', amount: '20', college: 'smgg' },
    { id: 1, type: 'DEBIT', vendor_id: 'V000010', date: '02/03/2026', amount: '30', college: 'smgg' },
    { id: 1, type: 'debit', vendorId: 'V00001', date: '02-03-2026', amount: '40', college: 'stmw' },
    { id: 1, type: 'debit', vendorId: 'V00001', dateISO: '2026-03-02', amount: '50', college: 'smgg' },
    { id: 9, type: 'debit', vendorId: 'V00001', dateISO: '2026-02-28', amount: 999 },
    { id: 10, type: 'credit', vendorId: 'V00001', dateISO: '2026-03-03', amount: 999 },
    { id: 11, type: 'debit', vendorId: 'legacy-A', dateISO: '2026-03-03', amount: 5 },
    { id: 12, type: 'debit', vendor_id: 'legacy-C', dateISO: '2026-01-14', amount: 999 },
    { id: 13, type: 'debit', vendor_id: 'legacy-C', dateISO: '2026-01-15', amount: 8 },
    { id: 14, type: 'debit', vendorId: 'V00001', amount: 3 },
    { id: 15, type: 'debit', vendorId: 'unrelated', amount: 999 },
    null
  ];
  for (const user of ['staff', 'admin1']) {
    context.CU = user;
    const snapshot = context.__financialSnapshot();
    for (const id of ['V00001', 'V000010', 'legacy-A', 'legacy-B', 'legacy-C', 'duplicate', 'missing']) {
      assert.deepEqual(plain(context.getVendorFinancials(id, snapshot)), plain(context.getVendorFinancials(id)));
    }
  }
  context.CU = 'staff';
  assert.deepEqual(plain(context.getLinkedDebitVouchers('V00001', context.__financialSnapshot())).map(v => v.id), [14, 1, 1, 2]);
});

test('each render snapshot scans voucher types once and a fresh snapshot observes edits', () => {
  const { context, college } = harness();
  college('smgg');
  const vendors = Array.from({ length: 100 }, (_, i) => ({ vendorId: 'V' + String(i + 1).padStart(5, '0'), agreedAmount: 1000 }));
  context.applyServerVendors(vendors, { deferRender: true });
  let reads = 0;
  context.VS = Array.from({ length: 10000 }, (_, i) => ({
    get type() { reads++; return 'debit'; },
    vendorId: vendors[i % vendors.length].vendorId, id: i, dateISO: '2026-10-01', amount: 2
  }));
  const snapshot = context.__financialSnapshot();
  for (const vendor of vendors) assert.equal(context.getVendorFinancials(vendor.vendorId, snapshot).totalPaid, 200);
  assert.equal(reads, context.VS.length);
  context.VS[0].amount = 50;
  assert.equal(context.getVendorFinancials(vendors[0].vendorId, context.__financialSnapshot()).totalPaid, 248);
});

test('vendor navigation renders once and unchanged/hidden sync avoids repainting', () => {
  const h = harness();
  h.college('smgg');
  const vendors = [{ vendorId: 'V00001', agreedAmount: 100, companyName: 'Example', college: 'smgg' }];
  h.context.applyServerVendors(vendors, { deferRender: true });
  const body = h.elements.get('VENDOR_LEDGER_TABLE_BODY');
  h.context.show('vendorledger');
  assert.equal(body.writes, 1);
  const writes = h.storageWrites();
  assert.equal(h.context.applyServerVendors(vendors), false);
  assert.equal(body.writes, 1);
  assert.equal(h.storageWrites(), writes);
  h.context.show('dashboard');
  assert.equal(h.context.applyServerVendors([{ ...vendors[0], agreedAmount: 120 }]), true);
  assert.equal(body.writes, 1);
  assert.equal(h.elements.get('DASH_VENDOR_COUNT').textContent, '1');
  h.context.show('vendorledger');
  assert.equal(body.writes, 2);
  assert.equal(h.calls.length, 0);
});

test('login after unauthenticated boot fetches vendors once for the selected college', async () => {
  const h = harness();
  h.boot();
  assert.equal(h.calls.length, 0);
  h.college('smwec');
  h.storage.set('smv_token', 'session-fixture');
  h.context.reloadVendorModule();
  await h.context.loadVendorsFromCloud();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].payload.college, 'smwec');
  h.context.show('vendor');
  h.context.show('vendorledger');
  assert.equal(h.calls.length, 1);
});

test('repeated create navigation keeps unchanged party suggestions and follows voucher edits', () => {
  const h = harness();
  h.college('smgg');
  h.context.VS = [{ type: 'debit', paidTo: 'First party' }];
  h.context.show('create');
  const datalist = h.elements.get('DL_VENDORS');
  const writes = datalist.writes;
  h.context.show('dashboard');
  h.context.show('create');
  assert.equal(datalist.writes, writes);
  h.context.VS[0].paidTo = 'Updated party';
  h.context.refreshVendorViews();
  assert.equal(datalist.writes, writes + 1);
});

test('outdated college and session responses cannot overwrite the current vendor state', async () => {
  const h = harness();
  const requests = [];
  h.context._api = (action, payload) => new Promise(resolve => requests.push({ action, payload, resolve }));
  h.storage.set('smv_token', 'first-session');
  h.college('smgg');
  h.context.loadVendors();
  const first = h.context.loadVendorsFromCloud();
  h.college('smwec');
  h.context.loadVendors();
  const second = h.context.loadVendorsFromCloud();
  requests[0].resolve({ vendors: [{ vendorId: 'old-college' }] });
  await first;
  assert.equal(h.context.getVendorsCount(), 0);
  h.storage.set('smv_token', 'next-session');
  h.context.reloadVendorModule();
  const third = h.context.loadVendorsFromCloud();
  requests[1].resolve({ vendors: [{ vendorId: 'old-session' }] });
  await second;
  assert.equal(h.context.getVendorsCount(), 0);
  requests[2].resolve({ vendors: [{ vendorId: 'current' }] });
  await third;
  assert.equal(h.context.getAllVendors()[0].vendorId, 'current');
  assert.equal(h.storage.has('smv_vendors_smgg'), false);
});
