import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Book, FileText, FileCode, ChevronLeft, ChevronRight, ArrowUp, RefreshCw, Trash2, Menu, Plus, Clipboard } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NotebookListItem } from "@/types";
import React, { useState, useRef, useEffect } from "react";
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { SidebarFileUpload } from "@/components/layout/SidebarFileUpload";
import { SecretAccess } from "@/components/layout/SecretAccess";

function FilesPanel() {
  const [files, setFiles] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchFiles = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/files');
      if (!response.ok) throw new Error('Failed to fetch files');
      const data = await response.json();
      setFiles(data);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to load files', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchFiles(); }, []);



  const handleDelete = async (fileName: string) => {
    if (!window.confirm(`Delete ${fileName}?`)) return;
    setDeleting(fileName);
    try {
      const response = await fetch(`/api/files/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Delete failed');
      toast({ title: 'File deleted', description: `${fileName} was deleted.` });
      fetchFiles();
    } catch (error: any) {
      toast({ title: 'Delete failed', description: error.message || 'There was an error deleting your file', variant: 'destructive' });
    } finally {
      setDeleting(null);
    }
  };

  const getFileIcon = (fileType: string) => {
    switch (fileType) {
      case 'csv': return <FileText className="h-4 w-4 text-green-500" />;
      case 'xlsx': case 'xls': return <FileText className="h-4 w-4 text-blue-500" />;
      case 'ipynb': return <FileText className="h-4 w-4 text-orange-500" />;
      default: return <FileText className="h-4 w-4 text-gray-500" />;
    }
  };

  const canDelete = (fileType: string) => ['csv', 'xlsx', 'xls', 'ipynb'].includes(fileType);

  return (
    <div className="p-2">
      <div className="flex items-center gap-2 mb-2">
        <Button variant="ghost" size="sm" className="p-1.5" title="Refresh" onClick={fetchFiles} disabled={isLoading}>
          <RefreshCw className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex items-center justify-center"
          title="Upload file"
          onClick={() => document.getElementById('sidebar-file-input')?.click()}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <input 
          id="sidebar-file-input"
          type="file" 
          accept=".csv,.xlsx,.xls,.ipynb,.py,.pdf" 
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              const formData = new FormData();
              formData.append('file', e.target.files[0]);
              
              fetch('/api/files/upload', {
                method: 'POST',
                body: formData,
              })
              .then(response => {
                if (!response.ok) throw new Error('Upload failed');
                return response.json();
              })
              .then(() => {
                toast({ title: 'Upload successful', description: `File has been uploaded successfully` });
                fetchFiles();
                e.target.value = ''; // Reset the input
              })
              .catch(error => {
                toast({ title: 'Upload failed', description: error.message || 'There was an error uploading your file', variant: 'destructive' });
              });
            }
          }}
          className="hidden"
        />
      </div>
      <div className="overflow-y-auto max-h-60">
        {files.length === 0 && !isLoading ? (
          <div className="py-2 px-2 text-sm text-gray-500">No files uploaded</div>
        ) : (
          files.map((file) => (
            <div key={file.path} className="flex items-center py-1.5 px-2 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer group">
              {getFileIcon(file.type)}
              <span className="ml-3 flex-1 truncate">{file.name}</span>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 p-0 ml-1 opacity-70 group-hover:opacity-100" title="File actions">
                    <Menu className="h-4 w-4" />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content side="left" align="end" className="z-50 min-w-[120px] rounded-md border bg-white dark:bg-neutral-800 shadow-lg p-1">
                  <DropdownMenu.Item
                    onSelect={() => window.open(file.path, '_blank')}
                    className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded"
                  >
                    Download
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => {
                      // Copy just the filename for Colab-style usage
                      navigator.clipboard.writeText(file.path);
                    }}
                    className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded"
                  >
                    <Clipboard className="h-4 w-4" />
                    Copy path
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => handleDelete(file.name)}
                    className="flex items-center gap-2 px-2 py-1.5 text-sm text-red-600 cursor-pointer hover:bg-red-100 dark:hover:bg-red-700 rounded"
                    disabled={deleting === file.name}
                  >
                    Delete
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void;
}

export function Sidebar({ isCollapsed, onToggleCollapse, sidebarWidth, onSidebarWidthChange }: SidebarProps) {
  const { data: recentNotebooks = [] } = useQuery<NotebookListItem[]>({
    queryKey: ['/api/notebooks/recent'],
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: false,
    refetchInterval: false, // Disable automatic refetching
  });

  // Local state for active section
  const [activeSection, setActiveSection] = useState<'Notebooks' | 'Files'>('Notebooks');
  // Remove this line - width now comes from props
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);
  const [, setLocation] = useLocation();

  // Mouse event handlers for resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(180, Math.min(500, e.clientX));
      onSidebarWidthChange(newWidth);
    };
    const handleMouseUp = () => { isResizing.current = false; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div
      ref={sidebarRef}
      style={{ width: isCollapsed ? 64 : sidebarWidth }}
      className={`hidden md:flex md:flex-col bg-white dark:bg-neutral-800 border-r border-neutral-200 dark:border-neutral-700 h-screen transition-all duration-300 fixed top-24 left-0 z-30`}
    >
      {/* Toggle collapse button (positioned on the right edge) */}
      <button
        className="absolute right-0 top-20 transform translate-x-1/2 bg-white dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 rounded-full p-1 shadow-md z-50"
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {isCollapsed ? (
          <ChevronRight className="h-4 w-4 text-neutral-600 dark:text-neutral-300" />
        ) : (
          <ChevronLeft className="h-4 w-4 text-neutral-600 dark:text-neutral-300" />
        )}
      </button>

      {/* Sidebar content - hide when collapsed */}
      {!isCollapsed && (
        <ScrollArea className="flex-1" scrollHideDelay={0}>

        
        <nav className="flex-1 px-2 py-4 space-y-1">
          <Button
            variant={activeSection === 'Files' ? 'secondary' : 'ghost'}
            className={`w-full justify-${isCollapsed ? 'center' : 'start'} ${activeSection === 'Files' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-neutral-700 dark:text-neutral-300'}`}
            onClick={() => setActiveSection('Files')}
          >
            <div className={`${isCollapsed ? '' : 'mr-3'}`}><FileText className="h-5 w-5" /></div>
            {!isCollapsed && 'Files'}
          </Button>
        </nav>

        {/* Show FilesPanel if Files is selected */}
        {!isCollapsed && activeSection === "Files" && (
          <div className="mt-2">
          <FilesPanel />
          <SecretAccess />
        </div>
        )}

        {!isCollapsed && recentNotebooks && recentNotebooks.length > 0 && activeSection === 'Notebooks' && (
          <div className="px-3 py-4 border-t border-neutral-200 dark:border-neutral-700">
            <h3 className="px-2 text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
              Recent Files
            </h3>
            <div className="mt-2 space-y-1">
              {recentNotebooks.map((notebook: any) => (
                <Button
                  key={notebook.id}
                  variant="ghost"
                  className="w-full justify-start text-neutral-700 dark:text-neutral-300 truncate"
                  onClick={() => window.location.href = notebook.id === 'temp-new' ? `/` : `/notebook/${notebook.id}`}
                >
                  <span className="truncate">{notebook.title}</span>
                </Button>
              ))}
            </div>
          </div>
        )}
        </ScrollArea>
      )}

      {/* Draggable resizer */}
      {!isCollapsed && (
        <div
          style={{ position: 'absolute', top: 0, right: 0, width: 8, height: '100%', zIndex: 50 }}
          className="group/sidebar-resizer"
          onMouseDown={() => { isResizing.current = true; }}
        >
          <div
            className="h-full w-full transition-colors duration-150 bg-transparent group-hover/sidebar-resizer:bg-gray-400 dark:group-hover/sidebar-resizer:bg-gray-600"
            style={{ cursor: 'ew-resize' }}
          />
        </div>
      )}
    </div>
  );
}
