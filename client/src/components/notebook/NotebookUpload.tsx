import { useState } from 'react';
import { Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { queryClient } from '@/lib/queryClient';

interface NotebookUploadProps {
  onSuccess?: () => void;
}

export const NotebookUpload = ({ onSuccess }: NotebookUploadProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

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
        // Don't set Content-Type header when using FormData
        // Fetch will automatically set it to multipart/form-data with boundary
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || response.statusText);
      }

      // Invalidate notebooks query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['/api/notebooks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notebooks/recent'] });

      toast({
        title: 'Upload successful',
        description: `${file.name} has been uploaded successfully`,
      });

      // Debug the server response
      const responseJson = await response.json();
      console.log('Upload response:', responseJson);

      // Reset form and close dialog
      setFile(null);
      setOpen(false);
      
      // Call onSuccess callback if provided
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: 'Upload failed',
        description: 'There was an error uploading your notebook',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Upload className="h-4 w-4" />
          Upload Notebook
        </Button>
      </DialogTrigger>
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
            <Input
              id="notebook-file"
              type="file"
              accept=".ipynb"
              onChange={handleFileChange}
              className="cursor-pointer"
            />
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
