import prisma from "../config/prisma.js";

export const recalculateFromTimestamp = async (fromTimestamp) => {
  console.log(`🔄 Recalculating summaries from ${fromTimestamp}`);

  const startDate = new Date(fromTimestamp);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);

  const affectedDates = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    affectedDates.push(new Date(d));
  }

  for (const date of affectedDates) {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);

    // Get balance up to end of this day using raw SQL for performance
    const dayBalanceResult = await prisma.$queryRaw`
      SELECT COALESCE(
        SUM(CASE WHEN type = 'IN' THEN amount ELSE -amount END), 
        0
      ) as balance
      FROM "Transaction"
      WHERE timestamp < ${nextDate}
    `;

    // Get day's transactions
    const dayTxnsResult = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as transaction_count,
        SUM(CASE WHEN type = 'IN' THEN amount ELSE 0 END) as in_amount,
        SUM(CASE WHEN type = 'OUT' THEN amount ELSE 0 END) as out_amount
      FROM "Transaction"
      WHERE timestamp >= ${date} AND timestamp < ${nextDate}
    `;

    const currentBalance = parseFloat(dayBalanceResult[0].balance) || 0;
    const transactionCount = parseInt(dayTxnsResult[0].transaction_count) || 0;
    const inAmount = parseFloat(dayTxnsResult[0].in_amount) || 0;
    const outAmount = parseFloat(dayTxnsResult[0].out_amount) || 0;

    // Calculate previous day balance for percentage change
    const prevBalanceResult = await prisma.$queryRaw`
      SELECT COALESCE(
        SUM(CASE WHEN type = 'IN' THEN amount ELSE -amount END), 
        0
      ) as balance
      FROM "Transaction"
      WHERE timestamp < ${date}
    `;

    const previousBalance = parseFloat(prevBalanceResult[0].balance) || 0;
    const percentChange =
      previousBalance === 0
        ? 0
        : ((currentBalance - previousBalance) / previousBalance) * 100;

    // Upsert daily summary
    await prisma.dailySummary.upsert({
      where: { date },
      update: {
        balance: currentBalance,
        percentChange: parseFloat(percentChange.toFixed(2)),
        transactionCount,
        inAmount,
        outAmount,
      },
      create: {
        date,
        balance: currentBalance,
        percentChange: parseFloat(percentChange.toFixed(2)),
        transactionCount,
        inAmount,
        outAmount,
      },
    });
  }

  // Mark invalid transactions
  await markInvalidTransactions();
};

// Mark transactions that violate balance constraints
export const markInvalidTransactions = async () => {
  console.log("🔍 Checking for invalid transactions...");

  // Clear existing invalid transactions
  await prisma.invalidTransaction.deleteMany({});

  // Use cursor-based processing for 10M records
  const batchSize = 10000;
  let cursor = null;
  let runningBalance = 0;
  const invalidTxns = [];

  while (true) {
    const transactions = await prisma.transaction.findMany({
      take: batchSize,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
      orderBy: { timestamp: "asc" },
      select: { id: true, timestamp: true, type: true, amount: true },
    });

    if (transactions.length === 0) break;

    for (const txn of transactions) {
      const newBalance =
        txn.type === "IN"
          ? runningBalance + txn.amount
          : runningBalance - txn.amount;

      if (newBalance < 0) {
        invalidTxns.push({
          transactionId: txn.id,
          reason: `Would result in negative balance: ${newBalance.toFixed(2)}`,
        });
      }

      runningBalance = Math.max(0, newBalance);
    }

    cursor = transactions[transactions.length - 1].id;

    // Process invalid transactions in batches
    if (invalidTxns.length >= 1000) {
      await prisma.invalidTransaction.createMany({
        data: invalidTxns.splice(0, 1000),
      });
    }
  }

  // Insert remaining invalid transactions
  if (invalidTxns.length > 0) {
    await prisma.invalidTransaction.createMany({
      data: invalidTxns,
    });
  }

  console.log(`⚠️  Marked ${invalidTxns.length} invalid transactions`);
};
