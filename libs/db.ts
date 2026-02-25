import { PrismaClient } from '@prisma/client';

// Add prisma to the global object in development to prevent 
// multiple instances of Prisma Client in development.
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
    globalForPrisma.prisma ||
    new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
