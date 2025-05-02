export type CellType = "code" | "markdown";
export type CellExecutionState = "idle" | "running" | "complete" | "error";

export interface CellOutput {
  id: string;
  output_type: string;
  data?: {
    [key: string]: any;
  };
  text?: string[];
  html?: string;
  traceback?: string[];
  execution_count?: number;
  error?: string;
}

export interface Cell {
  id: string;
  type: CellType;
  content: string;
  execution_count?: number;
  execution_state: CellExecutionState;
  outputs: CellOutput[];
}

export interface Notebook {
  id: string;
  title: string;
  cells: Cell[];
  kernel?: {
    id: string;
    name: string;
    status: "idle" | "busy" | "starting" | "dead";
  };
}

export interface KernelInfo {
  id: string;
  name: string;
  status: "idle" | "busy" | "starting" | "dead";
}

export interface JupyterMessage {
  type: string;
  content: any;
  parent_header?: any;
  header?: any;
  metadata?: any;
}

export interface ExecuteRequest {
  code: string;
  cellId: string;
}

export interface ExecuteResponse {
  cellId: string;
  status: "ok" | "error";
  execution_count?: number;
  outputs?: CellOutput[];
  error?: string;
}

export interface NotebookListItem {
  id: string;
  title: string;
  lastModified: string;
  path: string;
}
