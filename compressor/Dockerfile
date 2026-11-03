# ABOUTME: Texture compressor. Sharp decodes the first frame; GPU encoders run separately.
# ABOUTME: amd64 because texture-compressor ships x86 binaries.

FROM node:25-slim AS build
WORKDIR /app
RUN npm i -g pnpm@9.15.4
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN node scripts/bundle-node.mjs compressor

FROM debian:bookworm-slim AS pvr
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -fL --retry 3 'https://developer.imaginationtech.com/download/8558/?tmstv=1706603903' -o /tmp/pvr.sh \
    && echo 'f25e8313c8df8a9367d88d1ac94c8581adbeb3310384e908af74c16431805b12  /tmp/pvr.sh' | sha256sum -c - \
    && mkdir /opt/pvr \
    && sh /tmp/pvr.sh --skip-license --exclude-subdir --prefix=/opt/pvr

FROM --platform=linux/amd64 node:25-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist/compressor.js /app/compressor.js
RUN npm install --omit=dev sharp@0.34.5 texture-compressor@1.0.2
COPY --from=pvr /opt/pvr/CLI/Linux_x86_64/PVRTexToolCLI /usr/local/bin/PVRTexToolCLI
# Verify the pinned CLI runs and still writes each required KTX format.
RUN node -e "require('sharp')({create:{width:16,height:16,channels:4,background:'red'}}).png().toFile('/tmp/pvr.png')" \
    && for format in ASTC_4x4 ASTC_8x8 ETC2_RGB ETC2_RGBA PVRTC1_2 PVRTC1_4; do \
         PVRTexToolCLI -i /tmp/pvr.png -o /tmp/pvr.ktx -f "$format" -j 1 -m 5 || exit 1; \
       done \
    && rm /tmp/pvr.png /tmp/pvr.ktx
EXPOSE 8080
CMD ["node", "compressor.js"]
