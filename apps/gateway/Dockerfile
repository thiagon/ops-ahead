# Build context is the repo root (CI: docker build -f apps/gateway/Dockerfile .).
# gateway is a standalone npm project, not part of the uv workspace.
FROM node:22-slim AS base
WORKDIR /app

# --- deps: full install (incl. dev) against the lockfile, cached on manifests ---
FROM base AS deps
COPY apps/gateway/package.json apps/gateway/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# --- build: compile TypeScript to dist/ ---
FROM deps AS build
COPY apps/gateway/tsconfig.json ./
COPY apps/gateway/src ./src
RUN npm run build

# --- prod-deps: production-only node_modules for a slim runtime ---
FROM base AS prod-deps
COPY apps/gateway/package.json apps/gateway/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# --- runtime: slim, non-root ---
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY apps/gateway/package.json ./
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
