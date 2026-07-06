// Destination adapters: local directory, S3-compatible, FTP/FTPS.
// Every adapter exposes: test(), putFile(localPath, name), list(prefix),
// remove(name), downloadTo(name, localPath).
import fs from 'node:fs';
import path from 'node:path';
import { decryptSecret } from './crypto.js';

export function destinationConfig(dest) {
  try {
    return JSON.parse(decryptSecret(dest.config_enc) || '{}');
  } catch {
    return {};
  }
}

export function createAdapter(dest) {
  const config = destinationConfig(dest);
  if (dest.type === 'local') return localAdapter(config);
  if (dest.type === 's3') return s3Adapter(config);
  if (dest.type === 'ftp') return ftpAdapter(config);
  throw new Error(`Unknown destination type: ${dest.type}`);
}

/* ---------------- local directory ---------------- */

function localAdapter(config) {
  const dir = config.path;
  if (!dir) throw new Error('Local destination has no path configured');
  return {
    async test() {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, `.vk-probe-${Date.now()}`);
      fs.writeFileSync(probe, 'ok');
      fs.rmSync(probe, { force: true });
      return { ok: true, detail: `Writable: ${dir}` };
    },
    async putFile(localPath, name) {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(localPath, path.join(dir, name));
    },
    async list(prefix) {
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((f) => f.startsWith(prefix))
        .map((f) => {
          const st = fs.statSync(path.join(dir, f));
          return { name: f, size: st.size, mtime: st.mtimeMs };
        });
    },
    async remove(name) {
      fs.rmSync(path.join(dir, name), { force: true });
    },
    async downloadTo(name, localPath) {
      fs.copyFileSync(path.join(dir, name), localPath);
    }
  };
}

/* ---------------- S3-compatible (AWS, B2, R2, MinIO) ---------------- */

function s3Adapter(config) {
  const { endpoint, region, bucket, prefix = '', accessKeyId, secretAccessKey, forcePathStyle } = config;
  if (!bucket) throw new Error('S3 destination has no bucket configured');
  const key = (name) => (prefix ? `${prefix.replace(/\/+$/, '')}/${name}` : name);

  async function client() {
    const { S3Client } = await import('@aws-sdk/client-s3');
    return new S3Client({
      region: region || 'us-east-1',
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle: forcePathStyle !== false && !!endpoint,
      credentials: { accessKeyId, secretAccessKey }
    });
  }

  return {
    async test() {
      const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      const c = await client();
      await c.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, MaxKeys: 1 }));
      return { ok: true, detail: `Bucket reachable: ${bucket}` };
    },
    async putFile(localPath, name) {
      const { Upload } = await import('@aws-sdk/lib-storage');
      const c = await client();
      // Multipart upload — streams, no full-file buffering.
      const upload = new Upload({
        client: c,
        params: { Bucket: bucket, Key: key(name), Body: fs.createReadStream(localPath) }
      });
      await upload.done();
    },
    async list(listPrefix) {
      const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      const c = await client();
      const out = [];
      let ContinuationToken;
      do {
        const res = await c.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: key(listPrefix), ContinuationToken })
        );
        for (const obj of res.Contents || []) {
          out.push({ name: obj.Key.split('/').pop(), size: obj.Size, mtime: new Date(obj.LastModified).getTime() });
        }
        ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (ContinuationToken);
      return out;
    },
    async remove(name) {
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      const c = await client();
      await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: key(name) }));
    },
    async downloadTo(name, localPath) {
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const { pipeline } = await import('node:stream/promises');
      const c = await client();
      const res = await c.send(new GetObjectCommand({ Bucket: bucket, Key: key(name) }));
      await pipeline(res.Body, fs.createWriteStream(localPath));
    }
  };
}

/* ---------------- FTP / FTPS ---------------- */

function ftpAdapter(config) {
  const { host, port = 21, user, pass, secure = false, basePath = '' } = config;
  if (!host) throw new Error('FTP destination has no host configured');

  async function withClient(fn) {
    const { Client } = await import('basic-ftp');
    const client = new Client(30000);
    try {
      await client.access({ host, port, user, password: pass, secure });
      if (basePath) {
        await client.ensureDir(basePath);
        await client.cd(basePath);
      }
      return await fn(client);
    } finally {
      client.close();
    }
  }

  return {
    test: () => withClient(async (c) => ({ ok: true, detail: `Connected: ${await c.pwd()}` })),
    putFile: (localPath, name) => withClient((c) => c.uploadFrom(localPath, name)),
    list: (prefix) =>
      withClient(async (c) => {
        const entries = await c.list();
        return entries
          .filter((e) => e.isFile && e.name.startsWith(prefix))
          .map((e) => ({ name: e.name, size: e.size, mtime: e.modifiedAt ? e.modifiedAt.getTime() : 0 }));
      }),
    remove: (name) => withClient((c) => c.remove(name)),
    downloadTo: (name, localPath) => withClient((c) => c.downloadTo(localPath, name))
  };
}
