# Xianslate WEB + TRANSLATION-WORKER IMAGE (adapter-node server).
#
# Both Fly process groups run this same image: `web` serves HTTP; `translation-worker` sets
# RUN_TRANSLATE_WORKER=1 (see fly.toml) so hooks.server.ts starts the BullMQ worker in-process.
#
# NOTE ON CHROMIUM: the spec's target topology is a *slim* web/worker image with a SEPARATE Chromium
# scraper app (Dockerfile.scraper). The fetcher currently scrapes IN-PROCESS (Playwright headless.ts), so
# this image installs Chromium to be deployable today. Once the scraper is extracted behind an HTTP call,
# drop the `playwright install` line + the apt deps to get the slim image. See DEPLOYMENT.md.

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
# CHROMIUM + ITS SYSTEM DEPS FOR THE IN-PROCESS SCRAPER (Playwright). REMOVE WHEN THE SCRAPER IS SPLIT OUT.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
RUN npx playwright install --with-deps chromium
EXPOSE 3000
# adapter-node ENTRY. RUN MIGRATIONS OUT-OF-BAND (`yarn db:migrate`) BEFORE/ON DEPLOY — NOT AT BOOT.
CMD ["node", "build"]
