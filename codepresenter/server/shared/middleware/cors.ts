import { type Request, type Response, type NextFunction } from 'express';

/**
 * Create CORS middleware with configurable allowed origins.
 * Each product can pass its own list of allowed origins.
 */
export function createCorsMiddleware(allowedOrigins: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        const origin = req.headers.origin;
        if (origin && allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Access-Code, X-Requested-With');
        res.setHeader('Access-Control-Allow-Credentials', 'true');

        if (req.method === 'OPTIONS') {
            return res.status(204).end();
        }
        next();
    };
}
