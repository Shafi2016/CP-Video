import { useState, useEffect, useRef } from "react";
import { Cell, CellExecutionState } from "@/types";
import { Play, Pause } from "lucide-react";
import MonacoEditor from "./MonacoEditor";
import { OutputArea } from "./OutputArea";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface HighlightedCodeProps {
  code: string;
}

// Function to add simple syntax highlighting for Python
const HighlightedCode = ({ code }: HighlightedCodeProps) => {
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
    <pre className="font-mono text-sm whitespace-pre-wrap mb-4 python-code">
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
  onClearOutputs?: () => void;
  isPresentationMode?: boolean;
  presentationSpeed?: number;
}

export default function CodeCell({
  cell,
  isActive,
  onClick,
  onChange,
  onExecute,
  onClearOutputs,
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
        <div className="code-block bg-neutral-50 dark:bg-neutral-800 rounded-md overflow-hidden p-6 mb-4">
          {isPresenting ? (
            <div>
              <HighlightedCode code={displayedCode} />
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
        <div className="output-container mt-4">
          <div className="flex justify-between items-center border-t border-neutral-200 dark:border-neutral-700 pt-2 pb-2">
            <div className="text-xs text-neutral-500 font-medium">Output:</div>
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
              <span className="ml-1">Clear output</span>
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
