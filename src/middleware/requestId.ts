import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

export function requestIdMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const existingHeader = req.headers["x-request-id"];
    const requestId = typeof existingHeader === "string" ? existingHeader : randomUUID();

    res.locals.requestId = requestId;
    res.setHeader("X-Request-ID", requestId);
    next();
}
