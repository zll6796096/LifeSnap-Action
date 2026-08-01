# Stage 1: Build
FROM node:24-slim AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production dependencies only
FROM node:24-slim AS production-dependencies
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 3: Production
FROM node:24-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=production-dependencies --chown=node:node /app/package.json ./
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules

EXPOSE 8080

USER node

CMD ["node", "dist/server.cjs"]
