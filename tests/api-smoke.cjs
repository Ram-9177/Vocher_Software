const assert = require('node:assert/strict');
const { randomBytes, webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const vm = require('node:vm');

function loadHandler(relativePath) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  const context = vm.createContext({ Request, Response, TextEncoder, TextDecoder, crypto: webcrypto, atob, btoa });
  vm.runInContext(source.replace('export async function onRequest', 'async function onRequest') + '\nglobalThis.testOnRequest = onRequest;', context);
  return context.testOnRequest;
}

function sqliteD1() {
  const sqlite = new DatabaseSync(':memory:');
  const calls = [];
  return {
    sqlite, calls,
    prepare(sql) {
      function statement(values) {
        function execute(method) {
          calls.push(sql);
          return sqlite.prepare(sql)[method](...values);
        }
        return {
          bind(...args) { return statement(args); },
          async run() {
            const result = execute('run');
            return { success: true, results: [], meta: { last_row_id: Number(result.lastInsertRowid), changes: Number(result.changes) } };
          },
          async all() { return { success: true, results: execute('all') }; },
          async first(column) {
            const row = execute('get');
            return row ? (column ? row[column] : row) : null;
          }
        };
      }
      return statement([]);
    }
  };
}

(async () => {
  const DB = sqliteD1();
  const env = { DB };
  const voucherHandler = loadHandler('functions/api/public/voucher/x.js');
  const collegeHandler = loadHandler('functions/api/public/colleges/x.js');
  let token = '';
  async function call(handler, action, payload = {}, expectedStatus = 200) {
    const request = new Request('https://test.invalid/api', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, token, ...payload })
    });
    const response = await handler({ request, env });
    const data = await response.json();
    assert.equal(response.status, expectedStatus, action + ': ' + (data.error || 'unexpected status'));
    return data;
  }
  async function countedCall(handler, action, payload, expectedQueries) {
    const before = DB.calls.length;
    const data = await call(handler, action, payload);
    assert.equal(DB.calls.length - before, expectedQueries, action + ' must avoid repeated schema SQL');
    return data;
  }

  try {
    const health = await countedCall(voucherHandler, 'health', {}, 0);
    assert.equal(health.ok, true);
    assert.equal(health.db, true);
    await countedCall(collegeHandler, 'health', {}, 0);

    const password = randomBytes(24).toString('base64url');
    const bootstrap = await call(voucherHandler, 'bootstrapAdmin', { username: 'admin1', college: 'smgg', password });
    assert.equal(bootstrap.ok, true);
    assert.ok(DB.sqlite.prepare('PRAGMA table_info(vouchers)').all().some(column => column.name === 'block'), 'fresh schema must have block immediately');

    const login = await countedCall(voucherHandler, 'login', { username: 'superadmin', college: 'smgg', password }, 5);
    assert.ok(login.token);
    token = login.token;
    const session = await countedCall(voucherHandler, 'validateSession', {}, 2);
    assert.equal(session.user.username, 'admin1');

    const saved = await countedCall(voucherHandler, 'saveVoucher', {
      voucher: { college: 'smgg', type: 'debit', dateISO: '2026-10-29', head: 'Office supplies', paidTo: 'Test payee', towards: 'API smoke check', block: 'Test block', amount: 1250, mode: 'Cash' }
    }, 4);
    assert.ok(saved.id > 0);
    assert.match(saved.voucher_no, /^SMGG-DV-/);
    const listed = await countedCall(voucherHandler, 'listVouchers', { college: 'smgg' }, 2);
    assert.equal(listed.vouchers.length, 1);
    assert.equal(listed.vouchers[0].id, saved.id);
    assert.equal(listed.vouchers[0].block, 'Test block');
    assert.equal(listed.vouchers[0].amount, 1250);

    const initialSync = await countedCall(voucherHandler, 'syncData', { college: 'smgg' }, 6);
    assert.equal(initialSync.vouchers.length, 1);
    assert.equal(initialSync.vouchers[0].block, 'Test block');
    assert.ok(initialSync.newVouchersHash);
    const unchangedSync = await countedCall(voucherHandler, 'syncData', { college: 'smgg', vouchersHash: initialSync.newVouchersHash }, 5);
    assert.equal(unchangedSync.vouchersNotModified, true);
    assert.equal(unchangedSync.vouchers, null);

    const colleges = await countedCall(collegeHandler, 'listColleges', {}, 8);
    assert.deepEqual(colleges.colleges.map(college => college.code).sort(), ['smgg', 'smhyd', 'smwec']);
    await countedCall(collegeHandler, 'listColleges', {}, 2);

    const audit = await countedCall(voucherHandler, 'listAudit', {}, 2);
    assert.ok(audit.logs.some(log => log.action === 'create_voucher'), 'User Management must load the saved voucher audit instead of failing');
    assert.ok(audit.logs.every((log, index, rows) => index === 0 || rows[index - 1].created_at >= log.created_at));

    const restartedHandler = loadHandler('functions/api/public/voucher/x.js');
    await countedCall(restartedHandler, 'listVouchers', { college: 'smgg' }, 27);
    await countedCall(restartedHandler, 'listVouchers', { college: 'smgg' }, 2);
    // --- Security regressions ---
    // Reserved super-admin usernames cannot be created by anyone.
    const reserved = await call(voucherHandler, 'createUser', { username: 'baji', password: 'Reserved-check-123', role: 'user' }, 400);
    assert.match(reserved.error, /reserved/i);
    // No silent default password.
    await call(voucherHandler, 'createUser', { username: 'nopass', role: 'user' }, 400);
    // A limited admin cannot take over a more privileged account.
    const strong = randomBytes(12).toString('base64url');
    await call(voucherHandler, 'createUser', { username: 'clerk_admin', password: strong, role: 'admin', college: 'smgg', permissions: 'view_dashboard,reset_passwords,create_users' });
    await call(voucherHandler, 'createUser', { username: 'boss_admin', password: strong, role: 'admin', college: 'smgg', permissions: 'view_dashboard,manage_colleges,create_admin,reset_passwords' });
    DB.sqlite.prepare("UPDATE users SET must_change_password=0 WHERE username IN ('clerk_admin','boss_admin')").run();
    const adminToken = token;
    token = '';
    const clerk = await call(voucherHandler, 'login', { username: 'clerk_admin', college: 'smgg', password: strong });
    token = clerk.token;
    await call(voucherHandler, 'resetPassword', { username: 'boss_admin', password: 'Takeover-attempt-1' }, 403);
    token = '';
    // Cross-origin browser requests are rejected.
    const cross = await voucherHandler({ request: new Request('https://test.invalid/api', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ action: 'listAdmins' }) }), env });
    assert.equal(cross.status, 403);
    // Login errors do not reveal whether the account exists, and repeated failures are throttled.
    const unknown = await call(voucherHandler, 'login', { username: 'ghost', password: 'whatever-123' }, 401);
    const wrong = await call(voucherHandler, 'login', { username: 'clerk_admin', password: 'wrong-password' }, 401);
    assert.equal(unknown.error, wrong.error);
    for (let i = 1; i < 10; i++) await call(voucherHandler, 'login', { username: 'clerk_admin', password: 'wrong-password' }, 401);
    await call(voucherHandler, 'login', { username: 'clerk_admin', password: strong }, 429);
    token = adminToken;
    // Uploads: only allowed file types are stored.
    await call(voucherHandler, 'saveVendor', { college: 'smgg', vendor: { vendorId: 'V-1', companyName: 'Acme', agreement: { files: [{ name: 'x.html', type: 'text/html', dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }] } } }, 400);
    await call(voucherHandler, 'saveVendor', { college: 'smgg', vendor: { vendorId: 'V-1', companyName: 'Acme', agreement: { files: [{ name: 'x.pdf', type: 'text/html', dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }] } } }, 400);
    await call(voucherHandler, 'saveVendor', { college: 'smgg', vendor: { vendorId: 'V-1', companyName: 'Acme', agreement: { files: [{ name: 'deal.pdf', size: 3, type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBE' }] } } });
    const vendorsAfter = await call(voucherHandler, 'listVendors', { college: 'smgg' });
    assert.equal(vendorsAfter.vendors[0].files[0].type, 'application/pdf');
    // Internal errors are not leaked to the client.
    const realPrepare = DB.prepare;
    DB.prepare = function (sql) { if (/FROM audit_logs ORDER BY/.test(sql)) throw new Error('no such table: secret_internal'); return realPrepare.call(this, sql); };
    const hidden = await call(voucherHandler, 'listAudit', {}, 500);
    DB.prepare = realPrepare;
    assert.ok(!/secret_internal/.test(hidden.error), 'internal error details must not reach the client');

    token = '';
    await call(voucherHandler, 'listVouchers', { college: 'smgg' }, 401);
    console.log('SQLite API smoke passed: cold bootstrap, login/session, voucher save/list/sync, colleges, warm query counts, and runtime restart.');
  } finally {
    DB.sqlite.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
