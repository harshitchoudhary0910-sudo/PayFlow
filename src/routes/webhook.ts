import { Router } from "express";
import { rateLimiter } from "../middleware/rateLimiter.ts";
import { handleWebhookController } from "../controllers/payment.controller.ts";

const router = Router();

/**
 * POST /api/v1/webhooks/payment
 * Unauthenticated public webhook endpoint with rate-limiting and HMAC signature verification
 */
router.post(
    "/payment",
    rateLimiter(30, 60),
    handleWebhookController
);

export default router;
