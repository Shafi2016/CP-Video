import { useState } from "react";
import { Cell } from "@/types";
import { Edit, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import MarkdownEditor from "./MarkdownEditor";
import ReactMarkdown from "react-markdown";

interface MarkdownCellProps {
  cell: Cell;
  isActive: boolean;
  onClick: () => void;
  onChange: (content: string) => void;
}

export default function MarkdownCell({
  cell,
  isActive,
  onClick,
  onChange,
}: MarkdownCellProps) {
  const [isEditing, setIsEditing] = useState(false);

  const toggleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(!isEditing);
  };

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(false);
  };

  return (
    <div
      className={cn(
        "cell mb-5 pl-3 pr-2 py-2 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 rounded-md",
        isActive && "border-l-2 border-l-primary"
      )}
      onClick={onClick}
      data-cell-type="markdown"
    >
      <div className="flex justify-between mb-2">
        <div className="text-xs text-neutral-500 dark:text-neutral-400 flex items-center">
          <span className="font-semibold">Markdown</span>
        </div>
        <div className="flex items-center">
          <button
            className="p-1 text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            onClick={isEditing ? handleSave : toggleEdit}
          >
            {isEditing ? (
              <Check className="h-3 w-3" />
            ) : (
              <Edit className="h-3 w-3" />
            )}
          </button>
        </div>
      </div>

      {isEditing ? (
        <MarkdownEditor
          value={cell.content}
          onChange={onChange}
        />
      ) : (
        <div className="markdown-content prose dark:prose-invert max-w-none px-4 py-2 bg-white dark:bg-neutral-800 rounded-md">
          <ReactMarkdown>{cell.content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
