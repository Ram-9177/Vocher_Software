const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.old.js'), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing source section: ${start}`);
  return source.slice(from, to);
}

test('phone suggestions preserve order and deduplicate without repeated DOM writes', () => {
  let writes = 0;
  const list = { html: '', set innerHTML(value) { this.html = value; writes++; } };
  const context = vm.createContext({
    document: { getElementById: () => list },
    VS: [{ recipientPhone: ' 123 ' }, { recipient_phone: '456' }, { recipientPhone: '123' }, {}]
  });
  vm.runInContext(section('let _phoneSuggestionsTarget=', 'window.onPhoneSelected ='), context);
  context.updatePhoneSuggestions();
  assert.equal(list.html, '<option value="123"></option><option value="456"></option>');
  context.updatePhoneSuggestions();
  assert.equal(writes, 1);
  context.VS.push({ recipientPhone: '789' });
  context.updatePhoneSuggestions();
  assert.equal(writes, 2);
  assert.ok(list.html.endsWith('<option value="789"></option>'));
  context.VS = [];
  context.updatePhoneSuggestions();
  assert.equal(list.html, '');
});

test('phone suggestions handle 25,000 unique numbers and a replacement datalist', () => {
  let writes = 0, current = { set innerHTML(value) { this.html = value; writes++; } };
  const context = vm.createContext({
    document: { getElementById: () => current },
    VS: Array.from({ length: 25000 }, (_, i) => ({ recipientPhone: String(9000000000 + i) }))
  });
  vm.runInContext(section('let _phoneSuggestionsTarget=', 'window.onPhoneSelected ='), context);
  context.updatePhoneSuggestions();
  assert.equal((current.html.match(/<option /g) || []).length, 25000);
  context.updatePhoneSuggestions();
  assert.equal(writes, 1);
  current = { set innerHTML(value) { this.html = value; writes++; } };
  context.updatePhoneSuggestions();
  assert.equal(writes, 2);
  assert.equal((current.html.match(/<option /g) || []).length, 25000);
});

test('cached auth immediately follows changed, removed, and malformed stored users', () => {
  let raw = '{"username":"alice"}', parses = 0;
  const context = vm.createContext({
    localStorage: { getItem: () => raw }, CU: 'admin2',
    JSON: { parse(value) { parses++; return JSON.parse(value); } }
  });
  vm.runInContext(section('let _authUserCacheRaw', 'function _isPrimaryAdminSession(){'), context);
  for (let i = 0; i < 1000; i++) assert.equal(context._isOwnVoucher({ created_by: 'alice' }), true);
  assert.equal(parses, 1);
  raw = '{"username":"bob"}';
  assert.equal(context._isOwnVoucher({ created_by: 'alice' }), false);
  assert.equal(context._isOwnVoucher({ created_by: 'bob' }), true);
  assert.equal(parses, 2);
  raw = null;
  assert.equal(context._authUserFromStorage(), null);
  raw = '{bad json';
  assert.equal(context._authUserFromStorage(), null);
  assert.equal(context._authUserFromStorage(), null);
  assert.equal(parses, 3);
  raw = '{"username":"carol"}';
  assert.equal(context._isOwnVoucher({ created_by: 'carol' }), true);
  assert.equal(context._isOwnVoucher({ createdBy: 'admin2' }), true);
  assert.equal(context._isOwnVoucher({ type: 'onaccount', created_by: 'someone' }), true);
});

test('base navigation leaves vendor rendering to the installed vendor wrapper', () => {
  let vendorRenders = 0, ledgerRenders = 0;
  const context = vm.createContext({
    window: { location: { hash: '' }, history: { pushState() {} } },
    document: { querySelectorAll: () => [], getElementById: () => null },
    renderVendorsTable: () => vendorRenders++, renderVendorLedgerTable: () => ledgerRenders++,
    _setSess() {}, editId: null
  });
  vm.runInContext(section('function show(id){', 'window.show = show;'), context);
  context.show('vendor');
  context.show('vendorledger');
  assert.equal(vendorRenders, 0);
  assert.equal(ledgerRenders, 0);
});

test('college switching updates both core and vendor voucher state before refreshing', async () => {
  const previous = [{ id: 1, college: 'smgg' }], next = [{ id: 2, college: 'smwec' }];
  let refreshed;
  const context = vm.createContext({
    previous, next,
    document: { getElementById: () => null },
    localStorage: { setItem() {} },
    _sessionCollegeAccess: () => ['smgg', 'smwec'],
    _stopLiveSync() {}, _startLiveSync() {}, _setSess() {}, updateCollegeSwitchPill() {},
    _api: async action => action === 'validateSession' ? {} : { vouchers: next },
    alert: message => assert.fail(message),
    reloadVendorModule() { refreshed = context.VS; }
  });
  context.window = context;
  context.VS = previous;
  vm.runInContext("let VS=previous, CURRENT_COLLEGE='smgg';", context);
  vm.runInContext(section('async function switchCollegeCtx(){', 'let _authUserCacheRaw'), context);
  await context.switchCollegeCtx();
  assert.equal(refreshed, next);
  assert.equal(context.VS, next);
  assert.equal(vm.runInContext('VS', context), next);
});
