import { PrismaClient, Prisma } from '@prisma/client';

// SHARED SINGLETON across the monorepo.
// The Next app's src/lib/prisma.ts publishes the same client via globalThis.
// We always assign here too (regardless of NODE_ENV) so whichever module
// loads first wins and the other reuses through the `??` check. PRAGMAs
// are also applied here as a safety net in case this module loads first.
// See audit 2026-05-16 (H1).
const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

globalForPrisma.prisma = prisma;

// SQLite concurrency PRAGMAs — idempotent if src/lib/prisma.ts also ran them.
prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;').catch(() => {});
prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000;').catch(() => {});

/** Shared helper: cast a value for Prisma JSON columns. */
export function toInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/** Shared helper: convert a number to Prisma Decimal. */
export function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/** Shared helper: round a number to the given precision (default 4). */
export function round(value: number, precision = 4): number {
  return Number(value.toFixed(precision));
}