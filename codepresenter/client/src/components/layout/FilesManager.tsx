import { useState, useEffect } from 'react';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  FileIcon, 
  FileSpreadsheet, 
  FileText, 
  FileCode, 
  Download, 
  ExternalLink,
  RefreshCw,
  Code,
  Plus,
  Clipboard,
  MoreVertical,
  Trash2
} from 'lucide-react';
import { SidebarFileUpload } from './SidebarFileUpload';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { useLocation } from 'wouter';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface FileInfo {
  name: string;
  path: string;
  localPath?: string;
  fullPath?: string;
  size: number;
  type: string;
  uploaded: string;
}

interface FilesManagerProps {
  onInsertFileToNotebook?: (filePath: string, fileType: string) => void;
  compact?: boolean; // Add compact mode for sidebar
}

export const FilesManager = ({ onInsertFileToNotebook, compact = false }: FilesManagerProps) => {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const fetchFiles = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/files', {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch files');
      }
      const data = await response.json();
      setFiles(data);
    } catch (error) {
      console.error('Error fetching files:', error);
      toast({
        title: 'Error',
        description: 'Failed to load files',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const handleFileUploadSuccess = () => {
    fetchFiles();
  };

  const getFileIcon = (fileType: string) => {
    switch (fileType) {
      case 'csv':
        return <FileSpreadsheet className="h-5 w-5 text-green-500" />;
      case 'xlsx':
      case 'xls':
        return <FileSpreadsheet className="h-5 w-5 text-blue-500" />;
      case 'ipynb':
        return <FileCode className="h-5 w-5 text-orange-500" />;
      default:
        return <FileText className="h-5 w-5 text-gray-500" />;
    }
  };

  const formatFileSize = (sizeInBytes: number) => {
    if (sizeInBytes < 1024) {
      return `${sizeInBytes} B`;
    } else if (sizeInBytes < 1024 * 1024) {
      return `${(sizeInBytes / 1024).toFixed(1)} KB`;
    } else {
      return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), 'MMM d, yyyy h:mm a');
    } catch (e) {
      return dateString;
    }
  };

  const handleOpenInNotebook = (file: FileInfo) => {
    if (onInsertFileToNotebook) {
      // Prefer local filesystem path for Python runtime usage
      onInsertFileToNotebook(file.localPath || file.path, file.type || "");
      toast({
        title: 'File Ready',
        description: `Code to load ${file.name} inserted into notebook`,
      });
    } else {
      // If we're not in a notebook context, open a new notebook
      setLocation('/notebook');
      // Store the file info in localStorage for the notebook to pick up
      localStorage.setItem('pendingFileImport', JSON.stringify(file));
    }
  };

  const handleOpenNotebook = (file: FileInfo) => {
    if (file.type === 'ipynb') {
      // For notebooks, we would need to create a new notebook with this file's content
      // For now, just download it
      window.open(file.path, '_blank');
    }
  };

  // Compact view for sidebar
  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-xs p-1 h-7"
            onClick={fetchFiles}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Refresh
          </Button>
          <SidebarFileUpload onSuccess={handleFileUploadSuccess} />
        </div>
        
        {isLoading ? (
          <div className="flex justify-center items-center h-10">
            <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"></div>
          </div>
        ) : files.length === 0 ? (
          <div className="text-xs text-center text-muted-foreground">
            No files uploaded
          </div>
        ) : (
          <div className="space-y-1 max-h-[180px] overflow-y-auto pr-1">
            {files.map((file) => (
              <div 
                key={file.path} 
                className="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-800 rounded p-1"
              >
                <div className="flex items-center gap-1 overflow-hidden">
                  {getFileIcon(file.type)}
                  <span className="truncate max-w-[120px]">{file.name}</span>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                    >
                      <MoreVertical className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-36">
                    {onInsertFileToNotebook && (
                      <DropdownMenuItem
                        onClick={() => handleOpenInNotebook(file)}
                      >
                        <Code className="h-3 w-3 mr-2" />
                        Insert code
                      </DropdownMenuItem>
                    )}
                    {onInsertFileToNotebook && file.fullPath && (
                      <DropdownMenuItem
                        onClick={() => onInsertFileToNotebook(file.fullPath || "", file.type || "")}
                      >
                        <Code className="h-3 w-3 mr-2" />
                        Insert code using full path
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() => {
                        navigator.clipboard.writeText(file.localPath || file.path || "");
                      }}
                    >
                      <Clipboard className="h-3 w-3 mr-2" />
                      Copy path
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Full view for Files page
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Files</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchFiles}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <SidebarFileUpload onSuccess={handleFileUploadSuccess} />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center h-40">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
        </div>
      ) : files.length === 0 ? (
        <div className="text-center py-10 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <FileIcon className="h-10 w-10 text-gray-400 mx-auto mb-2" />
          <h3 className="text-lg font-medium">No files uploaded</h3>
          <p className="text-sm text-gray-500 mt-1">
            Upload files to use them in your notebooks
          </p>
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((file) => (
                <TableRow key={file.path}>
                  <TableCell className="font-medium">
                    <div className="flex items-center">
                      {getFileIcon(file.type)}
                      <span className="ml-2 truncate max-w-[250px]">{file.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="uppercase">{file.type}</TableCell>
                  <TableCell>{formatFileSize(file.size)}</TableCell>
                  <TableCell>{formatDate(file.uploaded)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end items-center gap-2">
                      {/* 3-dot menu for file actions */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="File actions"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {onInsertFileToNotebook && (
                            <DropdownMenuItem onClick={() => handleOpenInNotebook(file)}>
                              <Code className="h-4 w-4 mr-2" />
                              Insert code
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => {
                              navigator.clipboard.writeText(file.localPath || file.path);
                            }}
                          >
                            <Clipboard className="h-4 w-4 mr-2" />
                            Copy path
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      {/* Open notebook if it's a notebook file */}
                      {file.type === 'ipynb' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Open notebook"
                          onClick={() => handleOpenNotebook(file)}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}



                      {/* Standard download button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Download file"
                        onClick={() => {
                          window.open(file.path, '_blank');
                        }}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}; 
