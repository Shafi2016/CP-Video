import { useState, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import { useTheme } from "@/hooks/use-theme";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useAuth } from "@/contexts/AuthContext";
import { getAuth } from "@/lib/firebase";
import { googleDriveService } from "@/lib/google-drive";
import VideoRecorder from "@/components/video/VideoRecorder";

import {
  Play,
  Plus,
  Save,
  Menu,
  Edit,
  CheckCircle,
  ChevronUp,
  ChevronDown,
  Copy,
  Scissors,
  Trash,
  Presentation,
  Undo,
  Upload,
  Book,
  BookOpen,
  FilePlus,
  Brain,
  ChevronDown as ChevronDownIcon,
  RotateCcw,
  Video,
  Loader2,
  Maximize2,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu';
import { Separator } from "@/components/ui/separator";
import { Notebook } from "@/types";
import { NotebookUpload } from '@/components/notebook/NotebookUpload';
import { FilePathHelper } from "../notebook/NotebookHelpers";
import { AuthButton } from '../auth/AuthButton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface NavbarProps {
  notebook: Notebook;
  activeCell: string | null;
  onTitleChange: (title: string) => void;
  onAddCell: () => void;
  onRunCell: (id?: string) => void;
  onRunAll?: (options?: { skipPresentation?: boolean }) => Promise<import("@/types").Cell[]>; // Run all cells and return updated cells
  onSaveNotebook: () => void;
  onMoveCellUp: (id: string) => void;
  onMoveCellDown: (id: string) => void;
  onDeleteCell: (id: string) => void;
  onCopyCellContent: (id: string) => void;
  onCutCellContent: (id: string) => void;
  onUndo: () => void; // Added onUndo callback
  onRestartKernel: () => void; // Restart session handler
  className?: string; // Optional className for styling
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  isPresentationMode: boolean;
  togglePresentationMode: () => void;
  presentationSpeed: number;
  setPresentationSpeed: (speed: number) => void;
  fontSize: number;
  setFontSize: (size: number) => void;
}

export function Navbar({
  notebook,
  activeCell,
  onTitleChange,
  onAddCell,
  onRunCell,
  onRunAll,
  onSaveNotebook,
  onMoveCellUp,
  onMoveCellDown,
  onDeleteCell,
  onCopyCellContent,
  onCutCellContent,
  onUndo,
  onRestartKernel,
  mobileSidebarOpen,
  setMobileSidebarOpen,
  isPresentationMode,
  togglePresentationMode,
  presentationSpeed,
  setPresentationSpeed,
  fontSize,
  setFontSize,
}: NavbarProps) {
  const { theme, setTheme } = useTheme();
  const [isSaving, setIsSaving] = useState(false);
  const [currentTitle, setCurrentTitle] = useState(notebook.title);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [showNotebookUpload, setShowNotebookUpload] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [aiDropdownOpen, setAiDropdownOpen] = useState(false);
  const [showVideoRecorder, setShowVideoRecorder] = useState(false);
  const { toast } = useToast();

  // Prevent unnecessary rerenders by memoizing dropdown toggle
  const handleDropdownOpenChange = useCallback((open: boolean) => {
    setDropdownOpen(open);
  }, []);



  // When notebook title changes from props, update local state
  useEffect(() => {
    setCurrentTitle(notebook.title);
  }, [notebook.title]);

  // Handle title changes with saving indicator
  const handleTitleChange = (value: string) => {
    setCurrentTitle(value);
    setIsSaving(true);

    // Call the actual onChange handler
    onTitleChange(value);

    // Show saving indicator for 1.5 seconds
    setTimeout(() => {
      setIsSaving(false);
    }, 1500);
  };

  // --- Download helpers ---
  const triggerDownload = (data: BlobPart, filename: string, mime: string) => {
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const toSafeFilename = (name: string, ext: string) => {
    const base = name.replace(/\s+/g, '_').replace(/[^A-Za-z0-9._-]/g, '');
    return base.endsWith(ext) ? base : `${base}${ext}`;
  };

  const downloadIpynb = () => {
    // Build minimal nbformat v4 structure
    const nb = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        language_info: { name: 'python' },
        kernelspec: {
          name: 'python3',
          display_name: 'Python 3'
        }
      },
      cells: notebook.cells.map((c) => {
        if (c.type === 'markdown') {
          return {
            cell_type: 'markdown',
            metadata: {},
            source: c.content?.split('\n').map((l, i, arr) => i < arr.length - 1 ? l + '\n' : l),
          };
        }
        // code cell
        return {
          cell_type: 'code',
          metadata: {},
          execution_count: c.execution_count ?? null,
          source: c.content?.split('\n').map((l, i, arr) => i < arr.length - 1 ? l + '\n' : l),
          outputs: [], // keep minimal; existing outputs aren't in nbformat
        };
      })
    } as any;

    const filename = toSafeFilename(notebook.title || 'Untitled', '.ipynb');
    triggerDownload(JSON.stringify(nb, null, 2), filename, 'application/json');
  };

  const downloadPy = () => {
    const lines: string[] = [];
    lines.push('# Exported from CodePresenter');
    for (const c of notebook.cells) {
      if (c.type === 'markdown') {
        lines.push('');
        lines.push('"""');
        lines.push(c.content || '');
        lines.push('"""');
        lines.push('');
      } else {
        lines.push('');
        lines.push(c.content || '');
        lines.push('');
      }
    }
    const script = lines.join('\n');
    const filename = toSafeFilename((notebook.title || 'Untitled').replace(/\.ipynb$/i, ''), '.py');
    triggerDownload(script, filename, 'text/x-python');
  };

  // Function to focus the title input when edit button is clicked
  const handleEditClick = () => {
    if (titleInputRef.current) {
      titleInputRef.current.focus();
      // Select all text for easy editing
      titleInputRef.current.select();
    }
  };

  // Handle key press events for the title input
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Save on Enter key press
    if (e.key === 'Enter') {
      if (titleInputRef.current) {
        titleInputRef.current.blur(); // Remove focus
      }
      // Force immediate save
      onSaveNotebook();
      setIsSaving(true);
      setTimeout(() => {
        setIsSaving(false);
      }, 1500);
    }
  };

  // Open in Colab handler
  const { currentUser, signInWithGoogle } = useAuth();
  const handleOpenInColab = async () => {
    try {
      // Check token expiration first
      const exp = Number(localStorage.getItem("googleAccessTokenExpiresAt") || 0);
      let accessToken = localStorage.getItem('googleAccessToken') || '';
      let userEmail = currentUser?.email || '';

      // If token is missing or expired, force re-authentication
      if (!accessToken || !userEmail || Date.now() >= exp - 60_000) {
        console.log('🔄 Token missing or expired, re-authenticating...');
        await signInWithGoogle();

        // After sign-in, get fresh token and email
        accessToken = localStorage.getItem('googleAccessToken') || '';

        // Fetch fresh auth state directly from Firebase to avoid state sync delay
        try {
          const auth = await getAuth();
          userEmail = auth?.currentUser?.email || userEmail;
        } catch { }
      }

      // Final validation
      if (!accessToken || !userEmail) {
        alert('Google Drive access not available. Please sign in with Google and allow Drive permissions.');
        return;
      }

      console.log('🚀 Opening notebook in Colab with valid token...');
      await googleDriveService.saveNotebookAndOpenInColab(notebook, userEmail, accessToken);
    } catch (err) {
      console.error('Open in Colab failed:', err);

      // Provide more specific error messages
      if (err instanceof Error) {
        if (err.message.includes('401') || err.message.includes('Unauthorized')) {
          alert('Google Drive access expired. Please sign out and sign in again to refresh permissions.');
        } else if (err.message.includes('403') || err.message.includes('Forbidden')) {
          alert('Google Drive access denied. Please ensure you have granted Drive permissions.');
        } else {
          alert(`Failed to open in Colab: ${err.message}`);
        }
      } else {
        alert('Failed to open in Colab. Please try again.');
      }
    }
  };

  const handleGenerateVideo = () => {
    // Open the new client-side video recorder
    setShowVideoRecorder(true);
  };

  return (
    <div className="fixed top-0 inset-x-0 z-[70] bg-white dark:bg-neutral-800 shadow-sm">
      {/* Single unified header row */}
      <div className="flex items-center justify-between h-12 px-4">
        <div className="flex items-center gap-1">
          <img src="/logo.png" alt="CodePresenter" className="h-9 w-9 rounded-md object-cover" />
          <div className="flex items-center gap-2 mr-2">
            <span className="text-base font-semibold text-neutral-800 dark:text-neutral-100">CodePresenter</span>
            <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300">
              Beta
            </span>
          </div>
          <div className="relative w-[200px] group mr-3">
            <Input
              ref={titleInputRef}
              value={currentTitle}
              onChange={(e) => handleTitleChange(e.target.value)}
              onKeyDown={handleKeyPress}
              onClick={handleEditClick}
              className="h-8 text-sm pr-8 border-transparent bg-transparent hover:border-neutral-300 focus:border-primary focus:ring-1 focus:ring-primary transition-colors cursor-text"
              aria-label="Notebook title"
              title="Click to edit notebook title"
            />
            {isSaving && (
              <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                <div className="animate-pulse">
                  <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                </div>
              </div>
            )}
          </div>

          <div className="h-5 w-px bg-neutral-200 dark:bg-neutral-600 mx-1" />

          <DropdownMenu open={dropdownOpen} onOpenChange={handleDropdownOpenChange}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="font-medium px-3 flex items-center gap-2">
                <Book className="h-4 w-4 mr-1" />
                File
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[240px] py-2">
              <DropdownMenuItem onSelect={() => setShowNotebookUpload(true)} className="px-4 py-2.5 text-sm">
                <Upload className="h-4 w-4 mr-3" /> Upload notebook
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => window.open("/codepresenter", "_blank")} className="px-4 py-2.5 text-sm">
                <FilePlus className="h-4 w-4 mr-3" /> New notebook
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-1.5" />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="px-4 py-2.5 text-sm">
                  <Save className="h-4 w-4 mr-3" /> Download
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-[200px] py-2">
                  <DropdownMenuItem onSelect={downloadPy} className="px-4 py-2.5 text-sm">
                    <Save className="h-4 w-4 mr-3" /> Download .py
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={downloadIpynb} className="px-4 py-2.5 text-sm">
                    <Save className="h-4 w-4 mr-3" /> Download .ipynb
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator className="my-1.5" />
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); handleOpenInColab(); }} className="px-4 py-2.5 text-sm">
                <Upload className="h-4 w-4 mr-3" /> Open in Colab
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Edit Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="font-medium px-3 flex items-center gap-2">
                <Edit className="h-4 w-4 mr-1" />
                Edit
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={onUndo}>
                <Undo className="h-4 w-4 mr-2" /> Undo
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => activeCell && onCutCellContent(activeCell)}
                disabled={!activeCell}
              >
                <Scissors className="h-4 w-4 mr-2" /> Cut
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => activeCell && onCopyCellContent(activeCell)}
                disabled={!activeCell}
              >
                <Copy className="h-4 w-4 mr-2" /> Copy
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => activeCell && onDeleteCell(activeCell)}
                disabled={!activeCell}
              >
                <Trash className="h-4 w-4 mr-2" /> Delete Cell
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* View Dropdown - Font Size */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 font-medium px-3 flex items-center gap-2 text-sm">
                <Maximize2 className="h-4 w-4 mr-1" />
                View
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[220px]">
              <DropdownMenuItem onSelect={() => setFontSize(12)} className={fontSize === 12 ? "bg-accent" : ""}>
                Small (12px)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setFontSize(14)} className={fontSize === 14 ? "bg-accent" : ""}>
                Medium (14px)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setFontSize(16)} className={fontSize === 16 ? "bg-accent" : ""}>
                Large (16px)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setFontSize(18)} className={fontSize === 18 ? "bg-accent" : ""}>
                Extra Large (18px)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Run All button */}
          <Button
            variant="ghost"
            onClick={() => onRunAll?.()}
            className="h-8 font-medium px-3 flex items-center gap-1.5 text-sm"
          >
            <Play className="h-4 w-4" />
            Run All
          </Button>
        </div>
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

        <div className="flex items-center gap-1.5">

          <Button
            variant={isPresentationMode ? "default" : "outline"}
            size="sm"
            onClick={togglePresentationMode}
            className={isPresentationMode ? "bg-amber-500 text-white hover:bg-amber-600 h-8" : "h-8"}
          >
            <Presentation className="h-3.5 w-3.5 mr-1" />
            {isPresentationMode ? "Exit Presentation" : "Presentation Mode"}
          </Button>

          {/* Restart Session */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-8">
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restart
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Restart kernel?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will restart the Python kernel and clear all cell outputs and execution counters. Variables and state in memory will be lost. Continue?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onRestartKernel}>Restart</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AuthButton />

          <div className="flex items-center ml-1">
            <Switch
              checked={theme === "dark"}
              onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
              id="theme-toggle"
            />
          </div>
        </div>
      </div>

      {isPresentationMode && (
        <div className="w-full bg-neutral-50 dark:bg-neutral-800 border-t border-neutral-100 dark:border-neutral-700 px-4 py-1.5 flex items-center">
          <span className="text-sm font-medium mr-2">Speed:</span>
          <div className="flex-1 max-w-[220px] mr-2">
            <Slider
              defaultValue={[presentationSpeed]}
              max={100}
              min={1}
              step={1}
              onValueChange={(value) => setPresentationSpeed(value[0])}
            />
          </div>
          <span className="text-sm text-neutral-500 w-8 text-right">{presentationSpeed}%</span>

          <Separator orientation="vertical" className="h-6 mx-4" />

          <Button
            variant="default"
            size="sm"
            onClick={handleGenerateVideo}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold ml-auto"
          >
            <Video className="h-4 w-4 mr-2" />
            Generate Video
          </Button>
        </div>
      )}

      {/* Video Recorder Modal */}
      {showVideoRecorder && (
        <VideoRecorder
          cells={notebook.cells}
          presentationSpeed={presentationSpeed}
          onClose={() => setShowVideoRecorder(false)}
          onRunAll={onRunAll}
          fontSize={fontSize}
        />
      )}

      {showNotebookUpload &&
        ReactDOM.createPortal(
          <NotebookUpload
            openImmediately // opens on mount
            onSuccess={() => {
              setShowNotebookUpload(false);
              setDropdownOpen(false); // Also close the dropdown when upload completes
            }}
          />,
          document.body // renders outside the navbar, so no icon
        )}
    </div>
  );
}
