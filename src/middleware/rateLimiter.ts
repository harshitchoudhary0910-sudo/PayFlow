import type { Request, Response, NextFunction } from "express";
import { redisClient, getRedisClient } from "../config/redis.ts";

const memoryCounters = new Map<string, { count: number; resetAt: number }>();

/**
 * Creates a rate-limiting middleware using Redis sliding/fixed window.
 * @param limit Max requests allowed in window
 * @param windowSecs Window duration in seconds
 */
export function rateLimiter(limit: number = 10, windowSecs: number = 60) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const identifier = res.locals.userId || req.ip || "global";
        const key = `ratelimit:${req.path}:${identifier}`;

        try {
            await getRedisClient();
            if (redisClient.status === "ready") {
                const current = await redisClient.incr(key);
                if (current === 1) {
                    await redisClient.expire(key, windowSecs);
                }

                if (current > limit) {
                    const ttl = await redisClient.ttl(key);
                    res.setHeader("Retry-After", ttl > 0 ? ttl : windowSecs);
                    return res.status(429).json({
                        error: "Too Many Requests",
                        message: `Rate limit exceeded. Please try again in ${ttl} seconds.`
                    });
                }
                return next();
            }
        } catch (err) {
            // Redis error fallback to memory map
        }

        // In-memory fallback
        const now = Date.now();
        const record = memoryCounters.get(key);

        if (!record || record.resetAt <= now) {
            memoryCounters.set(key, { count: 1, resetAt: now + windowSecs * 1000 });
            return next();
        }

        record.count++;
        if (record.count > limit) {
            const retryInSecs = Math.ceil((record.resetAt - now) / 1000);
            res.setHeader("Retry-After", retryInSecs);
            return res.status(429).json({
                error: "Too Many Requests",
                message: `Rate limit exceeded. Please try again in ${retryInSecs} seconds.`
            });
        }

        return next();
    };
}
