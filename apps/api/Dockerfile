# syntax=docker/dockerfile:1

# Production API (+ worker) image — linux/amd64
FROM --platform=linux/amd64 node:22-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.15.0 --activate
WORKDIR /app

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.3.3 prune @einvoice/api --docker

FROM base AS installer
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/.npmrc ./.npmrc
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# turbo prune omits root shared configs; packages extend ../../tsconfig.base.json
COPY --from=pruner /app/tsconfig.base.json /app/turbo.json ./
RUN pnpm --filter @einvoice/shared build \
  && pnpm --filter @einvoice/eta-core build \
  && pnpm --filter @einvoice/api exec prisma generate \
  && pnpm --filter @einvoice/api build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app
COPY --from=installer /app /app
WORKDIR /app/apps/api
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health/live" || exit 1
CMD ["node", "dist/main.js"]
