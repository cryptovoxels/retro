# ABOUTME: Web service image. Build stage installs deps, final stage is the bundles only.

FROM node:25-slim AS build
WORKDIR /app
RUN npm i -g pnpm@9.15.4
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN mkdir -p dist && pnpm exec lessc web/src/style/app.less dist/app.css && node scripts/bundle-node.mjs web

FROM node:25-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/server/bundle_server.js /app/server/bundle_server.js
COPY --from=build /app/server/migrate.js /app/server/migrate.js
COPY --from=build /app/server/migrations.sql /app/server/migrations.sql
COPY --from=build /app/.env.production /app/.env.production
COPY --from=build /app/server/queries /app/server/queries
COPY --from=build /app/dist /app/dist
EXPOSE 8080
CMD ["sh", "-c", "node server/migrate.js & exec node server/bundle_server.js"]
