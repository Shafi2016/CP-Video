import { useState } from 'react';
import { Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { queryClient } from '@/lib/queryClient';
import { useLocation } from 'wouter';

interface NotebookUploadProps {
  onSuccess?: () => void;
  /** when true, skip the Trigger button and show the dialog immediately */
  openImmediately?: boolean;
}

export const NotebookUpload = ({ onSuccess, openImmediately }: NotebookUploadProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState(!!openImmediately);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      if (selectedFile.name.endsWith('.ipynb')) {
        setFile(selectedFile);
      } else {
        toast({
          title: 'Invalid file type',
          description: 'Please select a .ipynb file',
          variant: 'destructive',
        });
        e.target.value = '';
      }
    }
  };

  const handleUpload = async () => {
    if (!file) {
      toast({
        title: 'No file selected',
        description: 'Please select a .ipynb file to upload',
        variant: 'destructive',
      });
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('notebook', file);

      const response = await fetch('/api/notebooks/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || response.statusText);
      }

      const responseJson = await response.json();
      console.log('Upload response:', responseJson);

      // More comprehensive query invalidation
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/notebooks'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/notebooks/recent'] }),
        // Invalidate all notebook-related queries
        queryClient.invalidateQueries({ 
          predicate: (query) => {
            const key = query.queryKey[0] as string;
            return key === '/api/notebooks' || key?.startsWith('/api/notebooks/');
          }
        })
      ]);

      // Wait a bit for queries to refetch
      await new Promise(resolve => setTimeout(resolve, 100));

      toast({
        title: 'Upload successful',
        description: `${file.name} has been uploaded successfully`,
      });

      // Reset form and close dialog
      setFile(null);
      setOpen(false);

      // Navigate to the uploaded notebook instead of the notebook manager.
      if (responseJson && responseJson.id) {
        const notebookPath = `/code/notebook/${responseJson.id}`;
        queryClient.setQueryData([`/api/notebooks/${responseJson.id}`], responseJson);
        console.log('Navigating to notebook:', responseJson.id);
        setLocation(notebookPath);
      } else {
        console.warn('No notebook ID in response, opening a new notebook');
        setLocation('/code');
      }

      // Call onSuccess after navigation so parent dialogs can close safely.
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'There was an error uploading your notebook',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* show trigger only when NOT launched from navbar */}
      {!openImmediately && (
        <DialogTrigger asChild>
          <Button variant="outline" className="gap-2">
            <Upload className="h-4 w-4" />
            Upload Notebook
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Notebook</DialogTitle>
          <DialogDescription>
            Import an existing Jupyter Notebook (.ipynb) file into your workspace.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="notebook-file">Select file</Label>
            <div
              className="flex items-center gap-3 rounded-md border border-input bg-background px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => document.getElementById('notebook-file')?.click()}
            >
              <input
                id="notebook-file"
                type="file"
                accept=".ipynb"
                onChange={handleFileChange}
                className="hidden"
              />
              <span className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
                <Upload className="h-4 w-4" />
                Choose File
              </span>
              <span className="text-sm text-muted-foreground truncate">
                {file ? file.name : 'No file chosen'}
              </span>
            </div>
          </div>
          {file && (
            <div className="text-sm">
              <div className="font-medium">Selected file:</div>
              <div className="text-neutral-600 dark:text-neutral-400">{file.name}</div>
            </div>
          )}
        </div>
        <DialogFooter className="sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setOpen(false)}
            disabled={uploading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleUpload}
            disabled={!file || uploading}
            className="gap-2"
          >
            {uploading && (
              <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full">
                <span className="sr-only">Loading...</span>
              </div>
            )}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
