import { PrismaClient } from "./generated/prisma/index.js";
import { faker } from "@faker-js/faker";

const prisma = new PrismaClient();

// Configuration
const TOTAL_TRANSACTIONS = 10_000_000;
const DAYS_SPAN = 365;
const BATCH_SIZE = 5_000;

// Generate realistic transaction data with proper balance tracking
const generateTransactionBatch = (
  startDate,
  endDate,
  batchSize,
  globalBalance = 0
) => {
  const transactions = [];
  let currentBalance = globalBalance;

  for (let i = 0; i < batchSize; i++) {
    // Random timestamp within the date range
    const timestamp = faker.date.between({ from: startDate, to: endDate });

    // More IN transactions at the beginning to build up balance
    const daysSinceStart = Math.floor(
      (timestamp - startDate) / (1000 * 60 * 60 * 24)
    );
    const inProbability = Math.max(
      0.7 - (daysSinceStart / DAYS_SPAN) * 0.3,
      0.45
    );

    let type, amount;

    if (Math.random() < inProbability || currentBalance < 500) {
      // IN transaction
      type = "IN";
      amount = faker.number.float({ min: 50, max: 10000, multipleOf: 0.01 });
      currentBalance += amount;
    } else {
      // OUT transaction
      type = "OUT";
      // Ensure we don't go negative - be more conservative
      const maxAmount = Math.min(currentBalance * 0.6, 5000);
      amount = faker.number.float({
        min: 10,
        max: maxAmount,
        multipleOf: 0.01,
      });
      currentBalance -= amount;
    }

    transactions.push({
      timestamp,
      type,
      amount: parseFloat(amount.toFixed(2)),
    });
  }

  // Sort by timestamp to maintain chronological order
  return {
    transactions: transactions.sort((a, b) => a.timestamp - b.timestamp),
    finalBalance: currentBalance,
  };
};

// Optimized daily summary calculation
const calculateDailySummariesOptimized = async () => {
  console.log("🧮 Calculating daily summaries with optimized approach...");

  // Get date range
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - DAYS_SPAN);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);

  // Use raw SQL for better performance
  const dailyAggregates = await prisma.$queryRaw`
    SELECT 
      DATE(timestamp) as date,
      SUM(CASE WHEN type = 'IN' THEN amount ELSE 0 END) as in_amount,
      SUM(CASE WHEN type = 'OUT' THEN amount ELSE 0 END) as out_amount,
      COUNT(*) as transaction_count
    FROM "Transaction"
    WHERE timestamp >= ${startDate} AND timestamp <= ${endDate}
    GROUP BY DATE(timestamp)
    ORDER BY DATE(timestamp)
  `;

  const summaries = [];
  let runningBalance = 0;
  let previousBalance = 0;

  // Create a date map for easy lookup
  const aggregateMap = new Map();
  dailyAggregates.forEach((agg) => {
    aggregateMap.set(agg.date.toISOString().split("T")[0], agg);
  });

  // Generate summaries for each day
  for (let i = 0; i < DAYS_SPAN; i++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(currentDate.getDate() + i);

    const dateKey = currentDate.toISOString().split("T")[0];
    const dayData = aggregateMap.get(dateKey);

    const inAmount = dayData ? parseFloat(dayData.in_amount) : 0;
    const outAmount = dayData ? parseFloat(dayData.out_amount) : 0;
    const transactionCount = dayData ? parseInt(dayData.transaction_count) : 0;

    const dayChange = inAmount - outAmount;
    runningBalance += dayChange;

    // Calculate percentage change
    const percentChange =
      previousBalance === 0
        ? 0
        : ((runningBalance - previousBalance) / previousBalance) * 100;

    summaries.push({
      date: currentDate,
      balance: parseFloat(runningBalance.toFixed(2)),
      percentChange: parseFloat(percentChange.toFixed(2)),
      transactionCount,
      inAmount: parseFloat(inAmount.toFixed(2)),
      outAmount: parseFloat(outAmount.toFixed(2)),
    });

    previousBalance = runningBalance;
  }

  // Batch insert summaries
  await prisma.dailySummary.createMany({
    data: summaries,
    skipDuplicates: true,
  });

  console.log(`✅ Created ${summaries.length} daily summaries`);
  return summaries;
};

// Enhanced seeding function
export const seedTransactions = async () => {
  console.log(
    `🌱 Starting to seed ${TOTAL_TRANSACTIONS.toLocaleString()} transactions...`
  );

  try {
    // Clear existing data
    console.log("🗑️  Clearing existing data...");
    await prisma.invalidTransaction.deleteMany({});
    await prisma.dailySummary.deleteMany({});
    await prisma.transaction.deleteMany({});

    // Calculate date range (365 days ago to today)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - DAYS_SPAN);

    console.log(
      `📅 Date range: ${startDate.toDateString()} to ${endDate.toDateString()}`
    );

    const totalBatches = Math.ceil(TOTAL_TRANSACTIONS / BATCH_SIZE);
    let processedTransactions = 0;
    let globalBalance = 0;

    // Process in batches
    for (let batch = 0; batch < totalBatches; batch++) {
      const remainingTransactions = TOTAL_TRANSACTIONS - processedTransactions;
      const currentBatchSize = Math.min(BATCH_SIZE, remainingTransactions);

      console.log(
        `📦 Processing batch ${
          batch + 1
        }/${totalBatches} (${currentBatchSize.toLocaleString()} transactions)...`
      );

      // Generate batch data
      const batchResult = generateTransactionBatch(
        startDate,
        endDate,
        currentBatchSize,
        globalBalance
      );

      // Insert batch
      await prisma.transaction.createMany({
        data: batchResult.transactions,
        skipDuplicates: true,
      });

      globalBalance = batchResult.finalBalance;
      processedTransactions += currentBatchSize;

      // Progress update
      const progress = (((batch + 1) / totalBatches) * 100).toFixed(1);
      console.log(
        `✅ Progress: ${progress}% (${processedTransactions.toLocaleString()}/${TOTAL_TRANSACTIONS.toLocaleString()}) - Balance: $${globalBalance.toLocaleString()}`
      );

      // Small delay to prevent overwhelming the database
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    console.log("🧮 Calculating daily summaries...");
    await calculateDailySummariesOptimized();

    console.log("🎉 Seeding completed successfully!");

    // Display statistics
    await displayStatistics();

    // Validate data integrity
    await validateDataIntegrity();
  } catch (error) {
    console.error("❌ Error during seeding:", error);
    throw error;
  }
};

// Enhanced statistics display
const displayStatistics = async () => {
  const totalTransactions = await prisma.transaction.count();
  const totalIN = await prisma.transaction.count({ where: { type: "IN" } });
  const totalOUT = await prisma.transaction.count({ where: { type: "OUT" } });

  const inSum = await prisma.transaction.aggregate({
    where: { type: "IN" },
    _sum: { amount: true },
  });

  const outSum = await prisma.transaction.aggregate({
    where: { type: "OUT" },
    _sum: { amount: true },
  });

  const finalBalance = (inSum._sum.amount || 0) - (outSum._sum.amount || 0);

  const summaryCount = await prisma.dailySummary.count();
  const latestSummary = await prisma.dailySummary.findFirst({
    orderBy: { date: "desc" },
  });

  console.log("\n📊 SEEDING STATISTICS:");
  console.log("=".repeat(60));
  console.log(`Total Transactions: ${totalTransactions.toLocaleString()}`);
  console.log(`IN Transactions: ${totalIN.toLocaleString()}`);
  console.log(`OUT Transactions: ${totalOUT.toLocaleString()}`);
  console.log(`Total IN Amount: $${(inSum._sum.amount || 0).toLocaleString()}`);
  console.log(
    `Total OUT Amount: $${(outSum._sum.amount || 0).toLocaleString()}`
  );
  console.log(`Final Balance: $${finalBalance.toLocaleString()}`);
  console.log(`Daily Summaries: ${summaryCount}`);
  console.log(
    `Latest Summary Balance: $${(latestSummary?.balance || 0).toLocaleString()}`
  );
  console.log("=".repeat(60));
};

// Data integrity validation
const validateDataIntegrity = async () => {
  console.log("🔍 Validating data integrity...");

  try {
    // Calculate total balance correctly
    const inSum = await prisma.transaction.aggregate({
      where: { type: "IN" },
      _sum: { amount: true },
    });

    const outSum = await prisma.transaction.aggregate({
      where: { type: "OUT" },
      _sum: { amount: true },
    });

    const calculatedBalance =
      (inSum._sum.amount || 0) - (outSum._sum.amount || 0);

    const latestSummary = await prisma.dailySummary.findFirst({
      orderBy: { date: "desc" },
    });

    const balanceDifference = Math.abs(
      calculatedBalance - (latestSummary?.balance || 0)
    );

    if (balanceDifference > 0.01) {
      console.warn(`⚠️  Balance mismatch detected: ${balanceDifference}`);
      console.log(`Calculated Balance: ${calculatedBalance}`);
      console.log(`Latest Summary Balance: ${latestSummary?.balance || 0}`);
    } else {
      console.log("✅ Data integrity validated successfully");
    }
  } catch (error) {
    console.error("❌ Data integrity validation failed:", error);
  }
};

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  seedTransactions()
    .then(() => {
      console.log("🏁 Seeding script completed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Seeding failed:", error);
      process.exit(1);
    });
}
