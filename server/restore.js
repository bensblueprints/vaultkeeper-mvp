// Restore helper: generates the exact copy-pasteable command chain to turn a
// stored artifact back into a live database.
export function restoreCommands({ run, job, source, dest, destConfig }) {
  const name = run.artifact_name;
  const lines = [];
  lines.push(`# Restore guide for ${name}`);
  lines.push(`# Job: ${job.name} · Engine: ${source.engine} · Destination: ${dest.name} (${dest.type})`);
  lines.push(`# sha256: ${run.sha256 || '(unknown)'}`);
  lines.push('');

  // 1. download
  lines.push('# 1) Get the artifact locally (or use the Download button in Vaultkeeper)');
  if (dest.type === 'local') {
    lines.push(`cp "${(destConfig.path || '.').replace(/\\/g, '/')}/${name}" .`);
  } else if (dest.type === 's3') {
    const key = destConfig.prefix ? `${String(destConfig.prefix).replace(/\/+$/, '')}/${name}` : name;
    const ep = destConfig.endpoint ? ` --endpoint-url ${destConfig.endpoint}` : '';
    lines.push(`aws s3 cp "s3://${destConfig.bucket}/${key}" .${ep}`);
  } else if (dest.type === 'ftp') {
    lines.push(`# FTP: download ${destConfig.basePath ? destConfig.basePath + '/' : ''}${name} from ${destConfig.host}`);
    lines.push(`curl -O "ftp://${destConfig.host}/${destConfig.basePath ? destConfig.basePath + '/' : ''}${name}" --user "<user>:<pass>"`);
  }
  lines.push('');

  // 2. decrypt
  let current = name;
  if (job.encrypt_mode === 'aes') {
    const next = current.replace(/\.enc$/, '');
    lines.push('# 2) Decrypt (Vaultkeeper VK1 format: "VK1" magic | 16B salt | 12B iv | 16B tag | AES-256-GCM ciphertext,');
    lines.push('#    key = scrypt(passphrase, salt, 32, {N:16384, r:8, p:1}))');
    lines.push(`VK_PASSPHRASE='<your passphrase>' node scripts/vk-decrypt.js "${current}" "${next}"`);
    lines.push('');
    current = next;
  } else if (job.encrypt_mode === 'age') {
    const next = current.replace(/\.age$/, '');
    lines.push('# 2) Decrypt with your age identity key');
    lines.push(`age -d -i key.txt -o "${next}" "${current}"`);
    lines.push('');
    current = next;
  }

  // 3. decompress
  if (job.compress) {
    const next = current.replace(/\.gz$/, '');
    lines.push('# 3) Decompress');
    lines.push(`gunzip "${current}"`);
    lines.push('');
    current = next;
  }

  // 4. restore per engine
  lines.push('# 4) Restore into the database');
  const host = source.host ? ` -h ${source.host}` : '';
  if (source.engine === 'postgres') {
    const port = source.port ? ` -p ${source.port}` : '';
    const user = source.username ? ` -U ${source.username}` : '';
    lines.push(`psql${host}${port}${user} -d ${source.database} -f "${current}"`);
    lines.push(`# (pg_dump plain format — for a fresh database run: createdb ${source.database} first)`);
  } else if (source.engine === 'mysql') {
    const port = source.port ? ` -P ${source.port}` : '';
    const user = source.username ? ` -u ${source.username}` : '';
    lines.push(`mysql${host}${port}${user} -p ${source.database} < "${current}"`);
  } else if (source.engine === 'mongo') {
    const port = source.port ? ` --port ${source.port}` : '';
    const user = source.username ? ` --username ${source.username} --authenticationDatabase admin` : '';
    lines.push(`mongorestore --archive="${current}"${host ? ` --host ${source.host}` : ''}${port}${user} --drop`);
  } else if (source.engine === 'sqlite') {
    lines.push(`# The artifact IS the SQLite database file — stop your app, then copy it into place:`);
    lines.push(`cp "${current}" "${source.sqlite_path || '/path/to/your.db'}"`);
  }
  return lines.join('\n') + '\n';
}
