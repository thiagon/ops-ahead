# syntax=docker/dockerfile:1.7
#
# Built from the repo root, like every other app image:
#   docker build -f apps/ui-gateway/Dockerfile -t <image> .

FROM node:24-trixie-slim AS base
WORKDIR /app
ENV CI=true

FROM base AS deps
COPY apps/ui-gateway/package.json apps/ui-gateway/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY apps/ui-gateway ./
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM base AS build
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY apps/ui-gateway/package.json apps/ui-gateway/package-lock.json apps/ui-gateway/tsconfig.json apps/ui-gateway/prisma.config.ts ./
COPY apps/ui-gateway/prisma ./prisma
COPY apps/ui-gateway/src ./src
# prisma.config.ts reads GATEWAY_DATABASE_URL via env(); generate does not
# connect. The PreSync Job and the app supply the real URL.
ENV GATEWAY_DATABASE_URL=postgres://gateway:gateway@127.0.0.1:5432/gateway
RUN npx prisma generate \
 && npm run build \
 && npm prune --omit=dev

FROM node:24-trixie-slim AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
COPY --from=build /app/package.json ./
EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]
