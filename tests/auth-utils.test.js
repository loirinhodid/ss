const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, hashTextSha256 } = require('../auth-utils');

test('hashes and verifies a user password safely', async () => {
  const password = 'strong-password-123';
  const hashed = await hashPassword(password);

  assert.notEqual(hashed, password);
  assert.equal(await verifyPassword(password, password), true);
  assert.equal(await verifyPassword(password, hashed), true);
  assert.equal(await hashTextSha256(password), hashed);
});
