import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import router from "./routes/transaction.js";
import summaryRouter from "./routes/summary.js";
import prisma from "./config/prisma.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const method = req.method;
    const url = req.url;

    console.log(`${method} ${url} - ${status} - ${duration}ms`);
  });

  next();
});

app.use("/api/transactions", router);
app.use("/api/summary", summaryRouter);

app.use((error, req, res, next) => {
  console.error("Global error:", error);
  res.status(500).json({
    error: "Internal server error",
    message:
      process.env.NODE_ENV === "development"
        ? error.message
        : "Something went wrong",
  });
});

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(
    `📊 Health check: http://localhost:${PORT}/api/transactions/health`
  );
  console.log(`📈 Stats: http://localhost:${PORT}/api/transactions/stats`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🔄 SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});
