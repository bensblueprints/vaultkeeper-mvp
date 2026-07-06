// Secrets-at-rest (AES-256-GCM keyed from SECRET_KEY) and the VK1 artifact
// encryption format.
//
// VK1 artifact format (documented — restore tooling depends on it):
//   bytes 0..2    magic "VK1"
//   bytes 3..18   salt (16 bytes, random per artifact)
//   bytes 19..30  IV (12 bytes, random per artifact)
//   bytes 31..46  GCM auth tag (16 bytes)
//   bytes 47..    AES-256-GCM ciphertext of the (optionally gzipped) dump
// Key derivation: scrypt(passphrase, salt, 32) with N=16384, r=8, p=1.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

export const VK1_MAGIC = Buffer.from('VK1');
export const VK1_HEADER_LEN = 47; // 3 magic + 16 salt + 12 iv + 16 tag
export const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

function masterKey() {
  const sk = process.env.SECRET_KEY;
  if (!sk) throw new Error('SECRET_KEY is not set — cannot encrypt/decrypt stored secrets');
  return crypto.createHash('sha256').update(sk).digest();
}

/** Encrypt a stored secret (connection password, S3 key, passphrase). */
export function encryptSecret(plain) {
  if (plain === null || plain === undefined || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return 'enc:v1:' + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

/** Decrypt a stored secret. Passes through legacy plaintext values unchanged. */
export function decryptSecret(stored) {
  if (!stored) return '';
  if (!stored.startsWith('enc:v1:')) return stored;
  const buf = Buffer.from(stored.slice('enc:v1:'.length), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function scryptKey(passphrase, salt) {
  return crypto.scryptSync(String(passphrase), salt, 32, SCRYPT_PARAMS);
}

/**
 * Stream `sourceStream` through optional transforms into a VK1-encrypted file.
 * Writes the header with a zeroed tag first, streams ciphertext, then patches
 * the real GCM tag into the header (offset 31).
 */
export async function writeVK1File(sourceStream, transforms, outPath, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = scryptKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const out = fs.createWriteStream(outPath);
  out.write(Buffer.concat([VK1_MAGIC, salt, iv, Buffer.alloc(16)]));
  await pipeline(sourceStream, ...transforms, cipher, out);

  const tag = cipher.getAuthTag();
  const fd = fs.openSync(outPath, 'r+');
  try {
    fs.writeSync(fd, tag, 0, 16, 31);
  } finally {
    fs.closeSync(fd);
  }
}

/** Decrypt a VK1 file into a writable stream (does NOT gunzip). */
export async function decryptVK1File(inPath, outStream, passphrase) {
  const fd = fs.openSync(inPath, 'r');
  const header = Buffer.alloc(VK1_HEADER_LEN);
  try {
    fs.readSync(fd, header, 0, VK1_HEADER_LEN, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (!header.subarray(0, 3).equals(VK1_MAGIC)) {
    throw new Error('Not a VK1 encrypted artifact (bad magic)');
  }
  const salt = header.subarray(3, 19);
  const iv = header.subarray(19, 31);
  const tag = header.subarray(31, 47);
  const key = scryptKey(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  await pipeline(fs.createReadStream(inPath, { start: VK1_HEADER_LEN }), decipher, outStream);
}

/** sha256 hex digest of a file (streams — no full buffering). */
export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}
