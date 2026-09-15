# ABOUTME: Dockerfile for the vox/parcel thumb renderer (Playwright + Chromium).
# ABOUTME: App Platform: expose 8080, set DATABASE_URL + UGC_ACCESS + UGC_SECRET.

FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate \
  && pnpm config set engine-strict false \
  && pnpm install --frozen-lockfile

COPY common/ ./common/
COPY src/ ./src/
COPY web/src/ ./web/src/
COPY web/types.ts ./web/types.ts
COPY vendor/ ./vendor/
COPY webpack/ ./webpack/
COPY renderer/ ./renderer/
COPY tsconfig.json tsconfig.prod.json ./
COPY dist/vendor/library-9.25.0.min.js ./dist/vendor/

# .env.production is gitignored; write the public CDN hosts webpack inlines.
RUN printf '%s\n' \
  'ASSET_PATH=https://www.voxels.com' \
  'IMG_HOST=https://cdn.cryptovoxels.com' \
  'SOUNDS_URL=https://img.cryptovoxels.com/sounds' \
  'MODELS_URL=https://cdn.cryptovoxels.com/models' \
  'TEXTURE_HOST=https://textures.voxels.com' \
  > .env.production

# Wearable page (esbuild) + parcel page (webpack, needs shaders)
RUN node renderer/build-page.mjs \
  && npx webpack --config webpack/webpack-preview.config.js --mode production

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PORT=8080
ENV ASSET_PATH=https://www.voxels.com
ENV IMG_HOST=https://cdn.cryptovoxels.com

EXPOSE 8080

CMD ["npx", "tsx", "renderer/src/index.ts"]
