import { useState, useEffect, useRef } from "react";
import { Cell, CellExecutionState } from "@/types";
import { Play, Square, Trash2 } from "lucide-react";
import MonacoEditor from "./MonacoEditor";
import { OutputArea } from "./OutputArea";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface HighlightedCodeProps {
  code: string;
  fontSize?: number;
}

// Function to add simple syntax highlighting for Python
const HighlightedCode = ({ code, fontSize = 14 }: HighlightedCodeProps) => {
  // Manual syntax highlighting using styled spans
  const codeLines = code.split('\n');
  const keywords = [
    'import', 'from', 'as', 'def', 'class', 'for', 'while', 'if', 'else', 'elif', 
    'try', 'except', 'finally', 'with', 'return', 'and', 'or', 'not', 'in', 'is', 
    'None', 'True', 'False'
  ];
  
  // Process a line to highlight its parts
  const processLine = (line: string) => {
    // Process each part of the line (comments, strings, keywords)
    const parts: React.ReactNode[] = [];
    let currentIndex = 0;
    let remainingLine = line;
    
    // Check for comments
    const commentMatch = line.match(/(#.*)$/);
    if (commentMatch) {
      const commentStartIndex = line.indexOf(commentMatch[0]);
      if (commentStartIndex > 0) {
        // Process text before comment
        parts.push(processCodePart(line.substring(0, commentStartIndex)));
      }
      // Add the comment with green styling
      parts.push(
        <span key={`comment-${commentStartIndex}`} className="text-green-600 dark:text-green-400">
          {commentMatch[0]}
        </span>
      );
      return parts;
    }
    
    // Check for strings
    const stringMatches = Array.from(line.matchAll(/(['"])(?:(?!\1).|\\.)*?\1/g));
    if (stringMatches.length > 0) {
      let lastIndex = 0;
      stringMatches.forEach((match, matchIndex) => {
        const matchStartIndex = match.index!;
        
        // Add text before the string
        if (matchStartIndex > lastIndex) {
          parts.push(processCodePart(line.substring(lastIndex, matchStartIndex)));
        }
        
        // Add the string with red styling
        parts.push(
          <span key={`string-${matchIndex}`} className="text-red-600 dark:text-red-400">
            {match[0]}
          </span>
        );
        
        lastIndex = matchStartIndex + match[0].length;
      });
      
      // Add any remaining text after the last string
      if (lastIndex < line.length) {
        parts.push(processCodePart(line.substring(lastIndex)));
      }
      
      return parts;
    }
    
    // If no special formatting, process the whole line
    return processCodePart(line);
  };
  
  // Process a code part (non-comment, non-string) to highlight keywords and numbers
  const processCodePart = (text: string): React.ReactNode => {
    // Check for keywords
    for (const keyword of keywords) {
      const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'g');
      const matches = Array.from(text.matchAll(keywordRegex));
      
      if (matches.length > 0) {
        const parts: React.ReactNode[] = [];
        let lastIndex = 0;
        
        matches.forEach((match, matchIndex) => {
          const matchStartIndex = match.index!;
          
          // Add text before the keyword
          if (matchStartIndex > lastIndex) {
            parts.push(text.substring(lastIndex, matchStartIndex));
          }
          
          // Add the keyword with blue styling
          parts.push(
            <span key={`keyword-${matchIndex}`} className="text-blue-600 dark:text-blue-400 font-semibold">
              {match[0]}
            </span>
          );
          
          lastIndex = matchStartIndex + match[0].length;
        });
        
        // Add any remaining text after the last keyword
        if (lastIndex < text.length) {
          parts.push(text.substring(lastIndex));
        }
        
        return <>{parts}</>;
      }
    }
    
    // If no keywords, just return the text
    return text;
  };
  
  return (
    <pre className="font-mono whitespace-pre-wrap mb-4 python-code" style={{ fontSize: `${fontSize}px`, lineHeight: `${fontSize * 1.5}px` }}>
      {codeLines.map((line, lineIndex) => (
        <div key={lineIndex}>{processLine(line)}</div>
      ))}
    </pre>
  );
};

interface CodeCellProps {
  cell: Cell;
  isActive: boolean;
  onClick: () => void;
  onChange: (content: string) => void;
  onExecute: () => void;
  onInterrupt?: () => void;
  onClearOutputs?: () => void;
  onDelete?: () => void;
  isPresentationMode?: boolean;
  presentationSpeed?: number;
  shouldPresent?: boolean; // External trigger to start presentation
  onPresentationComplete?: () => void; // Callback when presentation finishes
  fontSize?: number; // Font size in px
}

export default function CodeCell({
  cell,
  isActive,
  onClick,
  onChange,
  onExecute,
  onInterrupt,
  onClearOutputs,
  onDelete,
  isPresentationMode = false,
  presentationSpeed = 50,
  shouldPresent = false,
  onPresentationComplete,
  fontSize = 14,
}: CodeCellProps) {
  const [editorHeight, setEditorHeight] = useState(40);
  const [displayedCode, setDisplayedCode] = useState("");
  const [isPresenting, setIsPresenting] = useState(false);
  const [hasBeenPresented, setHasBeenPresented] = useState(false);
  const [presentationIndex, setPresentationIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const presentationIntervalRef = useRef<number>();

  useEffect(() => {
    // Calculate height based on actual content lines with minimal padding
    const lineCount = (cell.content.match(/\n/g) || []).length + 1;
    const LINE_HEIGHT = 20; // Match Monaco's line height
    const MIN_PADDING = 8; // Small top/bottom padding
    const newHeight = Math.max(40, (lineCount * LINE_HEIGHT) + MIN_PADDING);
    setEditorHeight(newHeight);
  }, [cell.content]);
  
  // Reset presentation state when presentation mode changes
  useEffect(() => {
    if (!isPresentationMode) {
      setIsPresenting(false);
      setHasBeenPresented(false);
      setPresentationIndex(0);
      setDisplayedCode("");
      if (presentationIntervalRef.current) {
        clearInterval(presentationIntervalRef.current);
        presentationIntervalRef.current = undefined;
      }
    } else {
      // Entering presentation mode: hide code until presented
      setHasBeenPresented(false);
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
          setHasBeenPresented(true); // Mark cell as having been presented
          
          // Auto-execute code when presentation finishes
          setTimeout(() => {
            onExecute();
            // Notify parent that presentation is complete after execution
            if (onPresentationComplete) {
              // Wait a bit for execution to complete before notifying
              setTimeout(() => onPresentationComplete(), 100);
            }
          }, 500); // Small delay before execution
          
          return prevIndex;
        }
        setDisplayedCode(prev => prev + cell.content[prevIndex]);
        return prevIndex + 1;
      });
    }, typingDelay);
  };
  
  // Trigger presentation when shouldPresent becomes true (must be after startPresenting is defined)
  useEffect(() => {
    if (shouldPresent && isPresentationMode) {
      startPresenting();
    } else if (!shouldPresent && isPresenting) {
      // Reset active presentation state when no longer the presenting cell,
      // but keep hasBeenPresented so full code stays visible
      setIsPresenting(false);
      setPresentationIndex(0);
      setDisplayedCode("");
      if (presentationIntervalRef.current) {
        clearInterval(presentationIntervalRef.current);
        presentationIntervalRef.current = undefined;
      }
    }
  }, [shouldPresent, isPresentationMode]);
  
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
        'relative bg-neutral-50 dark:bg-neutral-900 rounded-lg shadow-sm mb-1 transition-all border-2',
        isActive
          ? 'border-blue-500 dark:border-blue-400'
          : 'border-transparent'
      )}
      onClick={onClick}
      data-cell-type="code"
    >
      <div className="relative">
      {/* Top-right toolbar (Delete) */}
      {onDelete && (
        <button
          className="absolute right-2 top-2 z-20 p-1 text-neutral-500 hover:text-red-600"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Delete cell"
          title="Delete cell"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
      {isPresentationMode ? (
        <div className="code-block bg-neutral-50 dark:bg-neutral-800 rounded-md overflow-hidden mb-4 relative group hover:bg-neutral-100 dark:hover:bg-neutral-750 transition-colors flex">
          {/* Left sidebar for In [ ]: and play button */}
          <div className="w-16 flex-shrink-0 relative">
            {/* Present Code button - appears on hover */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                startPresenting();
              }}
              className="absolute left-1 top-2 z-20 w-12 h-6 flex items-center justify-center text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity border border-gray-300 dark:border-gray-600"
            >
              <Play className="h-3 w-3" />
            </button>

            {/* Execution count label - shows [1], [2], etc. or In [ ]: */}
            <div className="absolute left-2 top-2 z-10 text-xs text-neutral-500 dark:text-neutral-400 flex items-center group-hover:opacity-0 transition-opacity">
              <span className="font-semibold">
                {cell.execution_state === "running" ? (
                  "In [*]:"
                ) : cell.execution_count ? (
                  `In [${cell.execution_count}]:`
                ) : (
                  "In [ ]:"
                )}
              </span>
            </div>
          </div>
          
          {/* Content area - pushed to the right */}
          <div className="flex-1 p-6">
            {isPresenting ? (
              <div>
                <HighlightedCode code={displayedCode} fontSize={fontSize} />
              </div>
            ) : hasBeenPresented ? (
              <div>
                <HighlightedCode code={cell.content} fontSize={fontSize} />
              </div>
            ) : (
              <div className="flex justify-center"></div>
            )}
          </div>
        </div>
      ) : (
        <div className="code-block bg-neutral-50 dark:bg-neutral-800 rounded-md overflow-hidden mb-4 relative group hover:bg-neutral-100 dark:hover:bg-neutral-750 transition-colors flex">
          {/* Left sidebar for In [ ]: and play button */}
          <div className="w-16 flex-shrink-0 relative">
            {/* Run button - appears on hover */}
            {isPresentationMode ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  startPresenting();
                }}
                className="absolute left-1/2 -translate-x-1/2 top-2 z-20 w-10 h-6 flex items-center justify-center text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity border border-gray-300 dark:border-gray-600"
              >
                <Play className="h-3 w-3" />
              </button>
            ) : (
              <button
                className={cn(
                  "absolute left-1/2 -translate-x-1/2 top-2 z-20 w-10 h-6 flex items-center justify-center text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-opacity",
                  cell.execution_state === "running" ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  if (cell.execution_state === "running" && onInterrupt) {
                    onInterrupt();
                  } else {
                    onExecute();
                  }
                }}
                aria-label={cell.execution_state === 'running' ? 'Stop execution' : 'Run cell'}
                title={cell.execution_state === 'running' ? 'Stop (Ctrl+C)' : 'Run (Shift+Enter)'}
              >
                {cell.execution_state === "running" ? (
                  <div className="relative">
                    <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                    <Square className="h-2 w-2 fill-current absolute top-0.5 left-0.5" />
                  </div>
                ) : (
                  <Play className="h-3 w-3" />
                )}
              </button>
            )}

            {/* Execution count label - shows [1], [2], etc. or In [ ]: */}
            <div className="absolute left-2 top-2 z-10 text-xs text-neutral-500 dark:text-neutral-400 flex items-center group-hover:opacity-0 transition-opacity">
              <span className="font-semibold">
                {cell.execution_state === "running" ? (
                  "In [*]:"
                ) : cell.execution_count ? (
                  `In [${cell.execution_count}]:`
                ) : (
                  "In [ ]:"
                )}
              </span>
            </div>
          </div>
          
          {/* Monaco editor area - pushed to the right */}
          <div className="flex-1">
            <MonacoEditor
              language="python"
              value={cell.content}
              onChange={onChange}
              height={editorHeight}
              fontSize={fontSize}
            />
          </div>
        </div>
      )}
      
      {cell.outputs.length > 0 && (
        <div className="output-container mt-4 ml-16">
          <div className="flex justify-between items-center border-t border-neutral-200 dark:border-neutral-700 pt-2 pb-2">
            <button 
              className="p-1 text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 flex items-center"
              onClick={(e) => {
                e.stopPropagation();
                // Call the clear outputs function passed from parent
                onClearOutputs?.();
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18"/>
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                <line x1="10" y1="11" x2="10" y2="17"/>
                <line x1="14" y1="11" x2="14" y2="17"/>
              </svg>
            </button>
          </div>
          <div className="output-area overflow-visible pb-6 pt-2 rounded-md">
            <OutputArea outputs={cell.outputs} />
          </div>
        </div>
      )}
    </div>
  );
}
