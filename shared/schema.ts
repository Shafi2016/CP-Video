import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Define the users table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

// Create user insert schema
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  email: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Define the notebook table
export const notebooks = pgTable("notebooks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: jsonb("content").notNull().$type<any[]>(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
  path: text("path"),
});

// Create notebook insert schema
export const insertNotebookSchema = createInsertSchema(notebooks).pick({
  title: true,
  content: true,
  path: true,
});

export type InsertNotebook = z.infer<typeof insertNotebookSchema>;
export type Notebook = typeof notebooks.$inferSelect;

// Storage interface types
export interface NotebookListItem {
  id: number;
  title: string;
  lastModified: string;
  path?: string;
}

// Storage interface
export interface IStorage {
  // User operations
  getUser(id: number): Promise<any | undefined>;
  getUserByUsername(username: string): Promise<any | undefined>;
  createUser(user: any): Promise<any>;
  
  // Notebook operations
  getAllNotebooks(): Promise<NotebookListItem[]>;
  getRecentNotebooks(limit: number): Promise<NotebookListItem[]>;
  getNotebook(id: number): Promise<any | undefined>;
  createNotebook(notebook: any): Promise<any>;
  updateNotebook(id: number, notebook: any): Promise<any | undefined>;
  deleteNotebook(id: number): Promise<boolean>;
}
