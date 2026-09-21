# syntax=docker/dockerfile:1.7
#
# Built from the repo root, like every other app image:
#   docker build -f apps/ui-frontend/Dockerfile -t <image> .

FROM node:24-trixie-slim AS base
WORKDIR /app
ENV CI=true

FROM base AS deps
COPY apps/ui-frontend/package.json apps/ui-frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY apps/ui-frontend ./
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM base AS build
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY apps/ui-frontend ./
RUN npm run build \
 && npm prune --omit=dev

FROM node:24-trixie-slim AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./
EXPOSE 3000
USER node
CMD ["node_modules/.bin/react-router-serve", "./build/server/index.js"]
