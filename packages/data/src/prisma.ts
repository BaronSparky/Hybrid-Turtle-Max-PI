import { PrismaClient, Prisma } from '@prisma/client';

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

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