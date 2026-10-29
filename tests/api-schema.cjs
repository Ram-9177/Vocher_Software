const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSchema(relativePath) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.replace('export async function onRequest', 'async function onRequest') + '\nglobalThis.testEnsureSchema = ensureSchema;', context);
  return context.testEnsureSchema;
}

function mockDatabase() {
  const calls = [];
  const tables = new Set();
  const columns = new Map();
  const database = {
    calls, tables, columns, failNext: false, failMatching: null,
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async run() {
          calls.push(sql);
          if (database.failNext) { database.failNext = false; throw new Error('temporary database failure'); }
          if (database.failMatching && database.failMatching.test(sql)) { database.failMatching = null; throw new Error('temporary database failure'); }
          const create = sql.match(/^CREATE TABLE IF NOT EXISTS (\w+)/);
          if (create) tables.add(create[1]);
          const alter = sql.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+)/);
          if (alter) {
            if (!tables.has(alter[1])) throw new Error('no such table: ' + alter[1]);
            if (!columns.has(alter[1])) columns.set(alter[1], new Set());
            if (columns.get(alter[1]).has(alter[2])) throw new Error('duplicate column name: ' + alter[2]);
            columns.get(alter[1]).add(alter[2]);
          }
          return { success: true };
        },
        async first() {
          calls.push(sql);
          return { username: values[0] };
        }
      };
    }
  };
  return database;
}

async function verifyReadiness(ensureSchema, env) {
  const first = mockDatabase();
  await ensureSchema(first, env);
  const initializedCalls = first.calls.length;
  assert.ok(initializedCalls > 0);
  await ensureSchema(first, env);
  assert.equal(first.calls.length, initializedCalls, 'warm requests must skip schema SQL');

  const second = mockDatabase();
  await ensureSchema(second, env);
  assert.ok(second.calls.length > 0, 'a different binding must initialize independently');

  const retry = mockDatabase();
  retry.failNext = true;
  await assert.rejects(ensureSchema(retry, env), /temporary database failure/);
  await ensureSchema(retry, env);
  const recoveredCalls = retry.calls.length;
  await ensureSchema(retry, env);
  assert.equal(retry.calls.length, recoveredCalls, 'failed initialization must retry and then cache success');
  return first;
}

(async () => {
  const voucherSchema = loadSchema('functions/api/public/voucher/x.js');
  const vouchers = await verifyReadiness(voucherSchema, {});
  assert.ok(vouchers.columns.get('vouchers').has('block'), 'a fresh database must include block on its first request');
  assert.equal(vouchers.calls.filter(sql => sql.includes('CREATE INDEX IF NOT EXISTS idx_audit_created')).length, 1);
  const beforeChangedEnvironment = vouchers.calls.length;
  await voucherSchema(vouchers, { ADMIN1_INITIAL_PASSWORD: 'test-only-bootstrap-value' });
  assert.ok(vouchers.calls.length > beforeChangedEnvironment, 'changed bootstrap configuration must be checked again');

  const partialMigration = mockDatabase();
  partialMigration.failMatching = /^ALTER TABLE vouchers ADD COLUMN block/;
  await assert.rejects(voucherSchema(partialMigration, {}), /temporary database failure/);
  await voucherSchema(partialMigration, {});
  assert.ok(partialMigration.columns.get('vouchers').has('block'), 'a failed column migration must retry rather than mark schema ready');

  const collegeSchema = loadSchema('functions/api/public/colleges/x.js');
  await verifyReadiness(collegeSchema);
  const failedRename = mockDatabase();
  failedRename.failMatching = /^UPDATE OR IGNORE colleges/;
  await assert.rejects(collegeSchema(failedRename), /temporary database failure/);
  await collegeSchema(failedRename);
  console.log('API schema readiness, binding isolation, retry, bootstrap configuration, and fresh-database checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
