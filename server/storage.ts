import { type IStorage, type NotebookListItem } from "@shared/schema";

// User interface
interface User {
  id: number;
  username: string;
  email: string;
  password: string;
  created_at: string;
}

// User insert interface
interface InsertUser {
  username: string;
  email: string;
  password: string;
}

// Notebook interface
interface Notebook {
  id: number;
  title: string;
  content: any[];
  created_at: string;
  updated_at: string;
  path?: string;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private notebooks: Map<number, Notebook>; // Store notebooks
  userCurrentId: number;
  notebookCurrentId: number;

  constructor() {
    this.users = new Map();
    this.notebooks = new Map();
    this.userCurrentId = 1;
    this.notebookCurrentId = 1;
  }

  // User operations
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userCurrentId++;
    const now = new Date().toISOString();
    const user: User = { 
      ...insertUser, 
      id, 
      created_at: now 
    };
    this.users.set(id, user);
    return user;
  }

  // Notebook operations
  async getAllNotebooks(): Promise<NotebookListItem[]> {
    return Array.from(this.notebooks.values()).map(notebook => ({
      id: notebook.id,
      title: notebook.title,
      lastModified: notebook.updated_at || new Date().toISOString(),
      path: notebook.path || ''
    }));
  }

  async getRecentNotebooks(limit: number): Promise<NotebookListItem[]> {
    return Array.from(this.notebooks.values())
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, limit)
      .map(notebook => ({
        id: notebook.id,
        title: notebook.title,
        lastModified: notebook.updated_at || new Date().toISOString(),
        path: notebook.path || ''
      }));
  }

  async getNotebook(id: number): Promise<Notebook | undefined> {
    return this.notebooks.get(id);
  }

  async createNotebook(notebook: any): Promise<Notebook> {
    const id = this.notebookCurrentId++;
    const now = new Date().toISOString();
    const newNotebook: Notebook = {
      ...notebook,
      id,
      content: notebook.content || [],
      created_at: now,
      updated_at: now
    };
    this.notebooks.set(id, newNotebook);
    return newNotebook;
  }

  async updateNotebook(id: number, notebook: any): Promise<Notebook | undefined> {
    if (!this.notebooks.has(id)) {
      return undefined;
    }
    
    const existingNotebook = this.notebooks.get(id)!;
    const updatedNotebook: Notebook = {
      ...existingNotebook,
      ...notebook,
      id, // Ensure ID doesn't change
      updated_at: new Date().toISOString()
    };
    
    this.notebooks.set(id, updatedNotebook);
    return updatedNotebook;
  }

  async deleteNotebook(id: number): Promise<boolean> {
    return this.notebooks.delete(id);
  }
}

export const storage = new MemStorage();
