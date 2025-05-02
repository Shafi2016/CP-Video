import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { jupyterBridge } from "./jupyter-bridge";
import multer from "multer";
import path from "path";
import fs from "fs";

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (_req, file, cb) => {
    // Only accept .ipynb files
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.ipynb') {
      return cb(new Error('Only .ipynb files are allowed'));
    }
    cb(null, true);
  },
});

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  
  // Create a WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  // Initialize Jupyter server
  try {
    await jupyterBridge.initializeJupyterServer();
    console.log('Jupyter server initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Jupyter server:', error);
  }
  
  // WebSocket connection handling
  wss.on('connection', (ws: WebSocket) => {
    console.log('Client connected to WebSocket');
    
    // Set up Jupyter bridge for this connection
    const cleanup = jupyterBridge.handleConnection(ws);
    
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
  
  // Upload an .ipynb file
  app.post('/api/notebooks/upload', upload.single('notebook'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Parse the uploaded .ipynb file
      const fileContent = req.file.buffer.toString('utf-8');
      let notebookData;
      
      try {
        notebookData = JSON.parse(fileContent);
      } catch (parseError) {
        return res.status(400).json({ error: 'Invalid notebook format' });
      }
      
      // Extract cells and convert them to our format
      if (!notebookData.cells || !Array.isArray(notebookData.cells)) {
        return res.status(400).json({ error: 'Invalid notebook structure: missing cells array' });
      }
      
      // Create a new notebook with the basic info
      const fileName = req.file.originalname.replace('.ipynb', '');
      const title = fileName || 'Uploaded Notebook';
      
      // Convert cells to our format
      const cells = notebookData.cells.map((cell: any) => {
        // Default structure for a cell
        const convertedCell = {
          id: Math.random().toString(36).substring(2, 11),
          type: cell.cell_type === 'markdown' ? 'markdown' : 'code',
          content: cell.source ? (Array.isArray(cell.source) ? cell.source.join('') : cell.source) : '',
          execution_state: 'idle',
          execution_count: cell.execution_count || null,
          outputs: []
        };
        
        // Convert outputs if they exist and it's a code cell
        if (cell.cell_type === 'code' && cell.outputs && Array.isArray(cell.outputs)) {
          convertedCell.outputs = cell.outputs.map((output: any) => {
            // Handle different output types
            if (output.output_type === 'stream') {
              return {
                id: Math.random().toString(36).substring(2, 11),
                output_type: 'stream',
                name: output.name || 'stdout',
                text: Array.isArray(output.text) ? output.text : [output.text]
              };
            } else if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
              return {
                id: Math.random().toString(36).substring(2, 11),
                output_type: output.output_type,
                data: output.data || {},
                execution_count: output.execution_count
              };
            } else if (output.output_type === 'error') {
              return {
                id: Math.random().toString(36).substring(2, 11),
                output_type: 'error',
                ename: output.ename,
                evalue: output.evalue,
                traceback: output.traceback
              };
            }
            
            // Default fallback
            return {
              id: Math.random().toString(36).substring(2, 11),
              output_type: output.output_type,
              data: output.data || {}
            };
          });
        }
        
        return convertedCell;
      });
      
      // Create a notebook object
      const notebook = {
        title,
        cells,
        path: req.file.originalname
      };
      
      // Save the notebook
      const savedNotebook = await storage.createNotebook(notebook);
      
      res.status(201).json(savedNotebook);
    } catch (error: any) {
      console.error('Error uploading notebook:', error);
      res.status(500).json({ error: 'Failed to upload notebook: ' + error.message });
    }
  });

  return httpServer;
}
