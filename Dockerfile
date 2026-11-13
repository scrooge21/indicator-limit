# syntax=docker/dockerfile:1
# Многоэтапная сборка: deps -> test (необязательный) -> runtime

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Этап с автотестами: docker build --target test .   (MongoDB и интернет не нужны)
FROM node:22-alpine AS test
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm test

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=10000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js ./
COPY src ./src
COPY views ./views
COPY public ./public
COPY docs ./docs
COPY scripts ./scripts
# не root
USER node
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||10000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
