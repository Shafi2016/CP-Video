// ============================================================================
// CodePresenter - Standalone Server Entry Point
// ============================================================================
import { suppressNoisyWarnings } from './shared/middleware/logging';
suppressNoisyWarnings();

import dotenv from 'dotenv';
import http from 'http';
import https from 'https';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import express, { type Request, type Response, type NextFunction } from 'express';
import { isOpenAIKeyPresent, clearOpenAIKeyCache, clearGoogleApiKeyCache, isGoogleApiKeyPresent } from './config';
import { getTeachingProviderStatus } from './services/ai-providers';
import stripeRoutes from './stripe-routes';
import { videoRenderRouter } from './video-render-routes';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env (supports both old/new split-folder layouts)
const envCandidates = [
    path.resolve(__dirname, '../../../keys/.env'),
    path.resolve(__dirname, '../../keys/.env'),
    path.resolve(process.cwd(), '../keys/.env'),
    path.resolve(process.cwd(), 'keys/.env'),
    path.resolve(process.cwd(), '.env'),
];
const envPath = envCandidates.find((p) => fs.existsSync(p));
if (envPath) {
    dotenv.config({ path: envPath, override: false });
    console.log(`🔍 Loaded env from: ${envPath}`);
} else {
    dotenv.config({ override: false });
    console.warn('⚠️ No explicit .env found in expected locations; using process environment only');
}
clearOpenAIKeyCache();
clearGoogleApiKeyCache();
console.log('OPENAI_API_KEY present:', isOpenAIKeyPresent());
console.log('GOOGLE_API_KEY present:', isGoogleApiKeyPresent());
console.log('Teaching AI provider:', getTeachingProviderStatus().label);
console.log('ACCESS_CODE present:', !!(process.env.ACCESS_CODE || '').trim());

// Enable TCP keep-alive
http.globalAgent = new http.Agent({ keepAlive: true, maxSockets: 128, maxFreeSockets: 32 });
https.globalAgent = new https.Agent({ keepAlive: true, maxSockets: 128, maxFreeSockets: 32 });

// Cloud Run detection
const IS_CLOUD_RUN = !!process.env.K_SERVICE;
if (IS_CLOUD_RUN) process.env.NODE_ENV = 'production';

// Check optional Jupyter token
if (!process.env.JUPYTER_TOKEN) {
    console.log('ℹ️  JUPYTER_TOKEN not set (optional)');
}

// Import shared middleware
import { createCorsMiddleware, createLoggingMiddleware, setupAccessGate, log } from './shared/middleware';
import { setupVite, serveStatic } from './shared/vite';

import { registerRoutes } from './routes';
import { startKernelGateway } from './jupyter-bridge';
import { secretManager } from './secret-manager';

// Video jobs store
const videoJobs = new Map<string, any>();

function resolveTsxCli(): string | null {
    const candidates = [
        path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.cjs'),
        path.resolve(process.cwd(), '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        path.resolve(process.cwd(), '..', 'node_modules', 'tsx', 'dist', 'cli.cjs'),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

// Setup Express
const app = express();

// Stripe webhook needs raw body for signature verification
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// CORS
const allowedOrigins = [
    process.env.FRONTEND_ORIGIN,
    process.env.CODEPRESENTER_BASE_URL,
    'https://codepresenter2016.web.app',
    'https://codepresenter2016.firebaseapp.com',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://localhost:8081',
    'http://127.0.0.1:5173',
].filter((origin): origin is string => Boolean(origin));
app.use(createCorsMiddleware(allowedOrigins));
app.use(createLoggingMiddleware());

// Access gate
setupAccessGate(
    app,
    ['/'],
    [],
    process.env.COOKIE_DOMAIN
);

app.use((req: Request, _res: Response, next: NextFunction) => {
    const p = req.path;
    if (
        p === '/render-mode' ||
        p.startsWith('/render-mode') ||
        p.startsWith('/uploads') ||
        (req.method === 'GET' && p.startsWith('/api/video/render/'))
    ) {
        return next();
    }
    return next();
});

app.use('/api/video', videoRenderRouter);
app.use('/api/credits', stripeRoutes);
app.use('/api/stripe', stripeRoutes);

// Jupyter Gateway lazy initialization
let jupyterInitialized = false;
let jupyterInitializing = false;
async function ensureJupyterGateway(): Promise<void> {
    if (jupyterInitialized) return;
    if (jupyterInitializing) {
        while (jupyterInitializing) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return;
    }
    jupyterInitializing = true;
    try {
        console.log('🚀 [LAZY INIT] Starting Jupyter Gateway...');
        await startKernelGateway();
        jupyterInitialized = true;
        console.log('✅ [LAZY INIT] Jupyter Gateway ready');
    } catch (e) {
        console.error('❌ [LAZY INIT] Jupyter Gateway failed:', (e as any)?.message || e);
        throw e;
    } finally {
        jupyterInitializing = false;
    }
}

// Health check
app.get('/api/health', (_req, res) => {
    res.json({
        status: 'healthy',
        product: 'codepresenter',
        timestamp: new Date().toISOString(),
        features: {
            openaiApiKey: isOpenAIKeyPresent(),
            googleApiKey: isGoogleApiKeyPresent(),
            teachingProvider: getTeachingProviderStatus(),
            jupyterGateway: jupyterInitialized
        },
        uptime: process.uptime()
    });
});

// Secret management endpoints
app.post('/api/secrets/connect', (req, res) => {
    try {
        const { name, value, sessionId } = req.body;
        if (!name || !value) {
            return res.status(400).json({ success: false, error: 'Name and value are required' });
        }
        const effectiveSessionId = sessionId || 'codepresenter-global';
        process.env[name] = value;
        secretManager.addSecret(effectiveSessionId, name, value);
        console.log(`🔑 Secret "${name}" connected to session ${effectiveSessionId}`);
        res.json({ success: true, sessionId: effectiveSessionId });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to connect secret' });
    }
});

// Video export endpoint
app.post('/api/video/export', async (req, res) => {
    try {
        const { notebook, presentationSpeed } = req.body;
        const jobId = `job-${Date.now()}`;
        videoJobs.set(jobId, { notebook, presentationSpeed });

        const host = req.get('host') || 'localhost:8080';
        const protocol = req.protocol;
        const renderUrl = `${protocol}://${host}/render/export?jobId=${jobId}`;

        console.log(`🎬 Video export requested for: ${renderUrl}`);
        const exportScript = path.resolve(__dirname, '..', '..', 'scripts', 'export-video.ts');
        const tsxCli = resolveTsxCli();
        if (!tsxCli) {
            throw new Error('tsx CLI not found in node_modules; cannot launch notebook export renderer');
        }
        const exportProcess = spawn(process.execPath, [tsxCli, exportScript, `--url=${renderUrl}`], {
            cwd: path.resolve(__dirname, '..'),
            stdio: ['ignore', 'pipe', 'pipe']
        });
        exportProcess.stdout.on('data', (data) => console.log(`[export-video] ${data}`));
        exportProcess.stderr.on('data', (data) => console.warn(`[export-video-err] ${data}`));
        exportProcess.on('error', (error) => {
            console.warn(`[export-video-error] ${(error as any)?.message || error}`);
        });
        exportProcess.on('close', (code) => {
            console.log(`🎬 Video export process closed with code ${code}`);
            setTimeout(() => videoJobs.delete(jobId), 600000);
        });

        res.json({ success: true, message: 'Video export started', jobId });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to start video export' });
    }
});

app.get('/api/video/job/:jobId', (req, res) => {
    const job = videoJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
});

(async () => {
    const server = await registerRoutes(app);
    (server as any).keepAliveTimeout = 620_000;
    (server as any).headersTimeout = 630_000;

    app.use('/api', (_req, res) => {
        res.status(404).json({ error: 'API route not found' });
    });

    // Error handler
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
        const status = err.status || err.statusCode || 500;
        res.status(status).json({ message: err.message || "Internal Server Error" });
    });

    // Vite dev server or static assets
    const rootDir = path.resolve(__dirname, '..');
    if (!IS_CLOUD_RUN && app.get("env") === "development") {
        await setupVite(app, server, rootDir);
    } else {
        try { serveStatic(app, rootDir); } catch (e: any) {
            console.warn(`⚠️  Static assets not served: ${e?.message || e}`);
        }
    }

    // Listen
    const port = Number(process.env.PORT) || 8080;
    server.listen({ port, host: "0.0.0.0" }, () => {
        if ((server as any).initWebSocketServer) {
            (server as any).initWebSocketServer();
        }

        const url = `http://localhost:${port}`;
        log(`CodePresenter server running at: ${url}`);
        console.log(`\n======================================`);
        console.log(`🎬 CodePresenter available at: ${url}`);
        console.log(`======================================\n`);

        if (app.get("env") === "development") {
            import('open').then(m => m.default(url)).catch(() => { });
        }
    });

    // Pre-warm Jupyter after 5 seconds
    setTimeout(async () => {
        try {
            console.log('🔥 Pre-warming Jupyter Gateway...');
            await startKernelGateway();
            console.log('✅ Jupyter Gateway pre-warmed');
        } catch (e) {
            console.log('⚠️ Jupyter Gateway pre-warm failed:', (e as any)?.message);
        }
    }, 5000);

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
        console.log(`\n🔄 Received ${signal}, shutting down...`);
        server.close(() => {
            console.log('✅ CodePresenter server closed');
            process.exit(0);
        });
    };
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
})();
