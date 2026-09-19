# =============================================================================
# API dan worker. Satu image, dua entrypoint berbeda (lihat docker-compose).
# =============================================================================
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# libvips dibutuhkan sharp untuk memproses gambar (membuang EXIF, encode ulang).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --no-audit --no-fund

FROM deps AS build
WORKDIR /app
COPY tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY src ./src
COPY cli ./cli
RUN npx prisma generate && npx tsc -p tsconfig.build.json

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY prisma ./prisma

# Klien Prisma hasil generate ikut di node_modules; regenerate agar cocok
# dengan binary target image ini.
RUN npx prisma generate

USER node

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/src/main.js"]
