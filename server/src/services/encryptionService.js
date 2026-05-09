/**
 * Generic AES-256-CBC encryption service.
 * Used by: backup system, integration credentials, webhook secrets.
 * NEVER expose keys or decrypted values in API responses or logs.
 */
const crypto = require("crypto");

const ALGORITHM = "aes-256-cbc";
const MOCK_KEY = "mock_encryption_key_32_bytes_ln_"; // 32 chars — dev only

function getKey() {
  const envKey = process.env.BACKUP_ENCRYPTION_KEY;
  if (envKey && envKey.length === 32) return envKey;
  if (process.env.NODE_ENV === "production") {
    throw new Error("BACKUP_ENCRYPTION_KEY (32 bytes) is required in production");
  }
  return MOCK_KEY;
}

/**
 * Encrypt any string or object.
 * Returns { encrypted: true, iv, encryptedData }
 */
function encryptPayload(payload) {
  const key = Buffer.from(getKey(), "utf-8");
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  let encrypted = cipher.update(text, "utf-8", "hex");
  encrypted += cipher.final("hex");
  return { encrypted: true, iv: iv.toString("hex"), encryptedData: encrypted };
}

/**
 * Decrypt a previously encrypted envelope.
 * Returns the original string or parsed JSON.
 */
function decryptPayload(envelope) {
  if (!envelope || !envelope.encrypted) {
    throw new Error("Payload is not an encrypted envelope");
  }
  const key = Buffer.from(getKey(), "utf-8");
  const iv = Buffer.from(envelope.iv, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(envelope.encryptedData, "hex", "utf-8");
  decrypted += decipher.final("utf-8");
  try {
    return JSON.parse(decrypted);
  } catch {
    return decrypted; // return raw string if not JSON
  }
}

// ---------------------------------------------------------------------------
// Backward-compat aliases used by backupEncryptionService callers
// ---------------------------------------------------------------------------
const encryptBackupPayload = encryptPayload;
const decryptBackupPayload = async (envelope) => decryptPayload(envelope);

module.exports = {
  encryptPayload,
  decryptPayload,
  // legacy aliases — keeps backup pipeline working without changes
  encryptBackupPayload,
  decryptBackupPayload,
};
