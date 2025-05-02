import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown, Trash, Play, Edit } from "lucide-react";
import { Cell } from "@/types";

interface CellControlsProps {
  cell: Cell;
  onExecute: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export function CellControls({
  cell,
  onExecute,
  onMoveUp,
  onMoveDown,
  onDelete,
  canMoveUp,
  canMoveDown,
}: CellControlsProps) {
  return (
    <div className="absolute left-0 top-0 bottom-0 -ml-10 w-9 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
      {cell.type === "code" && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={(e) => {
            e.stopPropagation();
            onExecute();
          }}
        >
          <Play className="h-4 w-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled={!canMoveUp}
        onClick={(e) => {
          e.stopPropagation();
          onMoveUp();
        }}
      >
        <ChevronUp className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled={!canMoveDown}
        onClick={(e) => {
          e.stopPropagation();
          onMoveDown();
        }}
      >
        <ChevronDown className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash className="h-4 w-4" />
      </Button>
    </div>
  );
}
