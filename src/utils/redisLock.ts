import { redisClient, getRedisClient } from "../config/redis.ts";
import { randomUUID } from "crypto";

const inMemoryLocks = new Map<string, { token: string; expiresAt: number }>();

/**
 * Acquire a distributed lock.
 * Uses Redis SET NX PX. If Redis is unavailable, falls back to in-memory lock.
 * Returns lock token if acquired, or null if lock is already held.
 */
export async function acquireLock(
    lockKey: string,
    ttlMs: number = 10000
): Promise<string | null> {
    const token = randomUUID();
    
    try {
        await getRedisClient();
        if (redisClient.status === "ready") {
            const result = await redisClient.set(lockKey, token, "PX", ttlMs, "NX");
            if (result === "OK") {
                return token;
            }
            return null;
        }
    } catch (err) {
        // Redis error fallback
    }

    // In-memory fallback for testing / offline redis
    const now = Date.now();
    const existing = inMemoryLocks.get(lockKey);
    if (existing && existing.expiresAt > now) {
        return null; // Lock held
    }

    inMemoryLocks.set(lockKey, { token, expiresAt: now + ttlMs });
    return token;
}

/**
 * Release a distributed lock.
 * Uses atomic Lua script in Redis so worker A never releases worker B's expired lock.
 */
export async function releaseLock(
    lockKey: string,
    token: string
): Promise<boolean> {
    try {
        await getRedisClient();
        if (redisClient.status === "ready") {
            const luaScript = `
                if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("del", KEYS[1])
                else
                    return 0
                end
            `;
            const result = await redisClient.eval(luaScript, 1, lockKey, token);
            return result === 1;
        }
    } catch (err) {
        // Fallback
    }

    // In-memory fallback release
    const existing = inMemoryLocks.get(lockKey);
    if (existing && existing.token === token) {
        inMemoryLocks.delete(lockKey);
        return true;
    }
    return false;
}