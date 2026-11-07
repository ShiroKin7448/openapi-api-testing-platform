# syntax=docker/dockerfile:1
# Build context: repository root  (docker build -f backend/Dockerfile .)
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY shared/types/package.json shared/types/
RUN npm ci --workspace backend --include-workspace-root

COPY shared ./shared
COPY backend ./backend
WORKDIR /app/backend
RUN npx prisma generate && npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates wget && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/build ./backend/build
COPY --from=build /app/backend/prisma ./backend/prisma
# node_modules/@shared/types is a workspace symlink to /app/shared/types. In the runtime image that
# folder holds the *compiled* JS so runtime enums (WorkspaceRole, TestResultStatus, …) load under plain Node.
COPY --from=build /app/backend/build/shared/types/ ./shared/types/
RUN echo '{"name":"@shared/types","version":"1.0.0","main":"index.js"}' > ./shared/types/package.json
COPY docker/backend-entrypoint.sh /usr/local/bin/backend-entrypoint.sh
RUN chmod +x /usr/local/bin/backend-entrypoint.sh && chown -R node:node /app
USER node
WORKDIR /app/backend
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 CMD wget -qO- http://127.0.0.1:3000/health || exit 1
ENTRYPOINT ["backend-entrypoint.sh"]
CMD ["node", "build/backend/src/server.js"]
