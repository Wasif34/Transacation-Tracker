import { PrismaClient } from "../../generated/prisma/index.js";

// Configure Prisma with connection pooling
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
  errorFormat: "minimal",
});

// Connection pool configuration
const connectionPool = {
  max: 20, // Maximum number of connections
  min: 5, // Minimum number of connections
  acquire: 30000, // Maximum time to get connection (30s)
  idle: 10000, // Maximum time connection can be idle (10s)
};

// Configure connection pool for PostgreSQL
if (process.env.DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set("connection_limit", connectionPool.max.toString());
  url.searchParams.set("pool_timeout", "30");

  process.env.DATABASE_URL = url.toString();
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("🔄 Shutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("🔄 Shutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
});

export default prisma;
