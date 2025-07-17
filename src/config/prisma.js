import "dotenv/config"; // ✅ Ensure .env is loaded
import { PrismaClient } from "../../generated/prisma/index.js";

// Connection pool configuration
const connectionPool = {
  max: 20,
  min: 5,
  acquire: 30000,
  idle: 10000,
};

// Update DATABASE_URL before using it
if (process.env.DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set("connection_limit", connectionPool.max.toString());
  url.searchParams.set("pool_timeout", "30");
  process.env.DATABASE_URL = url.toString();
}

// Now it's safe to use the updated DATABASE_URL
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
  errorFormat: "minimal",
});

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
