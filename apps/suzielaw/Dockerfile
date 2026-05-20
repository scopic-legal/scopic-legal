# syntax=docker/dockerfile:1.6
FROM node:20-bookworm-slim AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /repo

# This build context must contain both repos side by side.
# The app depends on shared packages from open_teamsuzie.
COPY open_teamsuzie/ open_teamsuzie/
COPY suzielaw/ suzielaw/

WORKDIR /repo/open_teamsuzie
RUN pnpm install --frozen-lockfile=false && pnpm --filter "./packages/*" build

WORKDIR /repo/suzielaw
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @scopic/assistant-client exec vite build
RUN pnpm --filter @scopic/assistant build

FROM node:20-bookworm-slim
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY --from=builder /repo/open_teamsuzie /repo/open_teamsuzie
COPY --from=builder /repo/suzielaw /repo/suzielaw

WORKDIR /repo/suzielaw/apps/suzielaw
ENV NODE_ENV=production
EXPOSE 17501
CMD ["node", "dist/index.js"]
