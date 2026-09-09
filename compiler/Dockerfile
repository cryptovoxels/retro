# ABOUTME: Parcel compiler worker - rehosts parcel assets to UGC on a loop.
# ABOUTME: App Platform: DATABASE_URL + UGC_ACCESS + UGC_SECRET + texture bucket creds optional.

FROM node:25-bookworm-slim

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate \
  && pnpm config set engine-strict false \
  && pnpm install --frozen-lockfile

COPY common/ ./common/
COPY server/ ./server/
COPY compiler/ ./compiler/
COPY tsconfig.json tsconfig.prod.json ./

ENV PORT=8081
ENV ASSET_PATH=https://www.voxels.com
ENV IMG_HOST=https://cdn.cryptovoxels.com
ENV TEXTURE_BUCKET=https://textures.sfo2.cdn.digitaloceanspaces.com

EXPOSE 8081

CMD ["npx", "tsx", "compiler/src/index.ts"]
