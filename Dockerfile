# Vaultkeeper — self-hosted scheduled database backups.
# The runtime image includes all four engine CLIs + age, so every source type
# works out of the box. That makes the image bigger (~450 MB) — trim the
# apt-get line to only the engines you use if size matters.
FROM node:20-bookworm-slim AS build
WORKDIR /app
# python3-setuptools: better-sqlite3 has no prebuilt binary for every Node
# patch version, so it can fall back to compiling from source, which needs
# a full toolchain including the distutils shim newer Python drops by default.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-setuptools make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

# Engine CLIs: pg_dump, mysqldump, mongodump, sqlite3 + age encryption, plus
# python3-setuptools for better-sqlite3's native build fallback (see build stage).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-setuptools make g++ \
      postgresql-client \
      default-mysql-client \
      sqlite3 \
      age \
      wget ca-certificates \
    && wget -q https://fastdl.mongodb.org/tools/db/mongodb-database-tools-debian12-x86_64-100.10.0.deb -O /tmp/mongotools.deb \
    && apt-get install -y /tmp/mongotools.deb \
    && rm /tmp/mongotools.deb \
    && apt-get purge -y wget \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY scripts ./scripts
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY --from=build /app/dist ./dist

# /app/data: SQLite app db · /backups: default local destination dir
VOLUME ["/app/data", "/backups"]
ENV DB_PATH=/app/data/vaultkeeper.db
ENV BACKUP_TMP_DIR=/app/data/tmp
EXPOSE 5323
CMD ["node", "server/index.js"]
