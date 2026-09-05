import{Router} from "express";
import userRoutes from "./auth.ts";
import accountRoutes from "./account.ts";
import transactionRoutes from "./transaction.ts";
import paymentRoutes from "./payment.ts";
import webhookRoutes from "./webhook.ts";


const router=Router();
router.use("/users", userRoutes);
router.use("/accounts", accountRoutes);
router.use("/transactions", transactionRoutes);
router.use("/payments", paymentRoutes);
router.use("/webhooks", webhookRoutes);


export default router;