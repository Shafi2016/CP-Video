import { useState, useRef } from 'react';
import { Upload, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';

interface SidebarFileUploadProps {
  onSuccess?: (fileInfo: any) => void;
}

// This is a simplified version of FileUpload specifically for the sidebar
export const SidebarFileUpload = ({ onSuccess }: SidebarFileUploadProps) => {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const resetForm = () => {
    setUploadProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      uploadFile(selectedFile);
    }
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
      });
      
      clearInterval(progressInterval);
      
      if (!response.ok) {
        let errorMessage = 'Upload failed';
        const contentType = response.headers.get('content-type');
        
        if (contentType && contentType.includes('application/json')) {
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (parseError) {
            const textContent = await response.text();
            errorMessage = textContent || errorMessage;
          }
        } else {
          errorMessage = await response.text();
          if (errorMessage.includes('<!DOCTYPE') || errorMessage.includes('<html')) {
            errorMessage = `Server error (${response.status}: ${response.statusText})`;
          }
        }
        
        throw new Error(errorMessage);
      }
      
      setUploadProgress(100);
      
      let responseData;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        responseData = await response.json();
      } else {
        responseData = { 
          name: fileToUpload.name, 
          path: '/uploads/' + fileToUpload.name 
        };
      }
      
      toast({
        title: 'Upload successful',
        description: `${fileToUpload.name} has been uploaded successfully`,
      });
      
      if (onSuccess) {
        onSuccess(responseData);
      }
      
      resetForm();
      
    } catch (error: any) {
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

  return (
    <div className="relative inline-block">
      <Input 
        ref={fileInputRef}
        type="file" 
        accept=".csv,.xlsx,.xls,.ipynb,.py,.pdf,.png,.jpg,.jpeg,.gif,.webp,.svg" 
        onChange={handleFileChange}
        className="absolute w-0 h-0 opacity-0"
      />
      <Button
        variant="outline"
        size="sm"
        className="flex items-center justify-center h-8 px-3 text-xs"
        title="Upload file"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        <Upload className="h-4 w-4 mr-1" />
        Upload
      </Button>
      {uploading && (
        <div className="absolute left-0 right-0 bottom-0">
          <Progress value={uploadProgress} className="h-1 w-full" />
        </div>
      )}
    </div>
  );
};
