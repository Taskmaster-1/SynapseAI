# One image for the API/worker and the web app; compose runs it with different commands.
FROM oven/bun:1.3.14-slim AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/tools/package.json packages/tools/
COPY packages/evals/package.json packages/evals/
RUN bun install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Next bakes the /api proxy target in at build time.
ARG API_URL=http://server:8787
ENV API_URL=${API_URL}
RUN bun run --filter '@synapse/web' build

FROM oven/bun:1.3.14-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app /app
USER bun
EXPOSE 8787 3000
CMD ["bun", "apps/server/src/main.ts"]
