# syntax=docker/dockerfile:1.7
#
# Built from the repo root, like every other app image:
#   docker build -f apps/ui-orchestrator/Dockerfile -t <image> .

FROM node:24-trixie-slim AS base
WORKDIR /app
ENV CI=true

FROM base AS deps
COPY apps/ui-orchestrator/package.json apps/ui-orchestrator/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY apps/ui-orchestrator/package.json apps/ui-orchestrator/package-lock.json apps/ui-orchestrator/tsconfig.json ./
COPY apps/ui-orchestrator/src ./src
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM base AS build
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY apps/ui-orchestrator/package.json apps/ui-orchestrator/package-lock.json apps/ui-orchestrator/tsconfig.json ./
COPY apps/ui-orchestrator/src ./src
RUN npm run build \
 && npm prune --omit=dev

FROM node:24-trixie-slim AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY apps/ui-orchestrator/package.json ./
EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]
