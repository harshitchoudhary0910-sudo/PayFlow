import { Router } from "express";
import { authMiddleware } from "../middleware/auth.ts";
import { validate } from "../middleware/validation.ts";
import { rateLimiter } from "../middleware/rateLimiter.ts";
import { createPaymentSchema } from "../schemas/payment.Schema.ts";
import { createPaymentController } from "../controllers/payment.controller.ts";

const router = Router();

/**
 * POST /api/v1/payments/create
 * Authenticated endpoint to initiate external payment / add money
 */
router.post(
    "/create",
    authMiddleware,
    rateLimiter(10, 60),
    validate(createPaymentSchema),
    createPaymentController
); 

export default router;
