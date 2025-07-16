import { seedTransactions } from "./seeding.js";
import { PrismaClient } from "./generated/prisma/index.js";
const prisma = new PrismaClient({
  log: ["error", "warn"],
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// Configure for better performance during seeding
const optimizeForSeeding = async () => {
  console.log("⚡ Optimizing database for seeding...");

  // These are PostgreSQL-specific optimizations
  // Adjust based on your database
  try {
    await prisma.$executeRaw`SET synchronous_commit = OFF`;
    await prisma.$executeRaw`SET wal_buffers = '16MB'`;
    await prisma.$executeRaw`SET checkpoint_segments = 32`;
    await prisma.$executeRaw`SET checkpoint_completion_target = 0.9`;
    await prisma.$executeRaw`SET max_wal_size = '1GB'`;
    console.log("✅ Database optimized for seeding");
  } catch (error) {
    console.log("⚠️  Could not apply database optimizations:", error.message);
  }
};

const restoreNormalSettings = async () => {
  console.log("🔄 Restoring normal database settings...");

  try {
    await prisma.$executeRaw`SET synchronous_commit = ON`;
    await prisma.$executeRaw`RESET wal_buffers`;
    await prisma.$executeRaw`RESET checkpoint_segments`;
    await prisma.$executeRaw`RESET checkpoint_completion_target`;
    await prisma.$executeRaw`RESET max_wal_size`;
    console.log("✅ Normal settings restored");
  } catch (error) {
    console.log("⚠️  Could not restore settings:", error.message);
  }
};

const main = async () => {
  const startTime = Date.now();

  try {
    await optimizeForSeeding();
    await seedTransactions();
    await restoreNormalSettings();

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000 / 60).toFixed(2);

    console.log(`\n🎯 Total seeding time: ${duration} minutes`);
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    await restoreNormalSettings();
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
};

main();
