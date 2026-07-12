# 🔐 Vaultkeeper

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)

**Scheduled, encrypted database backups you actually own.** Dump PostgreSQL, MySQL, SQLite and MongoDB on a cron schedule, compress + encrypt, ship to local disk / any S3-compatible bucket / FTP, prune by retention policy — and get alerted the moment a backup fails.

> Your databases, backed up nightly, encrypted, forever — for the price of one month elsewhere.

**Pay once. Own it forever. No subscription.** SimpleBackups charges $29–$99/month for this. Vaultkeeper is $39, once, and runs on your own hardware.

![Vaultkeeper dashboard](docs/screenshot.png)

## Features

- **Four engines** — PostgreSQL (`pg_dump`), MySQL/MariaDB (`mysqldump`), MongoDB (`mongodump --archive`), and SQLite via the online backup API (no CLI needed, safe on live WAL databases).
- **Real scheduling** — cron expressions with presets (hourly/daily/weekly), per-job timezone, next-3-runs preview, per-job concurrent-run lock.
- **Streamed pipeline** — dump → gzip → encrypt → destination, streaming end to end. Size, duration and sha256 recorded per run.
- **Encryption you can restore without us** — `age` if installed, or built-in AES-256-GCM with a documented open format (`VK1` header, scrypt key derivation) and a dependency-free `scripts/vk-decrypt.js` so your backups are never hostage.
- **Three destination types** — local directory, S3-compatible (AWS, Backblaze B2, Cloudflare R2, MinIO — multipart uploads), FTP/FTPS.
- **GFS-lite retention** — keep last N, plus daily-for-X-days and weekly-for-Y-weeks. Pruning runs on the destination after every successful backup.
- **Alerts that catch silent failures** — webhook POST (Slack/Discord-compatible JSON) + SMTP email on failure (optionally on success), with the dump tool's stderr tail included.
- **Restore helper** — one click generates the exact download → decrypt → gunzip → `psql`/`mysql`/`mongorestore` command chain for any stored run, plus server-side decrypted downloads.
- **Tool check panel** — probes PATH for engine CLIs and shows found/missing with install hints; per-source custom binary paths supported.
- **Secrets encrypted at rest** — connection passwords, S3 keys and passphrases are AES-256-GCM encrypted in SQLite, keyed from a `SECRET_KEY` generated on first run. Passwords are never passed on argv.
- **100% local** — no telemetry, no cloud, no third party touching your data.

## Quick start

```bash
npm i
cp .env.example .env   # set ADMIN_PASSWORD
npm run build
npm start              # → http://localhost:5323
```

### Desktop app or $5 VPS — your choice

Run it as a desktop app, or deploy to a $5 VPS when you need it public.

- **Desktop mode:** `npm run desktop` — an Electron window boots the same server locally (data in your OS profile, auto-logged-in as admin). `npm run dist` builds a Windows installer.
- **Server mode:** `npm start` behind a reverse proxy, or `docker compose up -d` — the Docker image bundles all four engine CLIs + `age` (≈450 MB because of them; slim it down in the Dockerfile if you only use one engine).

## Vaultkeeper vs. the monthly guys

| | **Vaultkeeper** | SimpleBackups | SnapShooter | Ottomatik |
|---|---|---|---|---|
| Price | **$39 once** | $29–$99/mo | $10+/mo | $9+/mo |
| Cost over 3 years | **$39** | $1,044+ | $360+ | $324+ |
| Postgres / MySQL / Mongo / SQLite | ✅ all four | ✅ | ✅ | ✅ |
| Your credentials stay on your box | ✅ | ❌ cloud | ❌ cloud | ❌ cloud |
| Encryption format you can decrypt yourself | ✅ documented `VK1` + age | partial | partial | ❌ |
| Works fully offline | ✅ | ❌ | ❌ | ❌ |
| Failure alerts (webhook + email) | ✅ | ✅ | ✅ | ✅ |
| Source code | ✅ MIT | ❌ | ❌ | ❌ |

## ☕ Skip the setup — get the 1-click installer

Want the packaged, signed installer with everything pre-wired? Grab the one-time convenience version:

**→ [https://whop.com/benjisaiempire/vaultkeeper](https://whop.com/benjisaiempire/vaultkeeper)**

Same code, zero setup, and it funds development.

## Engine prerequisites

Vaultkeeper shells out to the official dump tools (the Settings page shows what's found on PATH):

| Engine | Tool | Notes |
|---|---|---|
| PostgreSQL | `pg_dump` | Match the client major version to your server to avoid version-skew errors |
| MySQL/MariaDB | `mysqldump` | Password passed via `MYSQL_PWD` env, never argv |
| MongoDB | `mongodump` | Password via temp config file, never argv |
| SQLite | *(none)* | Built-in online backup API — consistent snapshots of live WAL databases |
| Encryption | `age` *(optional)* | Built-in AES-256-GCM used otherwise |

## The VK1 encrypted format (yours forever)

`{job}_{engine}_{YYYY-MM-DD_HHmmss}.dump.gz.enc` files are:

```
"VK1" (3 bytes) | salt (16) | iv (12) | GCM tag (16) | AES-256-GCM ciphertext
key = scrypt(passphrase, salt, 32, {N:16384, r:8, p:1})
```

Decrypt anywhere with zero dependencies:

```bash
VK_PASSPHRASE='...' node scripts/vk-decrypt.js backup.dump.gz.enc backup.dump.gz
gunzip backup.dump.gz
```

## Tech stack

Node 20+ · Express · better-sqlite3 · React 18 (Vite) · Tailwind CSS 4 · Framer Motion · Lucide · `@aws-sdk/client-s3` · basic-ftp · nodemailer · cron-parser · Electron (desktop mode)

## Testing

```bash
npm test
```

The smoke test boots the real server, creates a 50-row SQLite fixture, runs the full pipeline (gzip + AES-256-GCM → local destination), then **decrypts and restores the artifact and counts the rows back** — plus retention pruning, failure webhooks, encrypted-secrets-at-rest and auth checks. No external database daemons required.

## License

[MIT](LICENSE) © 2026 Ben ([bensblueprints](https://github.com/bensblueprints))
