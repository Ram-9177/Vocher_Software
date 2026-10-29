const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const startup = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const override = fs.readFileSync(path.join(root, 'live-save-override.js'), 'utf8');
const scripts = ['app.old.js', 'live-adapter.js', 'live-save-override.js', 'admin1-users.js', 'vendor.js'];
const settle = () => new Promise(resolve => setImmediate(resolve));

function boot(readyState = 'loading') {
  const appended = [], listeners = [], timers = [], events = [], alerts = [];
  class FakeEvent {
    constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
    stopImmediatePropagation() { this.stopped = true; }
  }
  const document = {
    readyState,
    currentScript: { src: 'https://voucher.test/app.js?v=build%20%26%20quality' },
    createElement(tag) { assert.equal(tag, 'script'); return {}; },
    head: { appendChild(script) { appended.push(script); } },
    addEventListener(type, fn, capture) { listeners.push({ type, fn, capture }); },
    removeEventListener(type, fn, capture) {
      const index = listeners.findIndex(listener => listener.type === type && listener.fn === fn && listener.capture === capture);
      if (index >= 0) listeners.splice(index, 1);
    },
    dispatchEvent(event) {
      events.push(event);
      for (const listener of listeners.slice()) {
        if (listener.type === event.type) listener.fn(event);
        if (event.stopped) break;
      }
    }
  };
  vm.runInNewContext(startup, {
    document, window: { location: { href: 'https://voucher.test/' } }, URL, Event: FakeEvent,
    setTimeout(fn, delay) { assert.equal(delay, 0); timers.push(fn); }, alert: message => alerts.push(message)
  });
  return { document, appended, listeners, timers, events, alerts, FakeEvent };
}

test('startup requests all modules immediately in ordered execution mode with the build version', () => {
  const app = boot();
  assert.equal(app.appended.length, 5);
  assert.deepEqual(app.appended.map(script => new URL(script.src, 'https://voucher.test/').pathname.slice(1)), scripts);
  for (const script of app.appended) {
    assert.equal(script.async, false);
    assert.equal(new URL(script.src, 'https://voucher.test/').searchParams.get('v'), 'build & quality');
    assert.equal(typeof script.onload, 'function');
    assert.equal(typeof script.onerror, 'function');
  }
  assert.equal(app.timers.length, 0);
});

test('startup holds DOM readiness until every module loads and replays it once', async () => {
  const app = boot();
  assert.equal(app.listeners.length, 1);
  assert.equal(app.listeners[0].capture, true);
  app.document.readyState = 'interactive';
  const original = new app.FakeEvent('DOMContentLoaded');
  app.document.dispatchEvent(original);
  assert.equal(original.stopped, true);
  for (let i = 4; i > 0; i--) app.appended[i].onload();
  await settle();
  assert.equal(app.listeners.length, 1);
  assert.equal(app.timers.length, 0);
  app.appended[0].onload();
  await settle();
  assert.equal(app.listeners.length, 0);
  assert.equal(app.timers.length, 1);
  app.timers.shift()();
  assert.equal(app.events.length, 2);
  assert.equal(app.events[1].type, 'DOMContentLoaded');
  assert.equal(app.events[1].bubbles, true);
  app.appended[0].onload();
  await settle();
  assert.equal(app.timers.length, 0);
  assert.equal(app.alerts.length, 0);
});

test('startup replays readiness when the loader starts after page loading', async () => {
  const app = boot('complete');
  assert.equal(app.listeners.length, 0);
  app.appended.forEach(script => script.onload());
  await settle();
  assert.equal(app.timers.length, 1);
  app.timers.shift()();
  assert.equal(app.events.length, 1);
});

test('deferred startup holds the native event during partial module loading', async () => {
  const app = boot('interactive');
  app.appended[0].onload();
  const original = new app.FakeEvent('DOMContentLoaded');
  app.document.dispatchEvent(original);
  assert.equal(original.stopped, true);
  app.appended.slice(1).forEach(script => script.onload());
  await settle();
  assert.equal(app.timers.length, 1);
  app.timers.shift()();
  assert.equal(app.events.filter(event => !event.stopped).length, 1);
});

test('deferred startup finishing before the native event does not synthesize another', async () => {
  const app = boot('interactive');
  app.appended.forEach(script => script.onload());
  await settle();
  assert.equal(app.timers.length, 0);
  app.document.dispatchEvent(new app.FakeEvent('DOMContentLoaded'));
  assert.equal(app.events.length, 1);
  assert.equal(app.events[0].stopped, undefined);
});

test('startup leaves the natural ready event alone when loading finishes before DOM parsing', async () => {
  const app = boot();
  app.appended.forEach(script => script.onload());
  await settle();
  assert.equal(app.listeners.length, 0);
  assert.equal(app.timers.length, 0);
  app.document.dispatchEvent(new app.FakeEvent('DOMContentLoaded'));
  assert.equal(app.events.length, 1);
  assert.equal(app.events[0].stopped, undefined);
});

test('startup reports a failed module and does not signal successful readiness', async () => {
  const app = boot();
  app.appended[2].onerror();
  app.appended.forEach((script, index) => { if (index !== 2) script.onload(); });
  await settle();
  assert.deepEqual(app.alerts, ['Failed to load live-save-override.js']);
  assert.equal(app.timers.length, 0);
  assert.equal(app.events.length, 0);
});

test('save override neither injects an admin module nor adds a second heads request to init', async () => {
  const appended = [], requests = [];
  const context = vm.createContext({
    document: {
      currentScript: { src: 'https://voucher.test/live-save-override.js?v=test' },
      querySelector: () => null, createElement: () => ({ setAttribute() {} }),
      head: { appendChild: script => appended.push(script) }
    },
    URL,
    _api: async action => { requests.push(action); return { heads: [] }; },
    fetchDynamicHeads: async () => { requests.push('listHeads'); }
  });
  context.window = context;
  context.initApp = () => context.fetchDynamicHeads();
  const originalInit = context.initApp;
  vm.runInContext(override, context);
  assert.equal(appended.length, 0);
  assert.equal(context.initApp, originalInit);
  await context.initApp();
  assert.deepEqual(requests, ['listHeads']);
  assert.equal(context._loadDynamicHeads, context.fetchDynamicHeads);
});
