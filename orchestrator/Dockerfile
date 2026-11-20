# The orchestrator's image on Fly.io (fly.toml beside it). Node runs the .ts sources directly; the
# image holds only the orchestrator's code and production dependencies. The data volume is mounted
# at /data at runtime: no run folder, mirror or factory.db is ever baked in (.dockerignore).
FROM node:24-slim AS deps
WORKDIR /app
# better-sqlite3 falls back to building from source when no prebuilt binary fits.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-slim
# The orchestrator runs git (mirrors, bundles, pushes) and tar (skills for the runner).
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates tar && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Also a Fly secret; set here too so a `fly ssh console` session never falls back to ./data.
ENV NODE_ENV=production DATA_DIR=/data
# Last, so a new commit rebuilds only this layer. `factory status` shows them.
ARG FACTORY_COMMIT
ARG FACTORY_DEPLOYED_AT
ENV FACTORY_COMMIT=$FACTORY_COMMIT FACTORY_DEPLOYED_AT=$FACTORY_DEPLOYED_AT
CMD ["node", "src/server.ts"]
