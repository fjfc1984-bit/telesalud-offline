const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Field-level encryption at rest for patient-identifying columns (name, document, phone).
// The key is read from TELESALUD_ENCRYPTION_KEY (production) or, for local/demo runs,
// generated once and persisted under data/ so restarts don't lose access to existing rows.
// This is a stand-in for a real secrets manager (KMS/Vault) — swap KEY_SOURCE before any
// real deployment; see docs/CUMPLIMIENTO_SUH.md.
const KEY_FILE = path.join(__dirname, '..', 'data', '.encryption_key');

function loadOrCreateKey() {
  if (process.env.TELESALUD_ENCRYPTION_KEY) {
    return Buffer.from(process.env.TELESALUD_ENCRYPTION_KEY, 'hex');
  }
  if (fs.existsSync(KEY_FILE)) {
    return Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
  }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
  console.warn('[crypto] Generada una llave de cifrado local de demostración en data/.encryption_key. ' +
    'En producción, defina TELESALUD_ENCRYPTION_KEY desde un gestor de secretos y no la guarde en disco.');
  return key;
}

const KEY = loadOrCreateKey();
const ALGO = 'aes-256-gcm';

function encryptField(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

function decryptField(stored) {
  if (!stored) return null;
  try {
    const raw = Buffer.from(stored, 'base64');
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null; // dato corrupto o cifrado con una llave distinta
  }
}

// Password/PIN hashing for professional login (scrypt, no external dependency).
function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pin, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPin(pin, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pin, salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// AES-GCM uses a random IV per call, so the same document number encrypts differently every
// time — correct for confidentiality, but it means we can't look up "this patient's past
// encounters" with a plain WHERE on the encrypted column. hashLookup gives a deterministic,
// non-reversible blind index for that one purpose: equality search, never decryption.
function hashLookup(value) {
  if (!value) return null;
  return crypto.createHmac('sha256', KEY).update(String(value).trim().toLowerCase()).digest('hex');
}

const JWT_SECRET_FILE = path.join(__dirname, '..', 'data', '.jwt_secret');

function loadOrCreateJwtSecret() {
  if (process.env.TELESALUD_JWT_SECRET) return process.env.TELESALUD_JWT_SECRET;
  if (fs.existsSync(JWT_SECRET_FILE)) return fs.readFileSync(JWT_SECRET_FILE, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(path.dirname(JWT_SECRET_FILE), { recursive: true });
  fs.writeFileSync(JWT_SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}

const JWT_SECRET = loadOrCreateJwtSecret();

module.exports = { encryptField, decryptField, hashPin, verifyPin, hashLookup, JWT_SECRET };
