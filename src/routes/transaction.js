import express from "express";
import {
  createTransaction,
  createBulkTransactions,
  getAllTransactions,
  updateTransaction,
  deleteTransaction,
  getTransactionStats,
  healthCheck,
} from "../controller/transaction-controller.js";

const router = express.Router();

// Health check
router.get("/health", healthCheck);

router.get("/stats", getTransactionStats);

router.post("/", createTransaction);
router.post("/bulk", createBulkTransactions);
router.get("/", getAllTransactions);
router.put("/:id", updateTransaction);
router.delete("/:id", deleteTransaction);

export default router;
