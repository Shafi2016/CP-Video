import * as fs from "fs";
import * as path from "path";

export interface NotebookListItem {
  id: number;
  title: string;
  lastModified: string;
  path?: string;
}

interface Notebook {
  id: number;
  title: string;
  content: any[];
  cells: any[];
  created_at: string;
  updated_at: string;
  path?: string;
}

class MemStorage {
  private notebooks = new Map<number, Notebook>();
  private notebookCurrentId = 1;
  private notebooksDir: string;

  constructor() {
    this.notebooksDir = path.join(process.cwd(), "notebooks");
    fs.mkdirSync(this.notebooksDir, { recursive: true });
    this.loadExistingNotebooks();
    console.log(`Notebooks will be stored in: ${this.notebooksDir}`);
  }

  async getAllNotebooks(): Promise<NotebookListItem[]> {
    return Array.from(this.notebooks.values()).map((notebook) => ({
      id: notebook.id,
      title: notebook.title,
      lastModified: notebook.updated_at,
      path: notebook.path || "",
    }));
  }

  async getRecentNotebooks(limit: number): Promise<NotebookListItem[]> {
    return Array.from(this.notebooks.values())
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, limit)
      .map((notebook) => ({
        id: notebook.id,
        title: notebook.title,
        lastModified: notebook.updated_at,
        path: notebook.path || "",
      }));
  }

  async getNotebook(id: number): Promise<Notebook | undefined> {
    return this.notebooks.get(id);
  }

  async createNotebook(notebook: any): Promise<Notebook> {
    const id = this.notebookCurrentId++;
    const now = new Date().toISOString();
    const title = notebook.title || "Untitled Notebook";
    const cells = Array.isArray(notebook.cells) ? notebook.cells : [];
    const filename = notebook.path || `${sanitizeFilename(title)}_${id}.ipynb`;

    const newNotebook: Notebook = {
      id,
      title,
      content: cells,
      cells,
      path: filename,
      created_at: now,
      updated_at: now,
    };

    this.notebooks.set(id, newNotebook);
    this.writeNotebookFile(newNotebook);
    return newNotebook;
  }

  async updateNotebook(id: number, notebook: any): Promise<Notebook | undefined> {
    const existingNotebook = this.notebooks.get(id);
    if (!existingNotebook) return undefined;

    const cells = Array.isArray(notebook.cells) ? notebook.cells : existingNotebook.cells;
    const updatedNotebook: Notebook = {
      ...existingNotebook,
      ...notebook,
      id,
      title: notebook.title || existingNotebook.title,
      content: cells,
      cells,
      updated_at: new Date().toISOString(),
    };

    this.notebooks.set(id, updatedNotebook);
    this.writeNotebookFile(updatedNotebook);
    return updatedNotebook;
  }

  async deleteNotebook(id: number): Promise<boolean> {
    const notebook = this.notebooks.get(id);
    if (notebook?.path) {
      const filePath = this.resolveNotebookPath(notebook.path);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    return this.notebooks.delete(id);
  }

  private loadExistingNotebooks() {
    const files = fs.existsSync(this.notebooksDir)
      ? fs.readdirSync(this.notebooksDir).filter((file) => file.toLowerCase().endsWith(".ipynb"))
      : [];

    for (const file of files) {
      const filePath = path.join(this.notebooksDir, file);
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const cells = convertJupyterCells(parsed.cells || []);
        const id = this.notebookCurrentId++;
        const stats = fs.statSync(filePath);
        this.notebooks.set(id, {
          id,
          title: path.basename(file, ".ipynb"),
          content: cells,
          cells,
          path: file,
          created_at: stats.birthtime.toISOString(),
          updated_at: stats.mtime.toISOString(),
        });
      } catch (error) {
        console.warn(`Skipping unreadable notebook ${file}:`, error);
      }
    }
  }

  private resolveNotebookPath(notebookPath: string): string {
    return path.isAbsolute(notebookPath)
      ? notebookPath
      : path.join(this.notebooksDir, path.basename(notebookPath));
  }

  private writeNotebookFile(notebook: Notebook) {
    if (!notebook.path) return;
    const filePath = this.resolveNotebookPath(notebook.path);
    const jupyterNotebook = {
      cells: notebook.cells.map((cell: any) => ({
        cell_type: cell.type === "code" ? "code" : "markdown",
        source: splitSource(cell.content || ""),
        metadata: {},
        execution_count: cell.execution_count ?? null,
        outputs: Array.isArray(cell.outputs) ? cell.outputs : [],
      })),
      metadata: {
        kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
        language_info: { name: "python", version: "3.8" },
      },
      nbformat: 4,
      nbformat_minor: 4,
    };

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(jupyterNotebook, null, 2));
  }
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "_").toLowerCase() || "untitled_notebook";
}

function splitSource(source: string): string[] {
  const lines = source.split("\n");
  return lines.map((line, index) => (index === lines.length - 1 ? line : `${line}\n`));
}

function convertJupyterCells(cells: any[]): any[] {
  return cells.map((cell) => ({
    id: Math.random().toString(36).slice(2, 11),
    type: cell.cell_type === "code" ? "code" : "markdown",
    content: Array.isArray(cell.source) ? cell.source.join("") : cell.source || "",
    execution_state: "idle",
    execution_count: cell.execution_count ?? null,
    outputs: Array.isArray(cell.outputs) ? cell.outputs : [],
  }));
}

export const storage = new MemStorage();
