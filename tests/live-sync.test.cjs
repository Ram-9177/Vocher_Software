const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function harness(activeId = 'sec-dashboard') {
  const renders = {}, requests = [], storage = new Map([['smv_token', 'test-session']]);
  let tick, response = { vouchers: [], heads: [], blocks: [] }, release;
  const context = vm.createContext({
    console, URL, Promise,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    sessionStorage: { setItem() {} },
    document: { hidden: false, createElement: () => ({}), head: { appendChild() {} }, getElementById: () => null, querySelector: () => ({ id: activeId }) },
    setInterval: fn => { tick = fn; return 1; }, clearInterval() {},
    fetch: async (_, options) => {
      requests.push(JSON.parse(options.body));
      if (release) await new Promise(resolve => { release = resolve; });
      return { ok: true, json: async () => response };
    },
    _stopLiveSync() {}, _vsSignature: () => '', HEADS: [], BLOCKS: [], DEFAULT_HEADS: [],
    applyServerVendors: (_, options) => { assert.equal(options.deferRender, true); return context.vendorsChanged; },
    refreshVendorViews: () => { renders.vendor = (renders.vendor || 0) + 1; },
    updatePhoneSuggestions: () => { renders.phone = (renders.phone || 0) + 1; }
  });
  for (const name of ['renderVT', 'renderDash', 'renderMyDash', 'renderMyVT', 'renderAnalytics']) context[name] = () => { renders[name] = (renders[name] || 0) + 1; };
  context.window = context;
  vm.runInContext("let CU='admin1', CURRENT_COLLEGE='smgg', VS=[], _LIVE_TIMER=null, _LIVE_SIG='';", context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'live-adapter.js'), 'utf8'), context);
  return {
    context, renders, requests, storage,
    start() { context._startLiveSync(); },
    tick: () => tick(),
    respond(value) { response = value; },
    hold() { release = true; },
    release() { const resolve = release; release = null; resolve(); },
    evaluate: code => vm.runInContext(code, context)
  };
}

test('sync renders only the visible voucher view and refreshes vendors without another request', async () => {
  for (const [section, renderer] of Object.entries({ dashboard: 'renderDash', vouchers: 'renderVT', mydashboard: 'renderMyDash', myvouchers: 'renderMyVT', analytics: 'renderAnalytics' })) {
    const app = harness('sec-' + section);
    app.respond({ vouchers: [{ id: 1, _u: 'changed' }], heads: [], blocks: [], vendors: [], newVouchersHash: '1|changed' });
    app.start();
    await app.tick();
    assert.equal(app.renders[renderer], 1);
    assert.equal(Object.keys(app.renders).filter(key => key.startsWith('render')).length, 1);
    assert.equal(app.renders.vendor, 1);
    assert.deepEqual(app.requests.map(request => request.action), ['syncData']);
    assert.equal(app.context._VOUCHERS_SERVER_HASH, '1|changed');
  }
});

test('unchanged sync skips rendering; a vendor-only change refreshes once', async () => {
  const app = harness('sec-vendorledger');
  app.respond({ vouchersNotModified: true, heads: [], blocks: [], vendors: [] });
  app.start();
  await app.tick();
  assert.deepEqual(app.renders, {});
  app.context.vendorsChanged = true;
  await app.tick();
  assert.deepEqual(app.renders, { vendor: 1 });
});

test('slow sync does not overlap or apply a response after college or session changes', async () => {
  for (const change of ["CURRENT_COLLEGE='smwec'", "localStorage.setItem('smv_token','next-session')", 'CU=null']) {
    const app = harness();
    app.respond({ vouchers: [{ id: 99, _u: 'late' }], newVouchersHash: 'stale', vendors: [], user: { username: 'previous-user' } });
    app.start();
    app.hold();
    const pending = app.tick();
    await app.tick();
    assert.equal(app.requests.length, 1);
    app.evaluate(change);
    app.storage.set('smv_auth_user', '{"username":"current-user"}');
    app.release();
    await pending;
    assert.equal(app.evaluate('VS.length'), 0);
    assert.deepEqual(app.renders, {});
    assert.equal(app.context._VOUCHERS_SERVER_HASH, '');
    if(change.includes('next-session'))assert.equal(app.storage.get('smv_auth_user'), '{"username":"current-user"}');
  }
});

test('a restarted sync clears the previous college hash', () => {
  const app = harness();
  app.context._VOUCHERS_SERVER_HASH = 'previous-college';
  app.start();
  assert.equal(app.context._VOUCHERS_SERVER_HASH, '');
});
