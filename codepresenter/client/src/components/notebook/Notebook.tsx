import { useState, useEffect, useCallback, useRef } from "react";
import { Notebook as NotebookType, Cell } from "@/types";
import CodeCell from "./CodeCell";
import MarkdownCell from "./MarkdownCell";
import { Navbar } from "@/components/layout/Navbar";
import { Sidebar } from "@/components/layout/Sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useNotebook } from "@/hooks/use-notebook";
import { useJupyter } from "@/hooks/use-jupyter";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { FilesManager } from "@/components/layout/FilesManager";
import { ConnectionStatus } from "@/components/ConnectionStatus";

// Define the default code for new notebooks
const DEFAULT_CODE = ``;
// Define the useLocalStorage hook directly in this file
function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((val: T) => T)) => void] {
  // Get from local storage then parse
  const readValue = (): T => {
    if (typeof window === 'undefined') {
      return initialValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  };

  // State to store our value
  const [storedValue, setStoredValue] = useState<T>(readValue);

  // Return a wrapped version of useState's setter function that persists the new value to localStorage.
  const setValue = (value: T | ((val: T) => T)) => {
    if (typeof window === 'undefined') {
      console.warn(
        `Tried setting localStorage key "${key}" even though environment is not a client`
      );
    }

    try {
      // Allow value to be a function so we have the same API as useState
      const valueToStore =
        value instanceof Function ? value(storedValue) : value;

      // Save state
      setStoredValue(valueToStore);

      // Save to local storage
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (error) {
      console.warn(`Error setting localStorage key "${key}":`, error);
    }
  };

  useEffect(() => {
    // Listen for changes to this localStorage key
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        setStoredValue(JSON.parse(e.newValue));
      }
    };

    // this only works for other documents, not the current one
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [key]);

  return [storedValue, setValue];
}

interface NotebookProps {
  initialNotebook?: NotebookType;
  id?: string;
}

export function Notebook({ initialNotebook, id }: NotebookProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  const [presentationSpeed, setPresentationSpeed] = useState(50); // Default medium speed (1-100 scale)
  const [fontSize, setFontSize] = useLocalStorage<number>('notebook-font-size', 14); // Font size in px
  const [presentingCellId, setPresentingCellId] = useState<string | null>(null); // Track which cell should present
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useLocalStorage('sidebar-collapsed', false);
  const [sidebarWidth, setSidebarWidth] = useState(256); // Add sidebar width state
  const { toast } = useToast();
  const seededRef = useRef(false); // Track if we've already seeded the notebook with a default cell
  const { connectToKernel, isConnected, restartKernel, interruptKernel } = useJupyter();
  // Keep a live reference of notebook for polling in async flows (init later to avoid TDZ)
  const notebookRef = useRef<NotebookType | null>(null);
  
  // Debug the incoming notebook data
  console.log('initialNotebook in Notebook component:', initialNotebook);
  
  // Check if initialNotebook is valid or if it's an array (metadata list instead of a notebook)
  let safeInitialNotebook;
  if (initialNotebook) {
    if (!Array.isArray(initialNotebook) && 
        typeof initialNotebook === 'object' && 
        'cells' in initialNotebook) {
      // Valid notebook with cells
      safeInitialNotebook = initialNotebook;
    } else {
      console.warn('Invalid initialNotebook format:', initialNotebook);
      safeInitialNotebook = undefined;
    }
  } else {
    safeInitialNotebook = undefined;
  }
  
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
    clearCellOutputs,
    resetCellExecutionState,
    resetNotebookExecutionState,
    undo,
    isLoading,
  } = useNotebook(id, safeInitialNotebook);

  // Update the live ref once notebook is available
  useEffect(() => {
    notebookRef.current = notebook;
  }, [notebook]);

  // 1) Create the first cell if notebook is empty
  // Use refs for functions to avoid dependency changes triggering re-runs
  const addCellRef = useRef(addCell);
  const updateCellContentRef = useRef(updateCellContent);
  const setActiveCellRef = useRef(setActiveCell);
  const saveNotebookRef = useRef(saveNotebook);
  
  // Keep refs updated
  useEffect(() => {
    addCellRef.current = addCell;
    updateCellContentRef.current = updateCellContent;
    setActiveCellRef.current = setActiveCell;
    saveNotebookRef.current = saveNotebook;
  });
  
  useEffect(() => {
    if (isLoading) return;
    if (!notebook || !Array.isArray(notebook.cells)) return;
    if (notebook.cells.length > 0) return;
    if (seededRef.current) return;

    seededRef.current = true;

    // Try to create a new code cell at the top (index 0)
    const maybeId = addCellRef.current("code", null, 0);

    if (typeof maybeId === "string") {
      updateCellContentRef.current(maybeId, DEFAULT_CODE);
      setActiveCellRef.current(maybeId);
      // Don't auto-save on creation - let user explicitly save
      // This prevents creating hundreds of empty notebooks
      // saveNotebookRef.current();
    }
  }, [isLoading, notebook?.cells?.length]); // Only depend on loading state and cells length

  // 2) If addCell didn't return an id, populate the newly created first cell
  const populatedRef = useRef(false);
  useEffect(() => {
    if (!seededRef.current) return;
    if (populatedRef.current) return; // Only run once
    if (!notebook || !Array.isArray(notebook.cells)) return;
    if (notebook.cells.length !== 1) return;

    const first = notebook.cells[0];
    if (!first?.content || first.content.trim() === "") {
      populatedRef.current = true;
      updateCellContentRef.current(first.id, DEFAULT_CODE);
      setActiveCellRef.current(first.id);
      // Don't auto-save - let user explicitly save
      // saveNotebookRef.current();
    }
  }, [notebook?.cells?.length]); // Minimal dependencies

  // Note: Kernel connection is now lazy (triggered by executeCode or explicit actions),
  // so we no longer auto-connect on mount here.

  // Scroll notebook to top after initial load so cell 1 is always visible
  const scrolledToTopRef = useRef(false);
  useEffect(() => {
    if (isLoading || scrolledToTopRef.current) return;
    if (!notebook || !Array.isArray(notebook.cells) || notebook.cells.length === 0) return;
    scrolledToTopRef.current = true;
    // Delay slightly to let Monaco editors finish mounting
    requestAnimationFrame(() => {
      const container = document.getElementById('notebook-content');
      if (container) container.scrollTop = 0;
    });
  }, [isLoading, notebook?.cells?.length]);

  // Add keyboard event handlers for undo functionality
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Ctrl+Z (Windows/Linux) or Cmd+Z (Mac)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        // Prevent default browser behavior
        e.preventDefault();
        // Call the undo function
        undo();
      }
    };

    // Add event listener to window
    window.addEventListener('keydown', handleKeyDown);

    // Cleanup on unmount
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [undo]);

  const handleInsertFileToNotebook = useCallback((filePath: string, fileType: string) => {
    // Create appropriate import code based on file type
    let codeToInsert = '';
    
    if (fileType === 'csv') {
      codeToInsert = `import pandas as pd\n\n# Load data from CSV file\ndf = pd.read_csv("${filePath}")\n\n# Display the first few rows\ndf.head()`;
    } else if (fileType === 'xlsx' || fileType === 'xls') {
      codeToInsert = `import pandas as pd\n\n# Load data from Excel file\ndf = pd.read_excel("${filePath}")\n\n# Display the first few rows\ndf.head()`;
    } else {
      codeToInsert = `# File available at: ${filePath}\n# Use appropriate library to load this file type`;
    }
    
    // Add a new code cell with the import code
    addCell('code', codeToInsert);
    
    // Close the sidebar on mobile
    setMobileSidebarOpen(false);
  }, [addCell]);

  // Check for pending file imports from localStorage
  useEffect(() => {
    const pendingImport = localStorage.getItem('pendingFileImport');
    if (pendingImport) {
      try {
        const fileInfo = JSON.parse(pendingImport);
        handleInsertFileToNotebook(fileInfo.path, fileInfo.type);
        // Clear the pending import
        localStorage.removeItem('pendingFileImport');
      } catch (error) {
        console.error('Error processing pending file import:', error);
      }
    }
  }, [handleInsertFileToNotebook]);

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

  // Add auto-connect functionality if not connected
  const handleExecuteCell = async (cellId?: string) => {
    if (!cellId) return;
    
    if (!isConnected) {
      try {
        await connectToKernel();
      } catch (error) {
        toast({
          title: "Connection Failed",
          description: "Could not connect to kernel. Execution aborted.",
          variant: "destructive",
        });
        return;
      }
    }
    executeCell(cellId);
  };

  // Run all code cells sequentially (with presentation animation if in presentation mode)
  // skipPresentation: when true, always use normal execution (used by VideoRecorder)
  const handleRunAll = useCallback(async (options?: { skipPresentation?: boolean }): Promise<Cell[]> => {
    if (!isConnected) {
      try {
        await connectToKernel();
      } catch (error) {
        toast({
          title: "Connection Failed",
          description: "Could not connect to kernel. Execution aborted.",
          variant: "destructive",
        });
        return notebookRef.current?.cells || [];
      }
    }
    
    const codeCells = (notebook?.cells || []).filter(c => c.type === "code");
    
    // In presentation mode (unless skipPresentation), trigger presentation animation for each cell
    if (isPresentationMode && !options?.skipPresentation) {
      for (const cell of codeCells) {
        // Reset execution state so the poll doesn't find stale "complete" from a previous run
        resetCellExecutionState(cell.id);
        
        // Small yield to let React process the state reset before setting presentingCellId
        await new Promise(r => setTimeout(r, 50));
        
        // Trigger presentation for this cell
        setPresentingCellId(cell.id);
        
        // Wait for presentation and execution to complete
        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            const currentCell = notebookRef.current?.cells?.find(c => c.id === cell.id);
            if (currentCell?.execution_state === "complete" || currentCell?.execution_state === "error") {
              clearInterval(checkInterval);
              // Clear the presenting cell after a short delay
              setTimeout(() => {
                setPresentingCellId(null);
                resolve();
              }, 500);
            }
          }, 100);
          // Timeout after 120 seconds (presentation + execution)
          setTimeout(() => {
            clearInterval(checkInterval);
            setPresentingCellId(null);
            resolve();
          }, 120000);
        });
      }
    } else {
      // Normal mode - just execute cells
      for (const cell of codeCells) {
        await new Promise<void>((resolve) => {
          executeCell(cell.id);
          const prevOutputs = (notebookRef.current?.cells?.find(c => c.id === cell.id)?.outputs?.length) || 0;
          const checkInterval = setInterval(() => {
            const currentCell = notebookRef.current?.cells?.find(c => c.id === cell.id);
            if (currentCell?.execution_state === "complete" || currentCell?.execution_state === "error") {
              // Ensure outputs have updated (if applicable)
              const newLen = currentCell?.outputs?.length || 0;
              if (newLen >= prevOutputs) {
                clearInterval(checkInterval);
                resolve();
              }
            }
          }, 100);
          setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
          }, 60000);
        });
      }
    }
    return notebookRef.current?.cells || [];
  }, [notebook.cells, isConnected, connectToKernel, executeCell, toast, isPresentationMode, resetCellExecutionState]);

  // Handler for notebook title changes with auto-save functionality
  const handleTitleChange = useCallback((title: string) => {
    // Update the title in state
    updateNotebookTitle(title);
    
    // Debounce save operation to avoid excessive API calls
    const timeoutId = setTimeout(() => {
      saveNotebook();
    }, 1000); // Save after 1 second of inactivity
    
    // Clean up the timeout if the component is unmounted or title changes again
    return () => clearTimeout(timeoutId);
  }, [updateNotebookTitle, saveNotebook]);

  // Restart kernel and reset UI state
  const handleRestartKernel = useCallback(async () => {
    try {
      await restartKernel();
      // Clear outputs and reset execution counters/states
      resetNotebookExecutionState();
      toast({
        title: "Session Restarted",
        description: "Kernel restarted and outputs cleared.",
      });
    } catch (e) {
      // useJupyter already toasts errors
    }
  }, [restartKernel, resetNotebookExecutionState, toast]);

  // Listen for Google Drive connection event and trigger immediate save
  useEffect(() => {
    const onDriveConnected = () => {
      toast({ 
        title: "Google Drive connected", 
        description: "Saving notebook to Drive…" 
      });
      // This calls the existing mutation, which will POST to /api/google-drive/save-notebook
      // and, on success, open driveResult.webViewLink in a new tab
      saveNotebook();
    };
    
    window.addEventListener('drive:connected', onDriveConnected);
    return () => window.removeEventListener('drive:connected', onDriveConnected);
  }, [saveNotebook, toast]);

  // Check if notebook is valid before rendering
  if (!notebook || !notebook.cells || !Array.isArray(notebook.cells)) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="spinner inline-block mb-2 text-primary">
            <svg className="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <p className="text-lg font-medium">Notebook data is loading or invalid...</p>
          <p className="text-sm text-gray-500 mt-2">You may need to refresh or go back to the home page</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden relative">
      {/* Mobile sidebar */}
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="p-0 w-4/5">
          <div className="h-full overflow-auto">
            <Sidebar isCollapsed={false} onToggleCollapse={() => {}} sidebarWidth={sidebarWidth} onSidebarWidthChange={setSidebarWidth} />
            <div className="mt-4 px-3 pb-8">
              <h3 className="text-sm font-medium mb-2">Files</h3>
              <FilesManager onInsertFileToNotebook={handleInsertFileToNotebook} compact={true} />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar */}
      <div className="hidden md:block h-full fixed left-0 top-0 z-30">
        <Sidebar 
          isCollapsed={isSidebarCollapsed} 
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          sidebarWidth={sidebarWidth}
          onSidebarWidthChange={setSidebarWidth}
        />
        {!isSidebarCollapsed && (
          <div className="mt-4 px-3 absolute top-[calc(100vh-350px)] w-64 max-h-[300px] overflow-y-auto">
            <h3 className="text-sm font-medium mb-2">Files</h3>
            <FilesManager onInsertFileToNotebook={handleInsertFileToNotebook} compact={true} />
          </div>
        )}
      </div>

      <div 
        className="flex flex-col flex-1 overflow-hidden transition-all duration-300"
        style={{ marginLeft: isSidebarCollapsed ? '64px' : `${sidebarWidth}px` }}
      >
        {/* Top navigation */}
        <Navbar
          className="shrink-0"
          notebook={notebook}
          activeCell={activeCell}
          onTitleChange={handleTitleChange}
          onAddCell={addCell}
          onRunCell={handleExecuteCell}
          onRunAll={handleRunAll}
          onSaveNotebook={saveNotebook}
          onMoveCellUp={(id) => moveCell(id, "up")}
          onMoveCellDown={(id) => moveCell(id, "down")}
          onDeleteCell={deleteCell}
          onCopyCellContent={copyCellContent}
          onCutCellContent={cutCellContent}
          onUndo={undo}
          onRestartKernel={handleRestartKernel}
          mobileSidebarOpen={mobileSidebarOpen}
          setMobileSidebarOpen={setMobileSidebarOpen}
          isPresentationMode={isPresentationMode}
          togglePresentationMode={() => setIsPresentationMode(!isPresentationMode)}
          presentationSpeed={presentationSpeed}
          setPresentationSpeed={setPresentationSpeed}
          fontSize={fontSize}
          setFontSize={setFontSize}
        />

        {/* Notebook content with Colab-style single scrollbar */}
        <div 
          className="flex-1 min-h-0 overflow-y-auto bg-white dark:bg-neutral-900" 
          id="notebook-content" 
          style={{
            paddingTop: isPresentationMode ? '44px' : 0,
            paddingLeft: '1rem',
            paddingRight: '1rem',
            paddingBottom: '1rem',
            transition: 'padding-top 0.3s ease-in-out',
            // Colab-style scrollbar
            scrollbarWidth: 'thin',
            scrollbarColor: '#c1c1c1 #f1f3f4'
          }}
        >
          {/* Custom scrollbar styles */}
          <style>{`
            #notebook-content::-webkit-scrollbar {
              width: 12px;
            }
            #notebook-content::-webkit-scrollbar-track {
              background: #f1f3f4;
            }
            #notebook-content::-webkit-scrollbar-thumb {
              background-color: #c1c1c1;
              border-radius: 6px;
              border: 2px solid #f1f3f4;
            }
            #notebook-content::-webkit-scrollbar-thumb:hover {
              background-color: #8f8f8f;
            }
          `}</style>

          <div className={`transition-all duration-300 w-full px-4 pb-20 overflow-visible`}>
            <div className="relative">
              {/* Overlay: NOT part of layout, so no extra gap */}
              {!isPresentationMode && (
                <div className="pointer-events-none group">
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10">
                    <div className="pointer-events-auto bg-white dark:bg-neutral-800 shadow-sm flex items-center rounded-md border border-neutral-200 dark:border-neutral-700 overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity">
                      {/* Code button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          addCell("code", null, 0);
                        }}
                        className="h-7 px-2 rounded-none hover:bg-neutral-100 dark:hover:bg-neutral-700"
                      >
                        <PlusCircle className="h-4 w-4 mr-1" />
                        <span className="text-xs">Code</span>
                      </Button>
                      <div className="h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
                      {/* Text button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          addCell("markdown", null, 0);
                        }}
                        className="h-7 px-2 rounded-none hover:bg-neutral-100 dark:hover:bg-neutral-700"
                      >
                        <span className="text-xs">Text</span>
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Only the cells get spaced vertically */}
              <div className="space-y-2">

                {notebook.cells.map((cell: Cell, index: number) => (
                  <div className="relative group" key={cell.id}>
                    {cell.type === "code" ? (
                      <CodeCell
                        cell={cell}
                        isActive={cell.id === activeCell}
                        onClick={() => setActiveCell(cell.id)}
                        onChange={(newContent) => updateCellContent(cell.id, newContent)}
                        onExecute={() => handleExecuteCell(cell.id)}
                        onInterrupt={() => interruptKernel()}
                        onClearOutputs={() => clearCellOutputs(cell.id)}
                        isPresentationMode={isPresentationMode}
                        presentationSpeed={presentationSpeed}
                        shouldPresent={presentingCellId === cell.id}
                        fontSize={fontSize}
                      />
                    ) : (
                      <MarkdownCell
                        cell={cell}
                        isActive={cell.id === activeCell}
                        onClick={() => setActiveCell(cell.id)}
                        onChange={(newContent) => updateCellContent(cell.id, newContent)}
                        onDelete={() => deleteCell(cell.id)}
                      />
                    )}
                    
                    {/* Google Colab style add cell buttons (only shown on hover and when not in presentation mode) */}
                    {!isPresentationMode && (
                      <div className="absolute -bottom-6 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-10 flex">
                        <div className="bg-white dark:bg-neutral-800 shadow-sm flex items-center rounded-md border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                          {/* Code cell button */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              addCell("code", cell.id);
                            }}
                            className="h-7 px-2 rounded-none hover:bg-neutral-100 dark:hover:bg-neutral-700"
                          >
                            <PlusCircle className="h-4 w-4 mr-1" />
                            <span className="text-xs">Code</span>
                          </Button>
                          
                          {/* Divider */}
                          <div className="h-5 w-px bg-neutral-200 dark:bg-neutral-700"></div>
                          
                          {/* Text cell button */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              addCell("markdown", cell.id);
                            }}
                            className="h-7 px-2 rounded-none hover:bg-neutral-100 dark:hover:bg-neutral-700"
                          >
                            <span className="text-xs">Text</span>
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

              </div>

              {/* Add hover button at the bottom of the notebook */}
              {!isPresentationMode && (
                <div className="relative h-20 group mt-8">
                  <div className="absolute top-4 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-10 flex">
                    <div className="bg-white dark:bg-neutral-800 shadow-sm flex items-center rounded-md border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                      {/* Code cell button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          addCell("code");
                        }}
                        className="h-7 px-2 rounded-none hover:bg-neutral-100 dark:hover:bg-neutral-700"
                      >
                        <PlusCircle className="h-4 w-4 mr-1" />
                        <span className="text-xs">Code</span>
                      </Button>
                      
                      {/* Divider */}
                      <div className="h-5 w-px bg-neutral-200 dark:bg-neutral-700"></div>
                      
                      {/* Text cell button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          addCell("markdown");
                        }}
                        className="h-7 px-2 rounded-none hover:bg-neutral-100 dark:hover:bg-neutral-700"
                      >
                        <span className="text-xs">Text</span>
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status bar */}
        <div className="shrink-0 bg-neutral-100 dark:bg-neutral-800 border-t border-neutral-200 dark:border-neutral-700 py-2 px-4 text-xs text-neutral-600 dark:text-neutral-400 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <ConnectionStatus />
            <div className="flex items-center">
              <div className={`h-2 w-2 rounded-full mr-2 ${
                isConnected ? 
                  notebook.kernel?.status === "busy" 
                    ? "bg-yellow-500" 
                    : notebook.kernel?.status === "dead" 
                      ? "bg-red-500" 
                      : "bg-green-500"
                  : "bg-red-500"
              }`}></div>
              <span>
                {isConnected ? 
                  `${notebook.kernel?.name || "Python"} | ${notebook.kernel?.status || "idle"}` :
                  "Not connected to kernel"}
              </span>
            </div>
          </div>
          <div>
            <span>Last saved: {new Date().toLocaleTimeString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
