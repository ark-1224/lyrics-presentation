# ---- build stage: install everything, compile server + client ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 ships prebuilt binaries; these tools are only a fallback if it must compile.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
# Drop dev dependencies but keep the compiled better-sqlite3 binary in node_modules.
RUN npm prune --omit=dev

# ---- runtime stage: production dependencies + compiled output only ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Railway injects PORT at runtime; the app reads it (default 3000 for local docker runs).
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
