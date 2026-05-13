import type { Express, Request, Response } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import multer from "multer";
import path from "path";
import fs from "fs";
import { storage } from "./storage";
import { jupyterBridge } from "./jupyter-bridge";
import googleDriveRoutes from "./routes/google-drive";
import voiceRoutes from "./routes/voice";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = new Set([
      ".ipynb",
      ".py",
      ".csv",
      ".xlsx",
      ".xls",
      ".pdf",
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".webp",
      ".svg",
    ]);
    if (!allowed.has(ext)) {
      cb(new Error("Unsupported file type"));
      return;
    }
    cb(null, true);
  },
});

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  let wss: WebSocketServer | null = null;
  let wsInitialized = false;

  app.use("/api/google-drive", googleDriveRoutes);
  app.use("/api/voice", voiceRoutes);

  app.get("/api/notebooks", async (_req, res) => {
    res.json(await storage.getAllNotebooks());
  });

  app.get("/api/notebooks/recent", async (_req, res) => {
    res.json(await storage.getRecentNotebooks(5));
  });

  app.get("/api/notebooks/:id", async (req, res) => {
    const notebookId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(notebookId)) {
      return res.status(400).json({ error: "Invalid notebook ID" });
    }

    const notebook = await storage.getNotebook(notebookId);
    if (!notebook) {
      return res.status(404).json({ error: "Notebook not found" });
    }
    res.json(notebook);
  });

  app.post("/api/notebooks", async (req, res) => {
    try {
      const notebook = await storage.createNotebook(req.body || {});
      res.status(201).json(notebook);
    } catch (error: any) {
      res.status(500).json({ error: `Failed to create notebook: ${error.message}` });
    }
  });

  app.put("/api/notebooks/:id", async (req, res) => {
    const notebookId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(notebookId)) {
      return res.status(400).json({ error: "Invalid notebook ID" });
    }

    const notebook = await storage.updateNotebook(notebookId, req.body || {});
    if (!notebook) {
      return res.status(404).json({ error: "Notebook not found" });
    }
    res.json(notebook);
  });

  app.delete("/api/notebooks/:id", async (req, res) => {
    const notebookId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(notebookId)) {
      return res.status(400).json({ error: "Invalid notebook ID" });
    }

    const deleted = await storage.deleteNotebook(notebookId);
    if (!deleted) {
      return res.status(404).json({ error: "Notebook not found" });
    }
    res.status(204).end();
  });

  app.post("/api/notebooks/upload", (req, res) => {
    upload.single("notebook")(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message || "File upload error" });
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      try {
        const parsed = JSON.parse(req.file.buffer.toString("utf8"));
        if (!Array.isArray(parsed.cells)) {
          return res.status(400).json({ error: "Invalid notebook structure: missing cells array" });
        }

        const filename = req.file.originalname;
        const filePath = path.join(UPLOAD_DIR, filename);
        fs.writeFileSync(filePath, req.file.buffer);

        const cells = parsed.cells.map(convertJupyterCell);
        const notebook = await storage.createNotebook({
          title: path.basename(filename, ".ipynb"),
          cells,
          path: filename,
        });

        res.status(201).json(notebook);
      } catch (error: any) {
        res.status(500).json({ error: `Failed to upload notebook: ${error.message}` });
      }
    });
  });

  app.get("/api/files", (_req, res) => {
    try {
      const files = fs.readdirSync(UPLOAD_DIR)
        .filter((file) => {
          const filePath = path.join(UPLOAD_DIR, file);
          return fs.statSync(filePath).isFile() && !file.startsWith(".");
        })
        .map((file) => {
          const filePath = path.join(UPLOAD_DIR, file);
          const stats = fs.statSync(filePath);
          return {
            name: file,
            path: file,
            localPath: `uploads/${file}`,
            fullPath: `/uploads/${file}`,
            size: stats.size,
            type: path.extname(file).slice(1),
            uploaded: stats.mtime,
          };
        });

      res.json(files);
    } catch (error: any) {
      res.status(500).json({ error: `Failed to fetch files: ${error.message}` });
    }
  });

  app.post("/api/files/upload", (req, res) => {
    upload.single("file")(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message || "File upload error" });
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      try {
        const filename = path.basename(req.file.originalname);
        const filePath = path.join(UPLOAD_DIR, filename);
        if (fs.existsSync(filePath)) {
          return res.status(409).json({ error: "A file with this name already exists." });
        }

        fs.writeFileSync(filePath, req.file.buffer);
        const stats = fs.statSync(filePath);
        const fileInfo: any = {
          name: filename,
          originalName: req.file.originalname,
          path: filename,
          localPath: `uploads/${filename}`,
          fullPath: `/uploads/${filename}`,
          size: stats.size,
          type: path.extname(filename).slice(1),
          uploaded: stats.mtime,
        };

        if (path.extname(filename).toLowerCase() === ".ipynb") {
          const parsed = JSON.parse(req.file.buffer.toString("utf8"));
          const notebook = await storage.createNotebook({
            title: path.basename(filename, ".ipynb"),
            cells: Array.isArray(parsed.cells) ? parsed.cells.map(convertJupyterCell) : [],
            path: filename,
          });
          fileInfo.notebookId = notebook.id;
        }

        res.status(201).json(fileInfo);
      } catch (error: any) {
        res.status(500).json({ error: `Failed to upload file: ${error.message}` });
      }
    });
  });

  app.delete("/api/files/:filename", (req: Request, res: Response) => {
    const filename = path.basename(decodeURIComponent(req.params.filename));
    const filePath = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }
    fs.unlinkSync(filePath);
    res.status(204).end();
  });

  app.use("/uploads", express.static(UPLOAD_DIR));

  const initWebSocketServer = () => {
    if (wsInitialized || wss) return;
    wss = new WebSocketServer({ server: httpServer, path: "/ws" });
    wsInitialized = true;

    wss.on("connection", (ws: WebSocket) => {
      const cleanup = jupyterBridge.handleConnection(ws);
      ws.on("close", cleanup);
    });
  };

  (httpServer as any).initWebSocketServer = initWebSocketServer;
  return httpServer;
}

function convertJupyterCell(cell: any) {
  return {
    id: Math.random().toString(36).slice(2, 11),
    type: cell.cell_type === "code" ? "code" : "markdown",
    content: Array.isArray(cell.source) ? cell.source.join("") : cell.source || "",
    execution_state: "idle",
    execution_count: cell.execution_count ?? null,
    outputs: Array.isArray(cell.outputs) ? cell.outputs : [],
  };
}
