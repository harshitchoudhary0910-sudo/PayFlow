import type { Request, Response } from "express";
import mongoose from "mongoose";
import PaymentModel from "../models/PaymentModel.ts";
import AccountModel from "../models/AccountModel.ts";
import ledgerModel from "../models/LedgerModel.ts";
import { createGatewayOrder, verifyWebhookSignature } from "../services/razorpay.service.ts";
import type { CreatePaymentInput } from "../schemas/payment.Schema.ts";
import { logger } from "../utils/logger.ts";

export async function createPaymentController(req: Request, res: Response) {
    const userId = res.locals.userId;
    const { accountNumber, amount, idempotencyKey } = req.body as CreatePaymentInput;

    try {
        // 1. Check idempotency
        const existingPayment = await PaymentModel.findOne({ idempotencyKey });
        if (existingPayment) {
            logger.info("Payment retry detected via idempotency key", {
                requestId: res.locals.requestId,
                idempotencyKey,
                paymentId: existingPayment._id
            });
            return res.status(200).json({
                message: "Payment request retrieved (idempotent retry)",
                payment: existingPayment
            });
        }

        // 2. Validate account ownership and active status
        const account = await AccountModel.findOne({
            accountNumber,
            userId
        });

        if (!account) {
            return res.status(404).json({ message: "Account not found or access denied" });
        }

        if (account.status !== "active") {
            return res.status(400).json({ message: "Account is inactive" });
        }

        // 3. Create PENDING Payment document
        let payment;
        try {
            payment = await PaymentModel.create({
                account: account._id,
                user: userId,
                amount,
                idempotencyKey,
                status: "PENDING"
            });
        } catch (err: any) {
            if (err.code === 11000) {
                const existing = await PaymentModel.findOne({ idempotencyKey });
                return res.status(200).json({
                    message: "Payment request retrieved (idempotent retry)",
                    payment: existing
                });
            }
            throw err;
        }

        // 4. Create Gateway Order (Razorpay Sandbox)
        const gatewayOrder = await createGatewayOrder({
            amount,
            receipt: payment._id.toString(),
            notes: {
                paymentId: payment._id.toString(),
                userId,
                accountNumber
            }
        });

        payment.gatewayOrderId = gatewayOrder.id;
        await payment.save();

        logger.info("Payment initiated successfully", {
            requestId: res.locals.requestId,
            userId,
            paymentId: payment._id,
            gatewayOrderId: gatewayOrder.id,
            amount
        });

        // Return gateway order info. Wallet balance is NOT credited yet.
        return res.status(201).json({
            message: "Payment order created successfully",
            payment: {
                id: payment._id,
                amount: payment.amount,
                status: payment.status,
                idempotencyKey: payment.idempotencyKey,
                gatewayOrderId: payment.gatewayOrderId
            },
            gatewayOrder
        });
    } catch (err: any) {
        logger.error("Error creating payment order", {
            requestId: res.locals.requestId,
            userId,
            error: err
        });
        return res.status(500).json({ message: err.message || "Failed to create payment order" });
    }
}

export async function handleWebhookController(req: Request, res: Response) {
    const signature = req.headers["x-razorpay-signature"] as string || req.headers["signature"] as string || "";
    const rawBody = typeof req.body === "string" || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body);

    // 1. Verify webhook signature
    const isValid = verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
        logger.warn("Invalid webhook signature received", { requestId: res.locals.requestId });
        return res.status(400).json({ message: "Invalid webhook signature" });
    }

    const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const event = payload.event || "payment.captured";
    const paymentEntity = payload.payload?.payment?.entity || payload.payment || payload;

    const gatewayOrderId = paymentEntity.order_id || payload.order_id;
    const gatewayPaymentId = paymentEntity.id || payload.payment_id || `pay_${Date.now()}`;
    const paymentId = paymentEntity.notes?.paymentId || payload.paymentId;

    logger.info("Processing gateway webhook", {
        requestId: res.locals.requestId,
        event,
        gatewayOrderId,
        gatewayPaymentId,
        paymentId
    });

    // Locate Payment
    let payment = null;
    if (paymentId && mongoose.Types.ObjectId.isValid(paymentId)) {
        payment = await PaymentModel.findById(paymentId);
    } else if (gatewayOrderId) {
        payment = await PaymentModel.findOne({ gatewayOrderId });
    }

    if (!payment) {
        logger.warn("Payment record not found for webhook", { gatewayOrderId, paymentId });
        return res.status(404).json({ message: "Payment record not found" });
    }

    // 2. Idempotency Check: If already COMPLETED or FAILED, do nothing
    if (payment.status !== "PENDING") {
        logger.info("Webhook duplicate received. Payment already processed.", {
            paymentId: payment._id,
            status: payment.status
        });
        return res.status(200).json({
            message: "Webhook already processed",
            status: payment.status
        });
    }

    if (event === "payment.failed") {
        payment.status = "FAILED";
        payment.gatewayPaymentId = gatewayPaymentId;
        await payment.save();
        return res.status(200).json({ message: "Payment marked as FAILED" });
    }

    // 3. Process Successful Payment in MongoDB Transaction
    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        // Re-query inside session to prevent concurrent webhook race conditions
        const paymentInSession = await PaymentModel.findOne({
            _id: payment._id,
            status: "PENDING"
        }).session(session);

        if (!paymentInSession) {
            await session.abortTransaction();
            return res.status(200).json({ message: "Payment already processed by concurrent request" });
        }

        paymentInSession.status = "COMPLETED";
        paymentInSession.gatewayPaymentId = gatewayPaymentId;
        await paymentInSession.save({ session });

        // Credit Account balance
        const accountUpdate = await AccountModel.updateOne(
            { _id: paymentInSession.account, status: "active" },
            { $inc: { balance: paymentInSession.amount } },
            { session }
        );

        if (accountUpdate.modifiedCount === 0) {
            throw new Error("Account not found or inactive during wallet credit");
        }

        // Create Immutable CREDIT Ledger record
        await ledgerModel.create(
            [
                {
                    account: paymentInSession.account,
                    amount: paymentInSession.amount,
                    payment: paymentInSession._id,
                    type: "CREDIT"
                }
            ],
            { session }
        );

        await session.commitTransaction();

        logger.info("Wallet successfully credited via webhook", {
            paymentId: paymentInSession._id,
            accountId: paymentInSession.account,
            amount: paymentInSession.amount
        });

        return res.status(200).json({
            message: "Webhook processed and wallet credited successfully",
            status: "COMPLETED"
        });
    } catch (err: any) {
        await session.abortTransaction();
        logger.error("Error committing webhook wallet credit transaction", {
            paymentId: payment._id,
            error: err
        });
        return res.status(500).json({ message: "Failed to process webhook transaction" });
    } finally {
        session.endSession();
    }
}
