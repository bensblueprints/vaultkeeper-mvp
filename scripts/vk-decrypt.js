#!/usr/bin/env node
// Standalone decryptor for Vaultkeeper VK1 artifacts. No dependencies — you
// can restore your backups even without Vaultkeeper installed.
//
//   VK_PASSPHRASE='...' node scripts/vk-decrypt.js backup.dump.gz.enc backup.dump.gz
//
// VK1 format: "VK1" magic | 16B salt | 12B iv | 16B GCM tag | AES-256-GCM
// ciphertext. Key = scrypt(passphrase, salt, 32, {N:16384, r:8, p:1}).
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

const [inPath, outPath] = process.argv.slice(2);
const passphrase = process.env.VK_PASSPHRASE;

if (!inPath || !outPath || !passphrase) {
  console.error("Usage: VK_PASSPHRASE='...' node scripts/vk-decrypt.js <in.enc> <out>");
  process.exit(1);
}

const HEADER_LEN = 47;
const fd = fs.openSync(inPath, 'r');
const header = Buffer.alloc(HEADER_LEN);
fs.readSync(fd, header, 0, HEADER_LEN, 0);
fs.closeSync(fd);

if (header.subarray(0, 3).toString() !== 'VK1') {
  console.error('Not a VK1 artifact (bad magic) — is this file encrypted by Vaultkeeper?');
  process.exit(1);
}
const salt = header.subarray(3, 19);
const iv = header.subarray(19, 31);
const tag = header.subarray(31, 47);
const key = crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(tag);

try {
  await pipeline(fs.createReadStream(inPath, { start: HEADER_LEN }), decipher, fs.createWriteStream(outPath));
  console.log(`Decrypted → ${outPath}`);
} catch (e) {
  fs.rmSync(outPath, { force: true });
  console.error('Decryption failed (wrong passphrase or corrupted file):', e.message);
  process.exit(1);
}
