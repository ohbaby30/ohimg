FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig*.json vite.config.ts ./
COPY server ./server
COPY web ./web
RUN npm run build && npm prune --omit=dev --no-audit --no-fund
FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8080 DB_PATH=/data/db/lightimg.sqlite IMAGE_DIR=/data/images
WORKDIR /app
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /data/db /data/images && chown -R node:node /data
USER node
EXPOSE 8080
CMD ["node","dist/server/main.js"]
