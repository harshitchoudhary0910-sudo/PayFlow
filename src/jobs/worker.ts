import dotenv from "dotenv";
dotenv.config();

import { connectToDatabase } from "../config/db.ts";
import { recoverPendingTransactions } from "./transactionRecovery.ts";
import { logger } from "../utils/logger.ts";

async function startWorker() {
    logger.info("Initializing PayFlow Reconciliation Worker...");
    await connectToDatabase();

    const intervalMs = parseInt(process.env.RECONCILIATION_INTERVAL_MS || "60000", 10);

    const runJob = async () => {
        try {
            await recoverPendingTransactions();
        } catch (err) {
            logger.error("Error in reconciliation worker execution cycle", { error: err });
        }
    };

    // Execute immediately on startup
    await runJob();

    // Schedule recurring runs
    setInterval(runJob, intervalMs);
    logger.info(`Reconciliation Worker active. Running every ${intervalMs / 1000} seconds.`);
}

startWorker().catch((err) => {
    logger.error("Fatal worker startup error", { error: err });
    process.exit(1);
});