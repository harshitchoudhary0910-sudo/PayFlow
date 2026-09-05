import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger.ts";

export function globalErrorHandler(
    err: any,
    req: Request,
    res: Response,
    next: NextFunction
) {
    const statusCode = err.statusCode || err.status || 500;
    const message = err.isPublic ? err.message : "Internal Server Error";

    logger.error("Unhandled Application Error", {
        requestId: res.locals.requestId,
        userId: res.locals.userId,
        endpoint: req.originalUrl,
        method: req.method,
        status: statusCode,
        error: err
    });

    res.status(statusCode).json({
        error: {
            message: statusCode === 500 && process.env.NODE_ENV === "production"
                ? "An unexpected error occurred. Please try again later."
                : err.message || message,
            statusCode
        }
    });
}
