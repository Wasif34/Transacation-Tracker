import prisma from "../config/prisma.js";
import { isFuture } from "date-fns";
import { recalculateFromTimestamp } from "../utils/utility.js";
import redis from "../config/redis.js";

// OPTIMIZED: Get balance at specific timestamp with caching
const getBalanceAtTimestamp = async (timestamp) => {
  const cacheKey = `balance:${timestamp.toISOString()}`;

  // Check cache first
  try {
    const cachedBalance = await redis.get(cacheKey);
    if (cachedBalance !== null) {
      return parseFloat(cachedBalance);
    }
  } catch (err) {
    console.warn("Redis cache miss:", err.message);
  }

  // Use raw SQL for better performance
  const result = await prisma.$queryRaw`
    SELECT COALESCE(
      SUM(CASE WHEN type = 'IN' THEN amount ELSE -amount END), 
      0
    ) as balance
    FROM "Transaction"
    WHERE timestamp <= ${timestamp}
  `;

  console.log(`Calculating balance at ${timestamp.toISOString()}...`);

  const balance = parseFloat(result[0].balance) || 0;

  // Cache for 5 minutes
  try {
    await redis.setEx(cacheKey, 300, balance.toString());
  } catch (err) {
    console.warn("Redis cache set failed:", err.message);
  }

  return balance;
};

// OPTIMIZED: Batch balance calculation for multiple timestamps
const getBalancesAtTimestamps = async (timestamps) => {
  const uniqueTimestamps = [...new Set(timestamps.map((t) => t.toISOString()))];

  const results = await prisma.$queryRaw`
    SELECT 
      timestamp_bucket,
      COALESCE(
        SUM(CASE WHEN type = 'IN' THEN amount ELSE -amount END) 
        OVER (ORDER BY timestamp_bucket), 
        0
      ) as running_balance
    FROM (
      SELECT 
        timestamp as timestamp_bucket
      FROM "Transaction"
      WHERE timestamp IN (${uniqueTimestamps.map((t) => new Date(t)).join(",")})
      ORDER BY timestamp
    ) buckets
    LEFT JOIN "Transaction" t ON t.timestamp <= buckets.timestamp_bucket
    GROUP BY timestamp_bucket
    ORDER BY timestamp_bucket
  `;

  const balanceMap = new Map();
  results.forEach((row) => {
    balanceMap.set(
      row.timestamp_bucket.toISOString(),
      parseFloat(row.running_balance)
    );
  });

  return balanceMap;
};

// OPTIMIZED: Get all transactions with better performance
export const getAllTransactions = async (req, res) => {
  try {
    const { cursor, limit = 50 } = req.query;
    const take = Math.min(parseInt(limit), 100);

    // Use index hint for better performance
    const transactions = await prisma.transaction.findMany({
      take,
      ...(cursor && {
        skip: 1,
        cursor: { id: parseInt(cursor) },
      }),
      orderBy: [
        { timestamp: "desc" },
        { id: "desc" }, // Secondary sort for consistency
      ],
      select: {
        id: true,
        timestamp: true,
        type: true,
        amount: true,
        invalidTransaction: {
          select: { reason: true },
        },
      },
    });

    // Get invalid transaction count with caching
    const invalidCount = await getInvalidTransactionCount();

    const nextCursor =
      transactions.length === take
        ? transactions[transactions.length - 1].id
        : null;

    res.json({
      transactions,
      nextCursor,
      hasMore: nextCursor !== null,
      invalidCount,
    });
  } catch (err) {
    console.error("Error fetching transactions:", err);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
};

// OPTIMIZED: Create transaction with better validation
export const createTransaction = async (req, res) => {
  const { timestamp, type, amount } = req.body;

  try {
    // Input validation
    if (!timestamp || !type || !amount) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!["IN", "OUT"].includes(type)) {
      return res.status(400).json({ error: "Invalid transaction type" });
    }

    const date = new Date(timestamp);

    if (isNaN(date.getTime())) {
      return res.status(400).json({ error: "Invalid timestamp format" });
    }

    if (isFuture(date)) {
      return res.status(400).json({ error: "Cannot use future timestamp" });
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res
        .status(400)
        .json({ error: "Amount must be a positive number" });
    }

    // Use transaction for atomicity
    const result = await prisma.$transaction(async (tx) => {
      // Check balance for OUT transactions
      if (type === "OUT") {
        const balanceAtTime = await getBalanceAtTimestamp(date);
        if (numericAmount > balanceAtTime) {
          throw new Error(
            `Insufficient balance. Available: ${balanceAtTime}, Requested: ${numericAmount}`
          );
        }
      }

      // Create transaction
      const newTxn = await tx.transaction.create({
        data: {
          timestamp: date,
          type,
          amount: numericAmount,
        },
      });

      return newTxn;
    });

    // Invalidate cache for this timestamp and after
    await invalidateBalanceCache(date);

    // Queue recalculation for better performance
    setImmediate(async () => {
      try {
        await recalculateFromTimestamp(date);
      } catch (error) {
        console.error("Background recalculation failed:", error);
      }
    });

    res.status(201).json(result);
  } catch (err) {
    console.error("Error creating transaction:", err);

    if (err.message.includes("Insufficient balance")) {
      return res.status(400).json({ error: err.message });
    }

    res.status(500).json({ error: "Failed to create transaction" });
  }
};

// OPTIMIZED: Update transaction with better performance
export const updateTransaction = async (req, res) => {
  const { id } = req.params;
  const { timestamp, type, amount } = req.body;

  try {
    const txnId = parseInt(id);

    if (isNaN(txnId)) {
      return res.status(400).json({ error: "Invalid transaction ID" });
    }

    const existing = await prisma.transaction.findUnique({
      where: { id: txnId },
      select: { id: true, timestamp: true, type: true, amount: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    // Validate inputs
    const date = timestamp ? new Date(timestamp) : existing.timestamp;
    const newType = type || existing.type;
    const newAmount = amount ? parseFloat(amount) : existing.amount;

    if (timestamp && isNaN(date.getTime())) {
      return res.status(400).json({ error: "Invalid timestamp format" });
    }

    if (isFuture(date)) {
      return res.status(400).json({ error: "Cannot use future timestamp" });
    }

    if (amount && (isNaN(newAmount) || newAmount <= 0)) {
      return res
        .status(400)
        .json({ error: "Amount must be a positive number" });
    }

    // Use transaction for atomicity
    const result = await prisma.$transaction(async (tx) => {
      // Check balance for OUT transactions
      if (newType === "OUT") {
        const balanceExcludingThis = await getBalanceExcludingTransaction(
          date,
          txnId
        );
        if (newAmount > balanceExcludingThis) {
          throw new Error(
            `Insufficient balance for update. Available: ${balanceExcludingThis}, Requested: ${newAmount}`
          );
        }
      }

      // Update transaction
      const updated = await tx.transaction.update({
        where: { id: txnId },
        data: {
          timestamp: date,
          type: newType,
          amount: newAmount,
        },
      });

      return updated;
    });

    // Invalidate cache for affected timestamps
    const earliestDate = new Date(
      Math.min(existing.timestamp.getTime(), date.getTime())
    );
    await invalidateBalanceCache(earliestDate);

    // Queue recalculation
    setImmediate(async () => {
      try {
        await recalculateFromTimestamp(earliestDate);
      } catch (error) {
        console.error("Background recalculation failed:", error);
      }
    });

    res.json(result);
  } catch (err) {
    console.error("Error updating transaction:", err);

    if (err.message.includes("Insufficient balance")) {
      return res.status(400).json({ error: err.message });
    }

    res.status(500).json({ error: "Failed to update transaction" });
  }
};

export const deleteTransaction = async (req, res) => {
  const { id } = req.params;

  try {
    const txnId = parseInt(id);

    if (isNaN(txnId)) {
      return res.status(400).json({ error: "Invalid transaction ID" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findUnique({
        where: { id: txnId },
        select: { id: true, timestamp: true },
      });

      if (!transaction) {
        throw new Error("Transaction not found");
      }

      await tx.transaction.delete({
        where: { id: txnId },
      });

      return transaction;
    });

    // Invalidate cache
    await invalidateBalanceCache(result.timestamp);

    // Queue recalculation
    setImmediate(async () => {
      try {
        await recalculateFromTimestamp(result.timestamp);
      } catch (error) {
        console.error("Background recalculation failed:", error);
      }
    });

    res.json({ message: "Transaction deleted successfully" });
  } catch (error) {
    console.error("Error deleting transaction:", error);

    if (error.message === "Transaction not found") {
      return res.status(404).json({ error: "Transaction not found" });
    }

    res.status(500).json({ error: "Failed to delete transaction" });
  }
};

const getBalanceExcludingTransaction = async (timestamp, excludeId) => {
  const result = await prisma.$queryRaw`
    SELECT COALESCE(
      SUM(CASE WHEN type = 'IN' THEN amount ELSE -amount END), 
      0
    ) as balance
    FROM "Transaction"
    WHERE timestamp <= ${timestamp} AND id != ${excludeId}
  `;

  return parseFloat(result[0].balance) || 0;
};

const getInvalidTransactionCount = async () => {
  const cacheKey = "invalid_transaction_count";

  try {
    const cachedCount = await redis.get(cacheKey);
    if (cachedCount !== null) {
      return parseInt(cachedCount);
    }
  } catch (err) {
    console.warn("Redis cache miss for invalid count:", err.message);
  }

  const count = await prisma.invalidTransaction.count();

  try {
    await redis.setEx(cacheKey, 60, count.toString()); // Cache for 1 minute
  } catch (err) {
    console.warn("Redis cache set failed for invalid count:", err.message);
  }

  return count;
};

const invalidateBalanceCache = async (fromDate) => {
  try {
    const keys = await redis.keys(`balance:*`);

    const keysToDelete = keys.filter((key) => {
      const dateStr = key.replace("balance:", "");
      const keyDate = new Date(dateStr);
      return keyDate >= fromDate;
    });

    if (keysToDelete.length > 0) {
      await redis.del(keysToDelete);
    }

    // Also invalidate invalid count cache
    await redis.del("invalid_transaction_count");
  } catch (err) {
    console.warn("Cache invalidation failed:", err.message);
  }
};

export const createBulkTransactions = async (req, res) => {
  const { transactions } = req.body;

  if (!Array.isArray(transactions) || transactions.length === 0) {
    return res.status(400).json({ error: "Transactions array is required" });
  }

  try {
    const validatedTransactions = [];

    // Validate all transactions first
    for (const txn of transactions) {
      const { timestamp, type, amount } = txn;

      if (!timestamp || !type || !amount) {
        return res.status(400).json({ error: "Invalid transaction data" });
      }

      if (!["IN", "OUT"].includes(type)) {
        return res.status(400).json({ error: "Invalid transaction type" });
      }

      const date = new Date(timestamp);
      if (isNaN(date.getTime()) || isFuture(date)) {
        return res.status(400).json({ error: "Invalid timestamp" });
      }

      const numericAmount = parseFloat(amount);
      if (isNaN(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ error: "Invalid amount" });
      }

      validatedTransactions.push({
        timestamp: date,
        type,
        amount: numericAmount,
      });
    }

    // Sort by timestamp
    validatedTransactions.sort((a, b) => a.timestamp - b.timestamp);

    // Process in batches
    const batchSize = 1000;
    let created = 0;

    for (let i = 0; i < validatedTransactions.length; i += batchSize) {
      const batch = validatedTransactions.slice(i, i + batchSize);

      const result = await prisma.transaction.createMany({
        data: batch,
        skipDuplicates: true,
      });

      created += result.count;
    }

    // Invalidate all cache
    await redis.flushDb();

    res.status(201).json({
      message: "Bulk transactions created successfully",
      count: created,
    });
  } catch (error) {
    console.error("Error creating bulk transactions:", error);
    res.status(500).json({ error: "Failed to create bulk transactions" });
  }
};

// Get transaction statistics
export const getTransactionStats = async (req, res) => {
  try {
    const cacheKey = "transaction_stats";

    // Check cache first
    try {
      const cachedStats = await redis.get(cacheKey);
      if (cachedStats) {
        return res.json(JSON.parse(cachedStats));
      }
    } catch (err) {
      console.warn("Redis cache miss for stats:", err.message);
    }

    // Calculate stats
    const [totalCount, inStats, outStats] = await Promise.all([
      prisma.transaction.count(),
      prisma.transaction.aggregate({
        where: { type: "IN" },
        _count: { id: true },
        _sum: { amount: true },
        _avg: { amount: true },
        _max: { amount: true },
        _min: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { type: "OUT" },
        _count: { id: true },
        _sum: { amount: true },
        _avg: { amount: true },
        _max: { amount: true },
        _min: { amount: true },
      }),
    ]);

    const stats = {
      totalTransactions: totalCount,
      inTransactions: {
        count: inStats._count.id,
        totalAmount: inStats._sum.amount || 0,
        averageAmount: inStats._avg.amount || 0,
        maxAmount: inStats._max.amount || 0,
        minAmount: inStats._min.amount || 0,
      },
      outTransactions: {
        count: outStats._count.id,
        totalAmount: outStats._sum.amount || 0,
        averageAmount: outStats._avg.amount || 0,
        maxAmount: outStats._max.amount || 0,
        minAmount: outStats._min.amount || 0,
      },
      currentBalance: (inStats._sum.amount || 0) - (outStats._sum.amount || 0),
    };

    try {
      await redis.setEx(cacheKey, 300, JSON.stringify(stats));
    } catch (err) {
      console.warn("Redis cache set failed for stats:", err.message);
    }

    res.json(stats);
  } catch (error) {
    console.error("Error fetching transaction stats:", error);
    res.status(500).json({ error: "Failed to fetch transaction stats" });
  }
};

// Health check endpoint
export const healthCheck = async (req, res) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;

    // Check Redis connection
    let redisStatus = "connected";
    try {
      await redis.ping();
    } catch (err) {
      redisStatus = "disconnected";
    }

    res.json({
      status: "healthy",
      database: "connected",
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check failed:", error);
    res.status(500).json({
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};
