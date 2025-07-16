import express from "express";
import {
  getSummary,
  getSummaryStats,
} from "../controller/summary-controller.js";

const router = express.Router();

router.get("/", getSummary);

// Get summary statistics
router.get("/stats", getSummaryStats);

export default router;
