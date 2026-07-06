# Launch Strategy — Vaultkeeper

## Positioning

"Your databases, backed up nightly, encrypted, forever — for the price of one month elsewhere." The real competitor isn't only the SaaS (SimpleBackups $29–$99/mo, SnapShooter $10+/mo, Ottomatik $9+/mo) — it's the cron+bash script every sysadmin already has. Angle against cron: **your script doesn't alert you when it silently breaks.** Angle against SaaS: **your production credentials shouldn't live on someone else's cloud, and neither should $348/year.**

## Price math

- SimpleBackups: $29/mo → **$348/yr**. Vaultkeeper $39 once → **pays for itself in 6 weeks**.
- SnapShooter: $10/mo → $120/yr → pays for itself in under 4 months.
- Ottomatik: $9/mo → $108/yr → pays for itself in under 5 months.
- Suggested one-time price: **$39** (launch: $29 first week).

## Target communities

- **r/selfhosted** — sweet spot. Post as "I built a self-hosted SimpleBackups alternative (MIT)" with a screenshot and the VK1 open-format pitch. Rules: OSS + self-hosted posts welcome; lead with the GitHub repo, mention the paid installer only when asked.
- **r/PostgreSQL** — technical angle: "pg_dump scheduling with failure alerts and restore-command generation." Rules-aware: no naked self-promo — post as a "what I learned building a backup pipeline around pg_dump" write-up (version-skew handling, streaming sha256, never putting passwords on argv) with repo link.
- **r/sysadmin** — the "silent cron failure" war-story angle. Rules: strict on advertising — frame as discussion ("How do you get alerted when scheduled dumps fail?") and share the tool in comments when relevant.
- **r/devops** — retention/GFS + S3-compatible (B2/R2/MinIO) angle; devops crowd loves "runs in one container, all CLIs bundled."

## Show HN draft

**Title:** Show HN: I lost a database once. Now I sell the fix for $39, once.

Six weeks of silent cron failures cost me a client's database. The postmortem was embarrassing: the backup script had been exiting 1 since a password rotation, and nothing told us.

Vaultkeeper is the tool I wish had existed: a self-hosted Node app that runs pg_dump/mysqldump/mongodump/SQLite-backup on cron schedules, streams the dump through gzip + AES-256-GCM (or age), ships it to disk/S3/FTP, prunes by GFS-lite retention, and fires webhook/email alerts with the tool's stderr the moment a run fails.

Design choices HN might care about: passwords never touch argv (env / config-file passing); the encryption format is 47 bytes of documented header + scrypt, with a dependency-free decrypt script in the repo so backups outlive the software; SQLite uses the online backup API instead of copying a hot WAL file; sha256 is computed on the final artifact bytes, which is what a restore actually validates.

Source is MIT. The $39 buys the packaged installer — the monthly SaaS versions of this cost that every month.

## SEO keywords (10)

1. postgres backup tool
2. simplebackups alternative
3. mysql scheduled backup s3
4. self hosted database backup
5. encrypted db backups
6. pg_dump scheduler
7. mongodb backup automation
8. database backup to backblaze b2
9. sqlite backup tool windows
10. database backup failure alerts

## AppSumo / PitchGround pitch

Vaultkeeper turns the scariest silent failure in software — the backup that wasn't running — into a solved problem for a one-time $39. It schedules encrypted dumps of Postgres, MySQL, SQLite and MongoDB, ships them to any S3-compatible storage, FTP or local disk, prunes old copies automatically, and alerts the moment anything fails. Unlike SimpleBackups ($348+/year) it's self-hosted: credentials and data never leave the customer's infrastructure, the encryption format is open and documented, and the MIT source is on GitHub. Sumo-lings get lifetime updates, a Windows desktop app AND the Docker/VPS deployment — a genuine pay-once utility every agency, freelancer and indie hacker with a production database needs.
