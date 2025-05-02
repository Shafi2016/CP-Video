import { useState, useEffect } from "react";
import { Notebook as NotebookType, Cell } from "@/types";
import CodeCell from "./CodeCell";
import MarkdownCell from "./MarkdownCell";
import { Navbar } from "@/components/layout/Navbar";
import { Sidebar } from "@/components/layout/Sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useNotebook } from "@/hooks/use-notebook";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";

interface NotebookProps {
  initialNotebook?: NotebookType;
  id?: string;
}

export function Notebook({ initialNotebook, id }: NotebookProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  
  const {
    notebook,
    activeCell,
    setActiveCell,
    updateCellContent,
    addCell,
    executeCell,
    saveNotebook,
    updateNotebookTitle,
    moveCell,
    deleteCell,
    copyCellContent,
    cutCellContent,
    isLoading,
  } = useNotebook(id, initialNotebook);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="spinner inline-block mb-2 text-primary">
            <svg className="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <p className="text-lg font-medium">Loading notebook...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile sidebar */}
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="p-0 w-4/5">
          <Sidebar />
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar */}
      <Sidebar />

      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Top navigation */}
        <Navbar
          notebook={notebook}
          activeCell={activeCell}
          onTitleChange={updateNotebookTitle}
          onAddCell={addCell}
          onRunCell={executeCell}
          onSaveNotebook={saveNotebook}
          onMoveCellUp={(id) => moveCell(id, "up")}
          onMoveCellDown={(id) => moveCell(id, "down")}
          onDeleteCell={deleteCell}
          onCopyCellContent={copyCellContent}
          onCutCellContent={cutCellContent}
          mobileSidebarOpen={mobileSidebarOpen}
          setMobileSidebarOpen={setMobileSidebarOpen}
        />

        {/* Notebook content */}
        <ScrollArea className="flex-1 p-4 bg-white dark:bg-neutral-900" id="notebook-content">
          {notebook.cells.map((cell: Cell) => (
            <div className="relative group" key={cell.id}>
              {cell.type === "code" ? (
                <CodeCell
                  cell={cell}
                  isActive={cell.id === activeCell}
                  onClick={() => setActiveCell(cell.id)}
                  onChange={(newContent) => updateCellContent(cell.id, newContent)}
                  onExecute={() => executeCell(cell.id)}
                />
              ) : (
                <MarkdownCell
                  cell={cell}
                  isActive={cell.id === activeCell}
                  onClick={() => setActiveCell(cell.id)}
                  onChange={(newContent) => updateCellContent(cell.id, newContent)}
                />
              )}
            </div>
          ))}

          {/* Add cell button at the end */}
          <div className="flex justify-center mb-10">
            <Button
              variant="outline"
              onClick={addCell}
              className="border-dashed"
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Cell
            </Button>
          </div>
        </ScrollArea>

        {/* Status bar */}
        <div className="bg-neutral-100 dark:bg-neutral-800 border-t border-neutral-200 dark:border-neutral-700 py-1 px-4 text-xs text-neutral-600 dark:text-neutral-400 flex items-center justify-between">
          <div className="flex items-center">
            <div className={`h-2 w-2 rounded-full mr-2 ${
              notebook.kernel?.status === "busy" 
                ? "bg-yellow-500" 
                : notebook.kernel?.status === "dead" 
                  ? "bg-red-500" 
                  : "bg-green-500"
            }`}></div>
            <span>
              {notebook.kernel?.name || "No Kernel"} | {notebook.kernel?.status || "Not connected"}
            </span>
          </div>
          <div>
            <span>Last saved: {new Date().toLocaleTimeString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
