import { useState, useEffect, useRef } from "react";
import { Cell, CellExecutionState } from "@/types";
import { Play, Pause } from "lucide-react";
import MonacoEditor from "./MonacoEditor";
import { OutputArea } from "./OutputArea";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface CodeCellProps {
  cell: Cell;
  isActive: boolean;
  onClick: () => void;
  onChange: (content: string) => void;
  onExecute: () => void;
}

export default function CodeCell({
  cell,
  isActive,
  onClick,
  onChange,
  onExecute,
}: CodeCellProps) {
  const [editorHeight, setEditorHeight] = useState(150);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Adjust height based on content but with min/max constraints
    const lineCount = (cell.content.match(/\n/g) || []).length + 1;
    const newHeight = Math.max(100, Math.min(500, lineCount * 20));
    setEditorHeight(newHeight);
  }, [cell.content]);

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
      <div className="code-block bg-neutral-50 dark:bg-neutral-800 rounded-md overflow-hidden">
        <MonacoEditor
          language="python"
          value={cell.content}
          onChange={onChange}
          height={editorHeight}
        />
      </div>
      
      {cell.outputs.length > 0 && (
        <div className="output-area mt-2 border-t border-neutral-200 dark:border-neutral-700 pt-2">
          <OutputArea outputs={cell.outputs} />
        </div>
      )}
    </div>
  );
}
