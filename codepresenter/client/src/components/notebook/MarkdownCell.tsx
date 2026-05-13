import { useState } from "react";
import { Cell } from "@/types";
import { Edit, Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import MarkdownEditor from "./MarkdownEditor";
import ReactMarkdown from "react-markdown";

interface MarkdownCellProps {
  cell: Cell;
  isActive: boolean;
  onClick: () => void;
  onChange: (content: string) => void;
  onDelete: () => void;
}

export default function MarkdownCell({
  cell,
  isActive,
  onClick,
  onChange,
  onDelete,
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
      "relative bg-white dark:bg-neutral-900 rounded-lg shadow-sm mb-4 transition-all hover:bg-neutral-50 dark:hover:bg-neutral-800 group"
    )}
      onClick={onClick}
      data-cell-type="markdown"
    >
      {/* Action buttons positioned absolutely in top-right corner */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button
          className="p-1 text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 bg-white dark:bg-neutral-800 rounded shadow-sm"
          onClick={isEditing ? handleSave : toggleEdit}
        >
          {isEditing ? (
            <Check className="h-3 w-3" />
          ) : (
            <Edit className="h-3 w-3" />
          )}
        </button>
        <button
          className="p-1 text-xs text-neutral-500 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400 bg-white dark:bg-neutral-800 rounded shadow-sm"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete cell"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {isEditing ? (
        <MarkdownEditor
          value={cell.content}
          onChange={onChange}
        />
      ) : (
        <div className="markdown-content max-w-none px-3 py-1 bg-white dark:bg-neutral-800 rounded-md text-sm">
  <div className="[&>*]:my-0 [&>h1]:text-lg [&>h2]:text-base [&>h3]:text-sm [&>p]:my-0 [&>ul]:my-0 [&>ol]:my-0 [&>li]:my-0 [&_a]:text-blue-600 dark:[&_a]:text-blue-400 [&_a:hover]:underline">
    <ReactMarkdown>{cell.content}</ReactMarkdown>
  </div>
</div>
      )}
    </div>
  );
}
