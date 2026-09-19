# ABOUTME: Multiplayer image. One file, no node_modules.

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
EXPOSE 8080
CMD ["node", "mp.js"]
