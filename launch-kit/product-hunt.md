# Product Hunt Launch — Vaultkeeper

## Name
Vaultkeeper

## Tagline (60 chars)
Scheduled, encrypted DB backups you own. $39 once, no SaaS.

## Description (260 chars)
Vaultkeeper backs up Postgres, MySQL, SQLite & MongoDB on a cron schedule — compressed, AES/age encrypted, shipped to local disk, S3 or FTP, pruned by retention policy, with instant failure alerts. Self-hosted or desktop. Pay $39 once instead of $29/mo forever.

## Full description

Every database backup SaaS wants $9–$99 a month to run `pg_dump` on a timer. And the DIY alternative — a cron script — fails silently until the day you actually need the backup.

Vaultkeeper is both fixed:

🗄️ **Four engines** — Postgres, MySQL/MariaDB, MongoDB, and SQLite (via the online backup API, safe on live databases — no CLI needed).

⏰ **Real scheduling** — cron expressions with presets, timezone support, next-runs preview, per-job locks.

🔐 **Encryption you control** — age, or built-in AES-256-GCM with a fully documented open format and a dependency-free decrypt script. Your backups are never hostage to our software.

📦 **Destinations** — local disk, any S3-compatible bucket (AWS, B2, R2, MinIO), FTP/FTPS.

♻️ **GFS-lite retention** — keep last N + daily for X days + weekly for Y weeks, pruned automatically on the destination.

🚨 **Alerts on failure** — webhook + email with the dump tool's stderr, so a broken backup never goes unnoticed.

🧰 **Restore helper** — one click gives you the exact command chain to get your data back.

Runs as a desktop app (Electron) or on a $5 VPS (Docker). 100% local, MIT-licensed source, zero telemetry.

$39 once. SimpleBackups is $348+/year for the same job.

## Maker first comment

Hey PH 👋

I lost a client database once. The cron backup script had been failing for six weeks — nobody knew, because cron doesn't send Slack messages when `pg_dump` exits 1.

The SaaS fixes (SimpleBackups, SnapShooter, Ottomatik) all wanted a monthly subscription for what is fundamentally a scheduler + dump tool + uploader. And they wanted my production database credentials on their cloud, which never sat right with me.

So I built Vaultkeeper: a self-hosted app that dumps your databases on schedule, gzips and encrypts them, ships them to disk/S3/FTP, prunes old ones, and screams at you the moment a run fails. The encryption format is documented in the README and there's a zero-dependency decrypt script — if my software disappears tomorrow, your backups still open.

The code is MIT on GitHub. The $39 gets you the packaged 1-click installer and funds development. One month of the competition, forever.

Honest limitations: it shells out to the official dump tools, so you need pg_dump/mysqldump/mongodump installed for those engines (SQLite works with nothing installed — and the Docker image bundles all of them). Restore is a guided command chain, not one-click — I'd rather you see exactly what touches your production DB.

Ask me anything — especially horror stories about backups that weren't there. 🪦

## Gallery shots (5)

1. **Dashboard** — job cards with status badges, last/next run, size-trend sparklines, dark UI. Caption: "Every database, every schedule, one glance."
2. **Job wizard, schedule step** — cron presets + next-3-runs preview. Caption: "Cron without the guesswork."
3. **Restore helper modal** — the copyable download → decrypt → gunzip → psql chain. Caption: "Restores you can read before you run."
4. **Failure alert** — Slack webhook message showing job name, error and stderr tail. Caption: "Backups that fail loudly."
5. **Comparison table** — $39 once vs $348+/yr, credentials stay local. Caption: "One month of theirs buys a lifetime of yours."
