import { useState, useEffect, useCallback } from "react";
import { Notebook, Cell, CellType } from "@/types";
import { useJupyter } from "@/hooks/use-jupyter";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { v4 as uuidv4 } from "uuid";

const createEmptyNotebook = (): Notebook => ({
  id: uuidv4(),
  title: "Untitled.ipynb",
  cells: [
    {
      id: uuidv4(),
      type: "markdown",
      content: "# Welcome to Jupyter Notebook\n\nStart by writing markdown or code below.",
      execution_state: "idle",
      outputs: [],
    },
    {
      id: uuidv4(),
      type: "code",
      content: "# Enter your code here\nprint('Hello, world!')",
      execution_state: "idle",
      outputs: [],
    },
  ],
});

export function useNotebook(notebookId?: string, initialNotebook?: Notebook) {
  const [notebook, setNotebook] = useState<Notebook>(
    initialNotebook || createEmptyNotebook()
  );
  const [activeCell, setActiveCell] = useState<string | null>(null);
  const { toast } = useToast();
  const {
    connectToKernel,
    executeCode,
    interruptKernel,
    isConnected
  } = useJupyter();
  const queryClient = useQueryClient();

  // Fetch notebook if ID is provided
  const { data: fetchedNotebook, isLoading } = useQuery({
    queryKey: ['/api/notebooks', notebookId],
    enabled: !!notebookId && !initialNotebook,
    staleTime: Infinity,
  });

  // Save notebook mutation
  const saveNotebookMutation = useMutation({
    mutationFn: async (notebookData: Notebook) => {
      const endpoint = notebookId 
        ? `/api/notebooks/${notebookId}` 
        : "/api/notebooks";
      
      const response = await apiRequest(
        notebookId ? "PUT" : "POST",
        endpoint,
        notebookData
      );
      
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Notebook saved",
        description: "Your notebook has been saved successfully.",
      });
      
      queryClient.invalidateQueries({ queryKey: ['/api/notebooks/recent'] });
      
      if (!notebookId && data.id) {
        // If this was a new notebook, update the URL
        window.history.replaceState(
          {},
          document.title,
          `/notebook/${data.id}`
        );
      }
    },
    onError: (error) => {
      toast({
        title: "Failed to save notebook",
        description: error.toString(),
        variant: "destructive",
      });
    },
  });

  // Initialize notebook from fetched data
  useEffect(() => {
    if (fetchedNotebook) {
      setNotebook(fetchedNotebook);
      
      // Set the first cell as active if there are cells
      if (fetchedNotebook.cells.length > 0) {
        setActiveCell(fetchedNotebook.cells[0].id);
      }
    }
  }, [fetchedNotebook]);

  // Connect to kernel when notebook is loaded
  useEffect(() => {
    if ((fetchedNotebook || initialNotebook) && !isConnected) {
      connectToKernel();
    }
  }, [fetchedNotebook, initialNotebook, connectToKernel, isConnected]);

  const updateCellContent = useCallback((id: string, content: string) => {
    setNotebook((prev) => ({
      ...prev,
      cells: prev.cells.map((cell) =>
        cell.id === id ? { ...cell, content } : cell
      ),
    }));
  }, []);

  const updateNotebookTitle = useCallback((title: string) => {
    setNotebook((prev) => ({
      ...prev,
      title,
    }));
  }, []);

  const addCell = useCallback((type: CellType = "code", afterId?: string) => {
    const newCell: Cell = {
      id: uuidv4(),
      type,
      content: type === "code" ? "# Your code here" : "## New markdown cell",
      execution_state: "idle",
      outputs: [],
    };

    setNotebook((prev) => {
      let newCells;
      
      if (afterId) {
        const index = prev.cells.findIndex((cell) => cell.id === afterId);
        if (index >= 0) {
          newCells = [
            ...prev.cells.slice(0, index + 1),
            newCell,
            ...prev.cells.slice(index + 1),
          ];
        } else {
          newCells = [...prev.cells, newCell];
        }
      } else if (activeCell) {
        const index = prev.cells.findIndex((cell) => cell.id === activeCell);
        if (index >= 0) {
          newCells = [
            ...prev.cells.slice(0, index + 1),
            newCell,
            ...prev.cells.slice(index + 1),
          ];
        } else {
          newCells = [...prev.cells, newCell];
        }
      } else {
        newCells = [...prev.cells, newCell];
      }
      
      return {
        ...prev,
        cells: newCells,
      };
    });

    setActiveCell(newCell.id);
  }, [activeCell]);

  const executeCell = useCallback(
    async (id?: string) => {
      // If no ID is provided, execute the active cell
      const cellId = id || activeCell;
      
      if (!cellId) {
        toast({
          title: "No cell selected",
          description: "Please select a cell to execute.",
          variant: "destructive",
        });
        return;
      }
      
      const cell = notebook.cells.find((c) => c.id === cellId);
      
      if (!cell) {
        toast({
          title: "Cell not found",
          description: "The selected cell was not found.",
          variant: "destructive",
        });
        return;
      }
      
      if (cell.type !== "code") {
        toast({
          description: "Only code cells can be executed.",
        });
        return;
      }
      
      // Update cell state to running
      setNotebook((prev) => ({
        ...prev,
        cells: prev.cells.map((c) =>
          c.id === cellId ? { ...c, execution_state: "running" } : c
        ),
      }));
      
      try {
        const result = await executeCode(cell.content, cellId);
        
        // Update cell with execution results
        setNotebook((prev) => ({
          ...prev,
          cells: prev.cells.map((c) =>
            c.id === cellId
              ? {
                  ...c,
                  execution_state: result.status === "ok" ? "complete" : "error",
                  execution_count: result.execution_count,
                  outputs: result.outputs || [],
                }
              : c
          ),
        }));
      } catch (error) {
        console.error("Execution error:", error);
        
        // Update cell state to error
        setNotebook((prev) => ({
          ...prev,
          cells: prev.cells.map((c) =>
            c.id === cellId
              ? {
                  ...c,
                  execution_state: "error",
                  outputs: [
                    {
                      id: uuidv4(),
                      output_type: "error",
                      traceback: [error.toString()],
                    },
                  ],
                }
              : c
          ),
        }));
        
        toast({
          title: "Execution failed",
          description: error.toString(),
          variant: "destructive",
        });
      }
    },
    [activeCell, executeCode, notebook.cells, toast]
  );

  const saveNotebook = useCallback(() => {
    saveNotebookMutation.mutate(notebook);
  }, [notebook, saveNotebookMutation]);

  const moveCell = useCallback(
    (id: string, direction: "up" | "down") => {
      const index = notebook.cells.findIndex((cell) => cell.id === id);
      
      if (
        (direction === "up" && index === 0) ||
        (direction === "down" && index === notebook.cells.length - 1) ||
        index === -1
      ) {
        return;
      }
      
      const newIndex = direction === "up" ? index - 1 : index + 1;
      const newCells = [...notebook.cells];
      
      // Swap cells
      [newCells[index], newCells[newIndex]] = [
        newCells[newIndex],
        newCells[index],
      ];
      
      setNotebook((prev) => ({
        ...prev,
        cells: newCells,
      }));
    },
    [notebook]
  );

  const deleteCell = useCallback(
    (id: string) => {
      if (notebook.cells.length <= 1) {
        toast({
          description: "Cannot delete the last cell.",
        });
        return;
      }
      
      setNotebook((prev) => {
        const newCells = prev.cells.filter((cell) => cell.id !== id);
        
        // If active cell is being deleted, select another cell
        if (activeCell === id) {
          const index = prev.cells.findIndex((cell) => cell.id === id);
          const newActiveIndex = Math.min(index, newCells.length - 1);
          
          if (newActiveIndex >= 0) {
            setActiveCell(newCells[newActiveIndex].id);
          } else {
            setActiveCell(null);
          }
        }
        
        return {
          ...prev,
          cells: newCells,
        };
      });
    },
    [activeCell, notebook.cells.length, toast]
  );

  const copyCellContent = useCallback(
    (id: string) => {
      const cell = notebook.cells.find((c) => c.id === id);
      
      if (cell) {
        navigator.clipboard.writeText(cell.content).then(
          () => {
            toast({
              description: "Cell content copied to clipboard.",
            });
          },
          (err) => {
            console.error("Failed to copy:", err);
            toast({
              title: "Failed to copy",
              description: "Could not copy content to clipboard.",
              variant: "destructive",
            });
          }
        );
      }
    },
    [notebook.cells, toast]
  );

  const cutCellContent = useCallback(
    (id: string) => {
      const cell = notebook.cells.find((c) => c.id === id);
      
      if (cell) {
        navigator.clipboard.writeText(cell.content).then(
          () => {
            updateCellContent(id, "");
            toast({
              description: "Cell content cut to clipboard.",
            });
          },
          (err) => {
            console.error("Failed to cut:", err);
            toast({
              title: "Failed to cut",
              description: "Could not cut content to clipboard.",
              variant: "destructive",
            });
          }
        );
      }
    },
    [notebook.cells, toast, updateCellContent]
  );

  return {
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
  };
}
