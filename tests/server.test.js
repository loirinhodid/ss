const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const tempDataFile = path.join(os.tmpdir(), `ss-shared-state-${Date.now()}.json`);
process.env.DATA_FILE = tempDataFile;

const { writeRegistrationsFile, readRegistrationsFile, shouldBlockAutomatedRequest, getBotProtectionStatus, setBotProtectionEnabled } = require('../server.js');

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

test('blocks obvious bot and automation requests when protection is enabled', () => {
  setBotProtectionEnabled(true);
  const blocked = shouldBlockAutomatedRequest({
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)'
    }
  });

  assert.equal(blocked, true);
});

test('allows toggling protection state on and off', () => {
  setBotProtectionEnabled(false);
  assert.equal(getBotProtectionStatus(), false);

  setBotProtectionEnabled(true);
  assert.equal(getBotProtectionStatus(), true);
});

test('blocks page and dashboard requests that do not look like a real browser', () => {
  setBotProtectionEnabled(true);
  const blocked = shouldBlockAutomatedRequest({
    headers: {
      'user-agent': 'python-requests/2.31.0',
      accept: 'text/html,application/xhtml+xml'
    }
  });

  assert.equal(blocked, true);
});

test('records protection events in the audit log', () => {
  const initialPayload = {
    registrations: [],
    users: [{ username: 'admin', role: 'admin', password: 'hash' }],
    auditLog: [],
    sessionState: {
      dashboardUnlocked: false,
      currentUser: '',
      lastParticipationChoice: 'yes',
      lastUpdated: '2026-03-05T00:00:00.000Z'
    }
  };

  writeRegistrationsFile(initialPayload);
  setBotProtectionEnabled(true);
  shouldBlockAutomatedRequest({ headers: { 'user-agent': 'Mozilla/5.0 (compatible; GPTBot/1.1)' } });

  const result = readRegistrationsFile();
  const latestEvent = result.auditLog[0];

  assert.ok(latestEvent, 'Deveria registrar um evento de proteção');
  assert.equal(latestEvent.action, 'Proteção bloqueada');
});

test('preserves existing registrations when a partial payload is written', () => {
  const initialPayload = {
    registrations: [{ name: 'Carla', email: 'carla@example.com', participate: 'yes', date: '2026-03-03T00:00:00.000Z' }],
    users: [{ username: 'admin', role: 'admin', password: 'hash' }],
    auditLog: [],
    sessionState: {
      dashboardUnlocked: false,
      currentUser: '',
      lastParticipationChoice: 'yes',
      lastUpdated: '2026-03-03T00:00:00.000Z'
    }
  };

  writeRegistrationsFile(initialPayload);

  const partialPayload = {
    users: [{ username: 'admin', role: 'admin', password: 'hash' }],
    auditLog: [{ user: 'system', action: 'Sync', details: 'Partial write', date: '2026-03-04T00:00:00.000Z' }]
  };

  const result = writeRegistrationsFile(partialPayload);

  assert.deepEqual(result.registrations, initialPayload.registrations);
  assert.deepEqual(result.auditLog, partialPayload.auditLog);
});
