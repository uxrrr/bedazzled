import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const IV_LEN = 12;
const TAG_LEN = 16;
const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const b64 = process.env.PHOTO_ENC_KEY;
  if (!b64) throw new Error("PHOTO_ENC_KEY env var is not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("PHOTO_ENC_KEY must decode to 32 bytes");
  return key;
}

/**
 * Encrypts plaintext into a single buffer laid out as:
 *   iv (12 bytes) || authTag (16 bytes) || ciphertext
 * aad binds the ciphertext to a specific item/photo id so blobs can't be
 * swapped between records even by someone with raw Blobs read access.
 */
export function encrypt(plaintext: Buffer, aad: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

export function decrypt(blob: Buffer, aad: string): Buffer {
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptJson(obj: unknown, aad: string): Buffer {
  return encrypt(Buffer.from(JSON.stringify(obj), "utf8"), aad);
}

export function decryptJson<T>(blob: Buffer, aad: string): T {
  return JSON.parse(decrypt(blob, aad).toString("utf8")) as T;
}
