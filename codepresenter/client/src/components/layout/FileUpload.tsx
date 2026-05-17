import { useState, useRef } from 'react';
import { Upload, FileText, X, File as FileIcon, Plus, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';

interface FileUploadProps {
  onSuccess?: (fileInfo: any) => void;
  compact?: boolean;
  directUpload?: boolean;
}

export const FileUpload = ({ onSuccess, compact = false, directUpload = false }: FileUploadProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const directFileInputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const resetForm = () => {
    setFile(null);
    setUploadProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (directFileInputRef.current) {
      directFileInputRef.current.value = '';
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      
      if (directUpload) {
        uploadFile(selectedFile);
      }
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      
      // Check if the file type is valid
      const fileExt = droppedFile.name.split('.').pop()?.toLowerCase();
      if (fileExt && ['xlsx', 'xls', 'csv', 'ipynb', 'py', 'pdf'].includes(fileExt)) {
        setFile(droppedFile);
      } else {
        toast({
          title: 'Invalid file type',
          description: 'Please upload CSV, Excel, Python, PDF, or Jupyter Notebook files',
          variant: 'destructive',
        });
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const uploadFile = async (fileToUpload: File) => {
    if (!fileToUpload) return;
    
    try {
      setUploading(true);
      setUploadProgress(10);
      
      const formData = new FormData();
      formData.append('file', fileToUpload);
      
      // Simulated progress for better UX
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 300);
      
      const response = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      
      clearInterval(progressInterval);
      
      // Check content type to determine how to handle the response
      const contentType = response.headers.get('content-type');
      
      if (!response.ok) {
        let errorMessage = 'Upload failed';
        let similarFiles = [];
        
        // Only try to parse as JSON if the content type is JSON
        if (contentType && contentType.includes('application/json')) {
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
            similarFiles = errorData.similarFiles || [];
          } catch (parseError) {
            // If JSON parsing fails, use text content if available
            errorMessage = await response.text() || errorMessage;
          }
        } else {
          // If not JSON, try to get text content
          errorMessage = await response.text() || errorMessage;
        }
        
        // Special handling for 409 Conflict (duplicate files)
        if (response.status === 409) {
          if (similarFiles.length > 0) {
            // Show a more detailed toast for similar files
            toast({
              title: 'Similar File Already Exists',
              description: (
                <div>
                  <p>{errorMessage}</p>
                  <p className="mt-2 font-medium">Similar files:</p>
                  <ul className="mt-1 list-disc pl-4">
                    {similarFiles.map((file: string, index: number) => (
                      <li key={index} className="text-sm">{file}</li>
                    ))}
                  </ul>
                </div>
              ),
              variant: 'destructive',
              duration: 6000 // Show longer for user to read
            });
          } else {
            toast({
              title: 'Duplicate File',
              description: errorMessage,
              variant: 'destructive'
            });
          }
        } else {
          toast({
            title: 'Upload Error',
            description: errorMessage,
            variant: 'destructive'
          });
        }
        setUploadProgress(0);
        return;
      }
      
      setUploadProgress(100);
      
      // Only try to parse JSON if we have a JSON content type
      let responseData;
      if (contentType && contentType.includes('application/json')) {
        responseData = await response.json();
      } else {
        // Handle unexpected content type
        responseData = { 
          name: fileToUpload.name, 
          path: '/uploads/' + fileToUpload.name 
        };
      }
      
      toast({
        title: 'Upload successful',
        description: `${fileToUpload.name} has been uploaded successfully`,
      });
      
      // If a success callback was provided, call it with the response data
      if (onSuccess) {
        onSuccess(responseData);
      }
      
      console.log('Upload response:', responseData);
      
      // Close dialog and reset form after a successful upload
      setTimeout(() => {
        setIsOpen(false);
        resetForm();
      }, 1000);
      
    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: 'Upload failed',
        description: error.message || 'There was an error uploading your file',
        variant: 'destructive',
      });
    } finally {
      setTimeout(() => {
        setUploading(false);
      }, 500);
    }
  };

  const handleUpload = () => {
    if (file) {
      uploadFile(file);
    }
  };

  // For Colab-style direct upload button
  if (directUpload) {
    return (
      <div className="relative inline-block">
        <Input 
          ref={directFileInputRef}
          type="file" 
          accept=".csv,.xlsx,.xls,.ipynb,.py,.pdf" 
          onChange={handleFileChange}
          className="absolute w-0 h-0 opacity-0"
        />
        <Button
          variant="ghost"
          size="sm"
          className="flex items-center justify-center"
          title="Upload file"
          onClick={() => directFileInputRef.current?.click()}
          disabled={uploading}
        >
          <Plus className="h-3 w-3 mr-1" />
          ArrowUp
        </Button>
      </div>
    );
  }

  // Regular dialog version
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {compact ? (
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-xs p-1 h-7"
            onClick={() => setIsOpen(true)}
          >
            <Plus className="h-3 w-3 mr-1" />
       
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => setIsOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Upload Files
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload File</DialogTitle>
          <DialogDescription>
            Upload CSV, Excel, or other data files to use in your notebooks.
          </DialogDescription>
        </DialogHeader>
        
        <div 
          className="mt-4 border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current?.click()}
        >
          <Input 
            ref={fileInputRef}
            type="file" 
            accept=".csv,.xlsx,.xls,.ipynb,.py,.pdf" 
            onChange={handleFileChange}
            className="hidden"
          />
          
          {!file ? (
            <div className="flex flex-col items-center justify-center">
              <FileText className="h-10 w-10 text-gray-400 mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Drag & drop a file here, or click to browse
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Supported formats: CSV, Excel, Python, PDF, Jupyter Notebook
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center">
              <div className="flex items-center justify-between w-full bg-gray-100 dark:bg-gray-800 rounded-md p-2 mb-2">
                <div className="flex items-center">
                  <FileIcon className="h-6 w-6 text-primary mr-2" />
                  <div className="text-left">
                    <p className="text-sm font-medium truncate max-w-[200px]">{file.name}</p>
                    <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <Button
                  variant="ghost" 
                  size="sm" 
                  className="h-6 w-6 p-0" 
                  onClick={(e) => {
                    e.stopPropagation();
                    resetForm();
                  }}
                  disabled={uploading}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              
              <Badge variant="outline" className="mt-1">
                {file.type || file.name.split('.').pop()}
              </Badge>
            </div>
          )}
        </div>
        
        {uploading && (
          <div className="mt-4">
            <Progress value={uploadProgress} className="h-2" />
            <p className="text-xs text-center mt-1 text-gray-500">
              {uploadProgress === 100 ? 'Complete!' : 'Uploading...'}
            </p>
          </div>
        )}
        
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => setIsOpen(false)} disabled={uploading}>
            Cancel
          </Button>
          <Button 
            onClick={handleUpload}
            disabled={!file || uploading}
            className={uploading ? 'opacity-80' : ''}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
