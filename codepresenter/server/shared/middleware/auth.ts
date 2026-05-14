import { type Request, type Response, type NextFunction } from 'express';
import type { Express } from 'express';

/**
 * Cookie parser helper (avoids extra deps).
 */
export function getCookie(req: Request, name: string): string | undefined {
    const raw = req.headers?.cookie || '';
    const parts = raw.split(';').map((p) => p.trim());
    for (const p of parts) {
        if (!p) continue;
        const eq = p.indexOf('=');
        if (eq === -1) continue;
        const k = decodeURIComponent(p.slice(0, eq));
        const v = decodeURIComponent(p.slice(eq + 1));
        if (k === name) return v;
    }
    return undefined;
}

/** Inline HTML for access code form */
const accessHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Enter Access Code</title><style>body{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0} .card{background:#111827;border:1px solid #334155;border-radius:12px;padding:28px;max-width:360px;width:92%} h1{font-size:18px;margin:0 0 12px 0} p{font-size:13px;color:#94a3b8;margin:0 0 16px 0} input{width:100%;padding:10px 12px;border:1px solid #334155;border-radius:8px;background:#0b1220;color:#e2e8f0;outline:none} button{margin-top:12px;width:100%;padding:10px 12px;border:0;border-radius:8px;background:#2563eb;color:white;cursor:pointer} .err{color:#f87171;font-size:12px;margin-top:10px;display:none}</style></head><body><div class="card"><h1>Restricted Access</h1><p>Please enter the access code.</p><input id="code" placeholder="Access code" type="password" autocomplete="one-time-code"/><button id="btn">Continue</button><div id="err" class="err">Invalid code</div></div><script>const btn=document.getElementById('btn');const err=document.getElementById('err');btn.onclick=async()=>{err.style.display='none';const code=(document.getElementById('code')).value.trim();try{const res=await fetch('/api/access/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});if(res.ok){location.reload();}else{err.style.display='block';}}catch(e){err.style.display='block';}}</script></body></html>`;

/**
 * Setup access gate routes and middleware.
 * @param app - Express app
 * @param protectedPaths - Array of path prefixes that require auth
 * @param publicApiPaths - Array of API path prefixes that are always public
 * @param cookieDomain - Optional cookie domain for production subdomain sharing.
 */
export function setupAccessGate(
    app: Express,
    protectedPaths: string[],
    publicApiPaths: string[] = [],
    cookieDomain?: string
) {
    const ACCESS_CODE = (process.env.ACCESS_CODE || '').trim();

    // Login route
    app.post('/api/access/login', (req: Request, res: Response) => {
        try {
            if (!ACCESS_CODE) return res.status(200).json({ ok: true, note: 'ACCESS_CODE not set; gate disabled' });
            const { code } = req.body || {};
            const normalizedCode = typeof code === 'string' ? code.toUpperCase() : '';
            const normalizedAccessCode = ACCESS_CODE.toUpperCase();

            if (normalizedCode !== normalizedAccessCode) {
                return res.status(401).json({ ok: false });
            }

            const isProd = app.get('env') !== 'development';
            let cookie = `access=${encodeURIComponent(code)}; Path=/; HttpOnly; SameSite=Lax${isProd ? '; Secure' : ''}`;
            if (cookieDomain && isProd) {
                cookie += `; Domain=${cookieDomain}`;
            }
            res.setHeader('Set-Cookie', cookie);
            return res.json({ ok: true });
        } catch (e) {
            console.error('Error in access login:', e);
            return res.status(500).json({ ok: false });
        }
    });

    // Check auth status
    app.get('/api/access/check', (req: Request, res: Response) => {
        if (!ACCESS_CODE) return res.status(200).json({ ok: true });
        const cookie = getCookie(req, 'access');
        if (cookie && cookie.toUpperCase() === ACCESS_CODE.toUpperCase()) {
            return res.status(200).json({ ok: true });
        }
        return res.status(401).json({ ok: false });
    });

    // Logout
    app.post('/api/access/logout', (_req: Request, res: Response) => {
        const isProd = app.get('env') !== 'development';
        let cookie = `access=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${isProd ? '; Secure' : ''}`;
        if (cookieDomain && isProd) {
            cookie += `; Domain=${cookieDomain}`;
        }
        res.setHeader('Set-Cookie', cookie);
        res.json({ ok: true });
    });

    // Gate middleware
    app.use((req: Request, res: Response, next: NextFunction) => {
        if (!ACCESS_CODE) return next();

        const p = req.path;

        // Always allow these publicly
        if (
            p === '/' ||
            p.startsWith('/api/access/') ||
            p.startsWith('/api/health') ||
            p === '/render-mode' ||
            p.startsWith('/render-mode') ||
            p.startsWith('/uploads') ||
            (req.method === 'GET' && p.startsWith('/api/video/render/')) ||
            p.startsWith('/assets') ||
            p.startsWith('/public') ||
            p.startsWith('/favicon') ||
            p.match(/\.(js|css|png|jpg|jpeg|svg|ico|map|woff|woff2|ttf|eot)$/)
        ) {
            return next();
        }

        // Allow product-specific public API paths
        for (const apiPath of publicApiPaths) {
            if (p.startsWith(apiPath)) return next();
        }

        // Check if this is a protected route
        const isProtectedRoute = protectedPaths.some(path => p.startsWith(path));
        if (!isProtectedRoute) return next();

        const cookie = getCookie(req, 'access');
        if (cookie && cookie.toUpperCase() === ACCESS_CODE.toUpperCase()) return next();

        // If it's an API route that is protected, block it
        if (p.startsWith('/api')) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        return res.status(401).type('html').send(accessHtml);
    });
}
