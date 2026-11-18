# ABOUTME: Multiplayer image. Bundled Node runtime and the Texas rat script.

FROM node:25-slim AS build
WORKDIR /app
RUN npm i -g pnpm@9.15.4
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN node scripts/bundle-node.mjs mp

FROM node:25-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist/mp.js /app/mp.js
COPY multiplayer/sim/block.bin multiplayer/sim/critter.lua multiplayer/sim/eagle.lua multiplayer/sim/rat.lua multiplayer/sim/street.txt multiplayer/sim/LUA-LICENSE.txt /app/multiplayer/sim/
EXPOSE 8080
CMD ["node", "mp.js"]
