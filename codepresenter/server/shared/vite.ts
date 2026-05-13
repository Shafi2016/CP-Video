import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import { fileURLToPath } from 'url';

const viteLogger = createLogger();

/**
 * Setup Vite dev server middleware.
 * @param app - Express app
 * @param server - HTTP server
 * @param rootDir - Project root directory (where vite.config.ts is)
 */
export async function setupVite(app: Express, server: Server, rootDir: string) {
    const serverOptions = {
        middlewareMode: true,
        hmr: {
            server,
            timeout: 0,
            overlay: false,
            port: 24678
        },
        allowedHosts: ['localhost', '127.0.0.1'],
    };

    const viteConfigFile = path.resolve(rootDir, "vite.config.ts");
    const vite = await createViteServer({
        configFile: viteConfigFile,
        customLogger: {
            ...viteLogger,
            error: (msg, options) => {
                if (msg && (msg.includes('WebSocket') || msg.includes('hmr') || msg.includes('reload'))) {
                    viteLogger.warn(msg, options);
                    return;
                }
                viteLogger.error(msg, options);
                process.exit(1);
            },
        },
        server: serverOptions,
        appType: "custom",
        optimizeDeps: {
            force: true
        }
    });

    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
        const url = req.originalUrl;
        try {
            const clientTemplate = path.resolve(rootDir, "client", "index.html");
            let template = await fs.promises.readFile(clientTemplate, "utf-8");
            template = template.replace('<head>', `<head>
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
    <meta http-equiv="Pragma" content="no-cache" />
    <meta http-equiv="Expires" content="0" />`);
            const page = await vite.transformIndexHtml(url, template);
            res.status(200).set({ "Content-Type": "text/html" }).end(page);
        } catch (e) {
            vite.ssrFixStacktrace(e as Error);
            next(e);
        }
    });
}

/**
 * Serve static built assets in production.
 * @param app - Express app
 * @param rootDir - Project root directory (dist/public should be relative to this)
 */
export function serveStatic(app: Express, rootDir: string) {
    const distPath = path.resolve(rootDir, "dist", "public");

    if (!fs.existsSync(distPath)) {
        throw new Error(
            `Could not find the build directory: ${distPath}, make sure to build the client first`,
        );
    }

    app.use(express.static(distPath));
    app.use("*", (_req, res) => {
        res.sendFile(path.resolve(distPath, "index.html"));
    });
}
