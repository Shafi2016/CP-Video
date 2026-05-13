import { type Request, type Response, type NextFunction } from 'express';

/**
 * Suppress noisy Agent SDK warnings. Must be called BEFORE any imports.
 */
export function suppressNoisyWarnings() {
    const originalConsoleWarn = console.warn;
    console.warn = (...args: any[]) => {
        const message = args.join(' ');
        if (message.includes('Handoff agents have different output types') ||
            message.includes('Agent.create')) {
            return;
        }
        originalConsoleWarn.apply(console, args);
    };
}

/**
 * Log helper with timestamp and source tag.
 */
export function log(message: string, source = "express") {
    const formattedTime = new Date().toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    });
    console.log(`${formattedTime} [${source}] ${message}`);
}

/**
 * Request logging middleware. Only logs API requests when DEBUG_API=true.
 */
export function createLoggingMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
        const start = Date.now();
        const path = req.path;
        let capturedJsonResponse: Record<string, any> | undefined = undefined;

        const originalResJson = res.json;
        res.json = function (bodyJson: any, ...args: any[]) {
            capturedJsonResponse = bodyJson;
            return originalResJson.call(res, bodyJson);
        };

        res.on("finish", () => {
            const duration = Date.now() - start;
            if (path.startsWith("/api") && process.env.DEBUG_API === 'true') {
                let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
                if (capturedJsonResponse) {
                    logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
                }
                if (logLine.length > 80) {
                    logLine = logLine.slice(0, 79) + "…";
                }
                log(logLine, "express");
            }
        });

        next();
    };
}
