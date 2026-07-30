const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, hashTextSha256 } = require('../auth-utils');

test('hashes and verifies the default admin password correctly', async () => {
  const password = 'aniimo';
  const hashed = await hashPassword(password);

  assert.notEqual(hashed, password);
  assert.equal(await verifyPassword(password, password), true);
  assert.equal(await verifyPassword(password, hashed), true);
  assert.equal(await hashTextSha256(password), 'c8bf231d991a832c793f8b518ae7a49d4e807ac1ab183c2a01bc659c01d0b774');
});
