import mongoose from "mongoose";

export interface IPayment extends mongoose.Document {
    account: mongoose.Types.ObjectId;
    user: mongoose.Types.ObjectId;
    amount: number;
    status: "PENDING" | "COMPLETED" | "FAILED";
    gatewayOrderId?: string;
    gatewayPaymentId?: string;
    idempotencyKey: string;
    createdAt: Date;
    updatedAt: Date;
}

const paymentSchema = new mongoose.Schema<IPayment>(
    {
        account: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "accounts",
            required: [true, "Payment must be associated with an account"],
            index: true
        },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "users",
            required: [true, "Payment must be associated with a user"],
            index: true
        },
        amount: {
            type: Number,
            required: [true, "Payment amount is required"],
            min: [0.01, "Payment amount must be greater than 0"]
        },
        status: {
            type: String,
            enum: ["PENDING", "COMPLETED", "FAILED"],
            default: "PENDING",
            index: true
        },
        gatewayOrderId: {
            type: String,
            index: true
        },
        gatewayPaymentId: {
            type: String,
            index: true
        },
        idempotencyKey: {
            type: String,
            required: [true, "Idempotency Key is required for creating a payment"],
            unique: true,
            index: true
        }
    },
    {
        timestamps: true
    }
);

const PaymentModel = mongoose.model<IPayment>("payments", paymentSchema);
export default PaymentModel;
