import { useState, useEffect, useRef } from "react";
import { Cell, CellExecutionState } from "@/types";
import { Play, Pause } from "lucide-react";
import MonacoEditor from "./MonacoEditor";
import { OutputArea } from "./OutputArea";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface CodeCellProps {
  cell: Cell;
  isActive: boolean;
  onClick: () => void;
  onChange: (content: string) => void;
  onExecute: () => void;
  isPresentationMode?: boolean;
  presentationSpeed?: number;
}

export default function CodeCell({
  cell,
  isActive,
  onClick,
  onChange,
  onExecute,
  isPresentationMode = false,
  presentationSpeed = 50,
}: CodeCellProps) {
  const [editorHeight, setEditorHeight] = useState(150);
  const [displayedCode, setDisplayedCode] = useState("");
  const [isPresenting, setIsPresenting] = useState(false);
  const [presentationIndex, setPresentationIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const presentationIntervalRef = useRef<number>();

  useEffect(() => {
    // Adjust height based on content but with min/max constraints
    const lineCount = (cell.content.match(/\n/g) || []).length + 1;
    const newHeight = Math.max(100, Math.min(500, lineCount * 20));
    setEditorHeight(newHeight);
  }, [cell.content]);
  
  // Reset presentation state when presentation mode changes
  useEffect(() => {
    if (!isPresentationMode) {
      setIsPresenting(false);
      setPresentationIndex(0);
      setDisplayedCode("");
      if (presentationIntervalRef.current) {
        clearInterval(presentationIntervalRef.current);
        presentationIntervalRef.current = undefined;
      }
    }
  }, [isPresentationMode]);
  
  // Function to start presenting code character by character
  const startPresenting = () => {
    // If it's already presenting, we're restarting the presentation
    if (isPresenting && presentationIntervalRef.current) {
      // Stop the current presentation
      clearInterval(presentationIntervalRef.current);
      presentationIntervalRef.current = undefined;
    }
    
    // Start the presentation
    setIsPresenting(true);
    setPresentationIndex(0);
    setDisplayedCode("");
    
    // Calculate typing speed based on presentationSpeed (1-100)
    // Lower presentationSpeed = slower typing (more milliseconds between characters)
    // Higher presentationSpeed = faster typing
    const typingDelay = Math.max(10, Math.min(200, 210 - presentationSpeed * 2));
    
    presentationIntervalRef.current = window.setInterval(() => {
      setPresentationIndex(prevIndex => {
        if (prevIndex >= cell.content.length) {
          clearInterval(presentationIntervalRef.current);
          presentationIntervalRef.current = undefined;
          setIsPresenting(true); // Keep isPresenting true to maintain the display
          
          // Auto-execute code when presentation finishes
          setTimeout(() => {
            onExecute();
          }, 500); // Small delay before execution
          
          return prevIndex;
        }
        setDisplayedCode(prev => prev + cell.content[prevIndex]);
        return prevIndex + 1;
      });
    }, typingDelay);
  };
  
  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (presentationIntervalRef.current) {
        clearInterval(presentationIntervalRef.current);
      }
    };
  }, []);

  const getExecutionCountDisplay = () => {
    switch (cell.execution_state) {
      case "running":
        return "*";
      case "complete":
        return cell.execution_count || "";
      default:
        return "";
    }
  };

  const getExecutionIcon = () => {
    switch (cell.execution_state) {
      case "running":
        return <Spinner size="sm" />;
      default:
        return null;
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "cell mb-5 pl-3 pr-2 py-2 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 rounded-md",
        isActive && "border-l-2 border-l-primary"
      )}
      onClick={onClick}
      data-cell-type="code"
    >
      <div className="flex justify-between mb-2">
        <div className="text-xs text-neutral-500 dark:text-neutral-400 flex items-center">
          {getExecutionIcon()}
          <span className="font-semibold ml-1">
            {getExecutionCountDisplay() ? `In [${getExecutionCountDisplay()}]:` : "In [ ]:"}
          </span>
        </div>
        <div className="flex items-center">
          <button
            className="p-1 text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            onClick={(e) => {
              e.stopPropagation();
              onExecute();
            }}
          >
            {cell.execution_state === "running" ? (
              <Pause className="h-3 w-3" />
            ) : (
              <Play className="h-3 w-3" />
            )}
          </button>
        </div>
      </div>
      {isPresentationMode ? (
        <div className="code-block bg-neutral-50 dark:bg-neutral-800 rounded-md overflow-hidden p-4">
          {isPresenting ? (
            <div>
              <pre className="font-mono text-sm whitespace-pre-wrap mb-4">{displayedCode}</pre>
              {presentationIndex >= cell.content.length && (
                <div className="flex justify-center">
                  <Button 
                    onClick={startPresenting}
                    variant="outline"
                    size="sm"
                    className="mt-2"
                  >
                    <Play className="mr-2 h-4 w-4" />
                    Restart Presentation
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10">
              <p className="text-neutral-500 dark:text-neutral-400 mb-4">
                Click the button below to start the code presentation
              </p>
              <Button 
                onClick={startPresenting}
                className="bg-primary text-white"
              >
                <Play className="mr-2 h-4 w-4" />
                Present Code
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="code-block bg-neutral-50 dark:bg-neutral-800 rounded-md overflow-hidden">
          <MonacoEditor
            language="python"
            value={cell.content}
            onChange={onChange}
            height={editorHeight}
          />
        </div>
      )}
      
      {cell.outputs.length > 0 && (
        <div className="output-area mt-2 border-t border-neutral-200 dark:border-neutral-700 pt-2">
          <OutputArea outputs={cell.outputs} />
        </div>
      )}
    </div>
  );
}
