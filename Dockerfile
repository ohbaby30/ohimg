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
ENV NODE_ENV=production PORT=8080 DB_PATH=/data/db/Ohimg.sqlite IMAGE_DIR=/data/images
WORKDIR /app
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/ohimg-entrypoint
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/* \
    && chmod 755 /usr/local/bin/ohimg-entrypoint \
    && mkdir -p /data/db /data/images && chown -R node:node /data
USER root
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/ohimg-entrypoint"]
CMD ["node","dist/server/main.js"]
