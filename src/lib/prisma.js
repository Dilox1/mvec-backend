// src/lib/prisma.js
// Single shared Prisma Client instance for the whole backend.
// Import this everywhere instead of creating a new PrismaClient per file.
const { PrismaClient } = require("@prisma/client");

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.__mvecPrisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__mvecPrisma = prisma;
}

module.exports = prisma;
