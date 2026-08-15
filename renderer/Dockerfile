# ABOUTME: Dockerfile for the vox thumb renderer (Playwright + Chromium).
# ABOUTME: App Platform: expose 8080, set DATABASE_URL + UGC_ACCESS + UGC_SECRET.

FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate \
  && pnpm config set engine-strict false \
  && pnpm install --frozen-lockfile

COPY common/ ./common/
COPY src/monoworker/ ./src/monoworker/
COPY renderer/ ./renderer/

RUN node renderer/build-page.mjs

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PORT=8080

EXPOSE 8080

CMD ["npx", "tsx", "renderer/src/index.ts"]
