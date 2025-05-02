import { useTheme } from "@/hooks/use-theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Play,
  Plus,
  Save,
  Menu,
  Edit,
  ChevronUp,
  ChevronDown,
  Copy,
  Scissors,
  Trash,
  Presentation,
  Undo,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Notebook } from "@/types";

interface NavbarProps {
  notebook: Notebook;
  activeCell: string | null;
  onTitleChange: (title: string) => void;
  onAddCell: () => void;
  onRunCell: (id?: string) => void;
  onSaveNotebook: () => void;
  onMoveCellUp: (id: string) => void;
  onMoveCellDown: (id: string) => void;
  onDeleteCell: (id: string) => void;
  onCopyCellContent: (id: string) => void;
  onCutCellContent: (id: string) => void;
  onUndo: () => void; // Added onUndo callback
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  isPresentationMode: boolean;
  togglePresentationMode: () => void;
  presentationSpeed: number;
  setPresentationSpeed: (speed: number) => void;
}

export function Navbar({
  notebook,
  activeCell,
  onTitleChange,
  onAddCell,
  onRunCell,
  onSaveNotebook,
  onMoveCellUp,
  onMoveCellDown,
  onDeleteCell,
  onCopyCellContent,
  onCutCellContent,
  onUndo,
  mobileSidebarOpen,
  setMobileSidebarOpen,
  isPresentationMode,
  togglePresentationMode,
  presentationSpeed,
  setPresentationSpeed,
}: NavbarProps) {
  const { theme, setTheme } = useTheme();

  return (
    <div className="bg-white dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700">
      <div className="flex items-center justify-between h-16 px-4">
        <div className="flex items-center md:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
            aria-label="Toggle sidebar"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 ml-4 md:ml-0 flex">
          <div className="relative w-full max-w-sm">
            <Input
              value={notebook.title}
              onChange={(e) => onTitleChange(e.target.value)}
              className="pr-10"
            />
            <div className="absolute inset-y-0 right-0 flex items-center pr-3">
              <Edit className="h-4 w-4 text-neutral-400" />
            </div>
          </div>
        </div>

        <div className="ml-4 flex items-center gap-2">
          <Button 
            variant="default"
            onClick={() => onRunCell(activeCell || undefined)}
            className="bg-primary"
          >
            <Play className="h-4 w-4 mr-1.5" />
            Run
          </Button>

          <Button 
            variant="secondary" 
            onClick={onAddCell}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Cell
          </Button>
          
          <Button
            variant={isPresentationMode ? "default" : "outline"}
            onClick={togglePresentationMode}
            className={isPresentationMode ? "bg-amber-500 text-white hover:bg-amber-600" : ""}
          >
            <Presentation className="h-4 w-4 mr-1.5" />
            {isPresentationMode ? "Exit Presentation" : "Presentation Mode"}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={onSaveNotebook}
            aria-label="Save notebook"
          >
            <Save className="h-5 w-5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={onUndo}
            aria-label="Undo action"
            title="Undo (Ctrl+Z/Cmd+Z)"
          >
            <Undo className="h-5 w-5" />
          </Button>

          <div className="flex items-center ml-2">
            <span className="mr-2 text-sm text-neutral-600 dark:text-neutral-400">
              Light
            </span>
            <Switch
              checked={theme === "dark"}
              onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
              id="theme-toggle"
            />
            <span className="ml-2 text-sm text-neutral-600 dark:text-neutral-400">
              Dark
            </span>
          </div>
        </div>
      </div>

      <div className="px-4 py-2 flex items-center space-x-3 border-t border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800">
        {isPresentationMode ? (
          <div className="flex flex-1 items-center space-x-4">
            <div className="text-sm font-medium">Presentation Speed:</div>
            <div className="flex-1 max-w-md">
              <Slider
                defaultValue={[presentationSpeed]}
                max={100}
                min={1}
                step={1}
                onValueChange={(value) => setPresentationSpeed(value[0])}
              />
            </div>
            <div className="text-sm text-neutral-500 w-8 text-right">
              {presentationSpeed}%
            </div>
          </div>
        ) : (
          <>
            <div className="relative">
              <select
                disabled={!activeCell}
                className="block w-full py-1 pl-3 pr-10 text-sm border border-neutral-300 dark:border-neutral-600 rounded-md focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary dark:bg-neutral-700 dark:text-white"
              >
                <option>Code</option>
                <option>Markdown</option>
                <option>Raw</option>
              </select>
            </div>

            <div className="flex items-center space-x-1">
              <Button
                variant="ghost"
                size="icon"
                disabled={!activeCell}
                onClick={() => activeCell && onCutCellContent(activeCell)}
                className="p-1.5 h-8 w-8"
              >
                <Scissors className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={!activeCell}
                onClick={() => activeCell && onCopyCellContent(activeCell)}
                className="p-1.5 h-8 w-8"
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Separator orientation="vertical" className="h-4" />
              <Button
                variant="ghost"
                size="icon"
                disabled={!activeCell}
                onClick={() => activeCell && onMoveCellUp(activeCell)}
                className="p-1.5 h-8 w-8"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={!activeCell}
                onClick={() => activeCell && onMoveCellDown(activeCell)}
                className="p-1.5 h-8 w-8"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Separator orientation="vertical" className="h-4" />
              <Button
                variant="ghost"
                size="icon"
                disabled={!activeCell}
                onClick={() => activeCell && onDeleteCell(activeCell)}
                className="p-1.5 h-8 w-8"
              >
                <Trash className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
