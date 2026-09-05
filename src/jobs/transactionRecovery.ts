import mongoose from "mongoose";
import PaymentModel from "../models/PaymentModel.ts";
import AccountModel from "../models/AccountModel.ts";
import ledgerModel from "../models/LedgerModel.ts";
import { fetchGatewayPaymentStatus } from "../services/razorpay.service.ts";
import { acquireLock, releaseLock } from "../utils/redisLock.ts";
import { verifyAccountBalance } from "../services/ledger.service.ts";
import { logger } from "../utils/logger.ts";

/**
 * Recovers stuck PENDING payments using Redis Distributed Locking
 * and audits ledger vs materialized balance consistency.
 */
export async function recoverPendingTransactions(minAgeMs: number = 5 * 60 * 1000) {
    const cutoffDate = new Date(Date.now() - minAgeMs);

    logger.info("Starting background payment reconciliation job", { cutoffDate });

    // 1. Find PENDING payments older than cutoff
    const pendingPayments = await PaymentModel.find({
        status: "PENDING",
        createdAt: { $lt: cutoffDate }
    });

    logger.info(`Found ${pendingPayments.length} pending payments requiring reconciliation.`);

    for (const payment of pendingPayments) {
        const lockKey = `reconciliation:payment:${payment._id}`;
        
        // 2. Acquire Redis Distributed Lock
        const lockToken = await acquireLock(lockKey, 15000);
        if (!lockToken) {
            logger.info("Skipping payment reconciliation; lock held by another worker", {
                paymentId: payment._id
            });
            continue;
        }

        try {
            logger.info("Acquired Redis lock for payment reconciliation", {
                paymentId: payment._id,
                lockKey
            });

            // 3. Check Payment Status with Gateway
            const searchId = payment.gatewayPaymentId || payment.gatewayOrderId || payment._id.toString();
            const gatewayStatus = await fetchGatewayPaymentStatus(searchId);

            if (gatewayStatus.status === "captured" || gatewayStatus.status === "paid") {
                // 4. Execute atomic MongoDB transaction to credit wallet & mark COMPLETED
                const session = await mongoose.startSession();
                try {
                    session.startTransaction();

                    const currentPayment = await PaymentModel.findOne({
                        _id: payment._id,
                        status: "PENDING"
                    }).session(session);

                    if (currentPayment) {
                        currentPayment.status = "COMPLETED";
                        currentPayment.gatewayPaymentId = gatewayStatus.id || currentPayment.gatewayPaymentId;
                        await currentPayment.save({ session });

                        const accountUpdate = await AccountModel.updateOne(
                            { _id: currentPayment.account, status: "active" },
                            { $inc: { balance: currentPayment.amount } },
                            { session }
                        );

                        if (accountUpdate.modifiedCount > 0) {
                            await ledgerModel.create(
                                [
                                    {
                                        account: currentPayment.account,
                                        amount: currentPayment.amount,
                                        payment: currentPayment._id,
                                        type: "CREDIT"
                                    }
                                ],
                                { session }
                            );
                            await session.commitTransaction();
                            logger.info("Successfully recovered & credited stuck pending payment", {
                                paymentId: payment._id,
                                amount: currentPayment.amount
                            });
                        } else {
                            await session.abortTransaction();
                        }
                    } else {
                        await session.abortTransaction();
                    }
                } catch (err: any) {
                    await session.abortTransaction();
                    logger.error("Error during payment recovery transaction", {
                        paymentId: payment._id,
                        error: err
                    });
                } finally {
                    session.endSession();
                }
            } else if (gatewayStatus.status === "failed") {
                payment.status = "FAILED";
                await payment.save();
                logger.info("Marked stuck payment as FAILED based on gateway status", {
                    paymentId: payment._id
                });
            }
        } catch (err: any) {
            logger.error("Failed to reconcile payment", {
                paymentId: payment._id,
                error: err
            });
        } finally {
            // 5. Release Redis Distributed Lock
            await releaseLock(lockKey, lockToken);
        }
    }

    // 6. Audit Ledger Balance Integrity for all accounts
    try {
        const activeAccounts = await AccountModel.find({ status: "active" }).select("_id accountNumber");
        for (const account of activeAccounts) {
            await verifyAccountBalance(account._id);
        }
    } catch (auditErr: any) {
        logger.error("Error during ledger balance audit phase", { error: auditErr });
    }
}