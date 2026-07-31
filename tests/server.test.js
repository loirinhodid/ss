const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const tempDataFile = path.join(os.tmpdir(), `ss-shared-state-${Date.now()}.json`);
process.env.DATA_FILE = tempDataFile;

const { writeRegistrationsFile, readRegistrationsFile } = require('../server.js');

test('persists shared registration data while sanitizing sensitive session state', () => {
  const payload = {
    registrations: [{ name: 'Ana', email: 'ana@example.com', participate: 'yes', date: '2026-01-01T00:00:00.000Z' }],
    users: [{ username: 'admin', role: 'admin', password: 'hash' }],
    auditLog: [{ user: 'admin', action: 'Login', details: 'Acesso', date: '2026-01-01T00:00:00.000Z' }],
    sessionState: {
      dashboardUnlocked: true,
      currentUser: 'admin',
      lastParticipationChoice: 'no',
      lastUpdated: '2026-01-01T00:00:00.000Z'
    }
  };

  writeRegistrationsFile(payload);
  const result = readRegistrationsFile();

  assert.deepEqual(result.registrations, payload.registrations);
  assert.deepEqual(result.users, payload.users);
  assert.deepEqual(result.auditLog, payload.auditLog);
  assert.equal(result.sessionState.dashboardUnlocked, false);
  assert.equal(result.sessionState.currentUser, '');
  assert.equal(result.sessionState.lastParticipationChoice, 'yes');
});

test('stores the latest state in a SQLite database so edits and deletions persist', () => {
  const updatedPayload = {
    registrations: [{ name: 'Bruno', email: 'bruno@example.com', participate: 'no', date: '2026-02-02T00:00:00.000Z' }],
    users: [{ username: 'admin', role: 'admin', password: 'hash' }],
    auditLog: [],
    sessionState: {
      dashboardUnlocked: false,
      currentUser: '',
      lastParticipationChoice: 'yes',
      lastUpdated: '2026-02-02T00:00:00.000Z'
    }
  };

  writeRegistrationsFile(updatedPayload);

  const dbPath = path.join(path.dirname(tempDataFile), `${path.basename(tempDataFile, path.extname(tempDataFile))}.sqlite`);
  const db = new DatabaseSync(dbPath);
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_state'").get();
  const storedPayload = db.prepare('SELECT payload FROM app_state WHERE key = ?').get('registrations');

  assert.ok(tableExists, 'A tabela app_state deve existir');
  assert.ok(storedPayload, 'O estado deve ser salvo na tabela app_state');

  const result = readRegistrationsFile();
  assert.deepEqual(result.registrations, updatedPayload.registrations);
  assert.deepEqual(result.auditLog, updatedPayload.auditLog);
  assert.equal(result.sessionState.lastParticipationChoice, 'yes');
});
