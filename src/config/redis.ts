import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

export const redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    retryStrategy(times) {
        if (times > 5) {
            console.warn("Redis connection retries exceeded limit.");
            return null;
        }
        return Math.min(times * 100, 2000);
    }
});

redisClient.on("error", (err) => {
    // Prevent unhandled error crashes if redis is temporarily unavailable
    console.error("[Redis Error]", err.message);
});

export async function getRedisClient() {
    if (redisClient.status === "wait" || redisClient.status === "close") {
        try {
            await redisClient.connect();
        } catch (err: any) {
            console.warn("Failed to connect to Redis:", err.message);
        }
    }
    return redisClient;
}
