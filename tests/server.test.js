const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const tempDataFile = path.join(os.tmpdir(), `ss-shared-state-${Date.now()}.json`);
process.env.DATA_FILE = tempDataFile;

const { writeRegistrationsFile, readRegistrationsFile } = require('../server.js');

test('persists shared session state and registration data', () => {
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
  assert.equal(result.sessionState.dashboardUnlocked, true);
  assert.equal(result.sessionState.currentUser, 'admin');
  assert.equal(result.sessionState.lastParticipationChoice, 'no');
});
