# ---- build stage: install everything, compile server + client ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage: production dependencies + compiled output only ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Railway injects PORT at runtime; the app reads it (default 3000 for local docker runs).
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
