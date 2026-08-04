# Xianslate WEB IMAGE (adapter-node server). One image serves HTTP and runs translations in-process —
# no Redis/queue/worker, and no Chromium (the fetcher is HTTP-only: node fetch + a curl fallback).

# ---- build stage ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build
# PRUNE TO PRODUCTION DEPS FOR A SMALLER RUNTIME node_modules.
RUN yarn install --frozen-lockfile --production && yarn cache clean

# ---- runtime stage ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
# THE FETCHER'S BOT-WALL FALLBACK (AND THE FREE PATH WHEN ZYTE IS DOWN/UNCONFIGURED) SHELLS OUT TO curl,
# WHICH bookworm-slim OMITS — INSTALL IT SO direct→curl WORKS. (ZYTE, WHEN SET, IS THE PRIMARY TRANSPORT.)
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
EXPOSE 3000
# adapter-node ENTRY. RUN MIGRATIONS OUT-OF-BAND (`yarn db:migrate`) BEFORE/ON DEPLOY — NOT AT BOOT.
CMD ["node", "build"]
