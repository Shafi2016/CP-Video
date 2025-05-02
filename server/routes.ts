import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { JupyterService } from "./jupyter-service";

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  
  // Create a WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  // Initialize Jupyter service
  const jupyterService = new JupyterService();
  
  // WebSocket connection handling
  wss.on('connection', (ws: WebSocket) => {
    console.log('Client connected to WebSocket');
    
    // Set up Jupyter service for this connection
    const cleanup = jupyterService.registerClient(ws);
    
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        await jupyterService.handleMessage(data, ws);
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          content: {
            error: 'Invalid message format'
          }
        }));
      }
    });
    
    ws.on('close', () => {
      console.log('Client disconnected from WebSocket');
      cleanup();
    });
  });

  // API routes
  // List all notebooks
  app.get('/api/notebooks', async (req, res) => {
    try {
      const notebooks = await storage.getAllNotebooks();
      res.json(notebooks);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch notebooks' });
    }
  });
  
  // Get recent notebooks
  app.get('/api/notebooks/recent', async (req, res) => {
    try {
      const notebooks = await storage.getRecentNotebooks(5);
      res.json(notebooks);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch recent notebooks' });
    }
  });
  
  // Get a specific notebook
  app.get('/api/notebooks/:id', async (req, res) => {
    try {
      const notebook = await storage.getNotebook(parseInt(req.params.id));
      if (!notebook) {
        return res.status(404).json({ error: 'Notebook not found' });
      }
      res.json(notebook);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch notebook' });
    }
  });
  
  // Create a new notebook
  app.post('/api/notebooks', async (req, res) => {
    try {
      const notebook = await storage.createNotebook(req.body);
      res.status(201).json(notebook);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create notebook' });
    }
  });
  
  // Update a notebook
  app.put('/api/notebooks/:id', async (req, res) => {
    try {
      const notebook = await storage.updateNotebook(parseInt(req.params.id), req.body);
      if (!notebook) {
        return res.status(404).json({ error: 'Notebook not found' });
      }
      res.json(notebook);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update notebook' });
    }
  });
  
  // Delete a notebook
  app.delete('/api/notebooks/:id', async (req, res) => {
    try {
      const success = await storage.deleteNotebook(parseInt(req.params.id));
      if (!success) {
        return res.status(404).json({ error: 'Notebook not found' });
      }
      res.status(204).end();
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete notebook' });
    }
  });

  return httpServer;
}
