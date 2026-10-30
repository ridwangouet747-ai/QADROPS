const crypto = require('node:crypto');

const secret = process.env.QADR_SESSION_SECRET || 'development-only-change-me';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function verifyPassword(password, passwordHash) {
  const attempted = crypto.scryptSync(password, passwordHash.salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(attempted, 'hex'), Buffer.from(passwordHash.hash, 'hex'));
}

function signSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifySession(token) {
  const [encoded, signature] = String(token || '').split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return value.expiresAt > Date.now() ? value : null;
  } catch { return null; }
}

module.exports = { hashPassword, verifyPassword, signSession, verifySession };
