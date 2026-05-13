import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    plugins: [react()],
    base: '/',
    resolve: {
        alias: [
            // Product-specific pages/App first (higher priority)
            { find: /^@\/pages\/(.*)/, replacement: path.resolve(__dirname, './client/src/pages/$1') },
            { find: /^@\/App/, replacement: path.resolve(__dirname, './client/src/App') },
            { find: /^@\/contexts\/AuthContext$/, replacement: path.resolve(__dirname, './client/src/contexts/AuthContext.tsx') },
            { find: /^@\/lib\/firebase$/, replacement: path.resolve(__dirname, './client/src/lib/firebase.ts') },
            { find: '@', replacement: path.resolve(__dirname, './client/src') },
            { find: '@assets', replacement: path.resolve(__dirname, "./client/public") },
        ],
    },
    root: path.resolve(__dirname, "client"),
    build: {
        outDir: path.resolve(__dirname, "dist/public"),
        emptyOutDir: true,
    },
    server: {
        fs: {
            allow: [
                path.resolve(__dirname),
            ],
        },
    },
    define: {
        global: 'globalThis',
    },
    cacheDir: path.resolve(__dirname, 'node_modules/.vite-cache'),
    optimizeDeps: {
        force: false,
        esbuildOptions: {
            target: 'es2020'
        }
    }
});
