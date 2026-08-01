(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.AuthUtils = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function isNodeRuntime() {
    return typeof process !== 'undefined' && process.versions && process.versions.node;
  }

  async function hashTextSha256(message) {
    if (!message) return '';

    if (isNodeRuntime()) {
      const crypto = require('crypto');
      return crypto.createHash('sha256').update(String(message)).digest('hex');
    }

    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const msgBuffer = new TextEncoder().encode(String(message));
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    return '';
  }

  async function hashPassword(password) {
    return hashTextSha256(password);
  }

  function looksLikeSha256Hash(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
  }

  async function verifyPassword(inputPassword, storedPassword) {
    if (!inputPassword || !storedPassword) return false;

    const normalizedInput = String(inputPassword);
    const normalizedStored = String(storedPassword);

    if (normalizedStored === normalizedInput) {
      return true;
    }

    const hashedInput = await hashTextSha256(normalizedInput);
    return normalizedStored === hashedInput;
  }

  return {
    hashTextSha256,
    hashPassword,
    looksLikeSha256Hash,
    verifyPassword
  };
}));
