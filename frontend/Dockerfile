# syntax=docker/dockerfile:1
# Build context: repository root  (docker build -f frontend/Dockerfile .)
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY shared/types/package.json shared/types/
RUN npm ci --workspace frontend --include-workspace-root
COPY shared ./shared
COPY frontend ./frontend
COPY examples ./examples
RUN npm run build --workspace frontend

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
