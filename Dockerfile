# DEPENDENCIES
# Consumed by: docker-compose.yml, docs/DEPLOYMENT.md
# Consumes: package.json, package-lock.json, Next.js app, Prisma schema
# Risk-sensitive: NO
# Last modified: 2026-03-09
# Notes: Builds the current stable SQLite-backed runtime for local/container deployment.

FROM node:22-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run db:generate
RUN npm run build

FROM node:22-bookworm AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
COPY --from=builder /app ./
EXPOSE 3000
CMD ["sh", "-lc", "npm run db:auto-migrate && npm run start"]