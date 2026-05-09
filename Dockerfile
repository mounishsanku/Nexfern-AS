# ── Nexfern FinanceOS — Multi-stage Dockerfile ────────────────────────────────
#
# Stage 1: Build client
# Stage 2: Production server (node:alpine, no dev tools)
#
# Build: docker build -t nexfern .
# Run:   docker-compose up

# ── Stage 1: Frontend build ───────────────────────────────────────────────────
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci --silent
COPY client/ ./
RUN npm run build

# ── Stage 2: Production server ────────────────────────────────────────────────
FROM node:20-alpine AS server
WORKDIR /app/server

# Only production dependencies
COPY server/package*.json ./
RUN npm ci --only=production --silent

COPY server/ ./

# Copy built client into server's static directory
COPY --from=client-build /app/client/dist /app/server/public

# Non-root user for security
RUN addgroup -S nexfern && adduser -S nexfern -G nexfern
USER nexfern

# Healthcheck — uses /health/live (no DB required)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-5001}/health/live || exit 1

EXPOSE ${PORT:-5001}

CMD ["node", "src/index.js"]
