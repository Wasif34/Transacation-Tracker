import prisma from "../config/prisma.js"; // ← Use shared prisma instance

// Remove the local PrismaClient instance
// const prisma = new PrismaClient(); ← DELETE THIS LINE

export const getSummary = async (req, res) => {
  try {
    const { cursor, limit = 50 } = req.query;
    const take = Math.min(parseInt(limit), 100);

    const summaries = await prisma.dailySummary.findMany({
      take,
      ...(cursor && {
        skip: 1,
        cursor: { id: parseInt(cursor) },
      }),
      orderBy: { date: "desc" },
      select: {
        id: true,
        date: true,
        balance: true,
        percentChange: true,
        transactionCount: true,
        inAmount: true,
        outAmount: true,
      },
    });

    if (summaries.length === 0) {
      return res.status(404).json({ message: "No summaries found" });
    }

    const nextCursor =
      summaries.length === take ? summaries[summaries.length - 1].id : null;

    res.status(200).json({
      summaries,
      nextCursor,
      hasMore: nextCursor !== null,
    });
  } catch (error) {
    console.error("Error fetching summary:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Get summary statistics
export const getSummaryStats = async (req, res) => {
  try {
    const stats = await prisma.dailySummary.aggregate({
      _count: { id: true },
      _avg: { balance: true, percentChange: true },
      _max: { balance: true, percentChange: true },
      _min: { balance: true, percentChange: true },
    });

    const latestSummary = await prisma.dailySummary.findFirst({
      orderBy: { date: "desc" },
    });

    res.status(200).json({
      totalDays: stats._count.id,
      currentBalance: latestSummary?.balance || 0,
      averageBalance: stats._avg.balance || 0,
      maxBalance: stats._max.balance || 0,
      minBalance: stats._min.balance || 0,
      averagePercentChange: stats._avg.percentChange || 0,
      maxPercentChange: stats._max.percentChange || 0,
      minPercentChange: stats._min.percentChange || 0,
    });
  } catch (error) {
    console.error("Error fetching summary stats:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
