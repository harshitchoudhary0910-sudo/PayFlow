export interface LogContext {
    requestId?: string;
    userId?: string;
    endpoint?: string;
    method?: string;
    operation?: string;
    transactionId?: string;
    paymentId?: string;
    status?: number | string;
    durationMs?: number;
    error?: any;
    [key: string]: any;
}

export const logger = {
    info(message: string, context: LogContext = {}) {
        console.log(
            JSON.stringify({
                level: "INFO",
                timestamp: new Date().toISOString(),
                message,
                ...context
            })
        );
    },

    warn(message: string, context: LogContext = {}) {
        console.warn(
            JSON.stringify({
                level: "WARN",
                timestamp: new Date().toISOString(),
                message,
                ...context
            })
        );
    },

    error(message: string, context: LogContext = {}) {
        console.error(
            JSON.stringify({
                level: "ERROR",
                timestamp: new Date().toISOString(),
                message,
                errorDetails: context.error?.message || context.error,
                stack: context.error?.stack,
                ...context
            })
        );
    }
};
