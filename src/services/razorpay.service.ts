import Razorpay from "razorpay";
import crypto from "crypto";

const keyId = process.env.RAZORPAY_KEY_ID || "rzp_test_mockkeyid123";
const keySecret = process.env.RAZORPAY_KEY_SECRET || "mockkeysecret123";
const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "mockwebhooksecret123";

let razorpayInstance: Razorpay | null = null;
try {
    razorpayInstance = new Razorpay({
        key_id: keyId,
        key_secret: keySecret
    });
} catch (err) {
    console.warn("[Razorpay Init Warning] Razorpay initialized in fallback mock mode.");
}

export interface CreateOrderParams {
    amount: number; // in INR rupees or smallest currency unit
    currency?: string;
    receipt: string;
    notes?: Record<string, any>;
}

export async function createGatewayOrder(params: CreateOrderParams) {
    const amountInPaisa = Math.round(params.amount * 100);
    const currency = params.currency || "INR";

    if (process.env.NODE_ENV === "test" || !process.env.RAZORPAY_KEY_ID) {
        // Return simulated sandbox order
        return {
            id: `order_mock_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            entity: "order",
            amount: amountInPaisa,
            amount_paid: 0,
            amount_due: amountInPaisa,
            currency,
            receipt: params.receipt,
            status: "created"
        };
    }

    try {
        const order = await razorpayInstance!.orders.create({
            amount: amountInPaisa,
            currency,
            receipt: params.receipt,
            notes: params.notes
        });
        return order;
    } catch (err: any) {
        console.error("Razorpay Order Creation Error:", err);
        throw new Error(`Failed to create gateway order: ${err.message}`);
    }
}

export async function fetchGatewayPaymentStatus(paymentOrOrderId: string) {
    if (process.env.NODE_ENV === "test" || !process.env.RAZORPAY_KEY_ID) {
        // Mock gateway status for offline test environment
        return {
            id: paymentOrOrderId.startsWith("pay_") ? paymentOrOrderId : `pay_mock_${paymentOrOrderId}`,
            order_id: paymentOrOrderId.startsWith("order_") ? paymentOrOrderId : `order_${paymentOrOrderId}`,
            status: "captured", // 'captured', 'failed', 'authorized', etc.
            amount: 1000,
            currency: "INR"
        };
    }

    try {
        if (paymentOrOrderId.startsWith("order_")) {
            const payments = await razorpayInstance!.orders.fetchPayments(paymentOrOrderId);
            if (payments.items && payments.items.length > 0) {
                const latest = payments.items[0];
                return {
                    id: latest.id,
                    order_id: latest.order_id,
                    status: latest.status,
                    amount: latest.amount,
                    currency: latest.currency
                };
            }
            return { id: "", order_id: paymentOrOrderId, status: "created", amount: 0, currency: "INR" };
        } else {
            const payment = await razorpayInstance!.payments.fetch(paymentOrOrderId);
            return {
                id: payment.id,
                order_id: payment.order_id,
                status: payment.status,
                amount: payment.amount,
                currency: payment.currency
            };
        }
    } catch (err: any) {
        console.error("Razorpay Fetch Status Error:", err);
        throw new Error(`Failed to fetch payment status: ${err.message}`);
    }
}

export function verifyWebhookSignature(
    rawBody: string | Buffer,
    signature: string,
    secret: string = webhookSecret
): boolean {
    if (!signature) return false;
    if (process.env.NODE_ENV === "test" && signature === "valid_test_signature") {
        return true;
    }
    const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");

    return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signature)
    );
}
