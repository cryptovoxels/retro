# ABOUTME: Thumb renderer. Playwright base stays. Final stage is the bundle, not the monorepo.
# ABOUTME: index.js sits in renderer/src so __dirname still finds page/ and dist/vendor.

FROM node:25-slim AS build
WORKDIR /app
RUN npm i -g pnpm@9.15.4
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN printf '%s\n' \
  'ASSET_PATH=https://www.voxels.com' \
  'IMG_HOST=https://cdn.cryptovoxels.com' \
  'SOUNDS_URL=https://img.cryptovoxels.com/sounds' \
  'MODELS_URL=https://cdn.cryptovoxels.com/models' \
  'TEXTURE_HOST=https://textures.voxels.com' \
  > .env.production
RUN node renderer/build-page.mjs && node scripts/bundle-node.mjs renderer

FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app/dist/renderer.js /app/renderer/src/index.js
COPY --from=build /app/renderer/page /app/renderer/page
COPY --from=build /app/dist/vendor /app/dist/vendor
RUN npm install --omit=dev playwright@1.62.1
EXPOSE 8080
CMD ["node", "renderer/src/index.js"]
