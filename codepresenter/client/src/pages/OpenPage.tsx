import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';

export default function OpenPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const handleDriveImport = async () => {
      try {
        // Parse URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const src = urlParams.get('src');
        const fileId = urlParams.get('id');

        if (src !== 'drive' || !fileId) {
          throw new Error('Invalid parameters. Expected src=drive&id=FILE_ID');
        }

        toast({
          title: "Opening from Google Drive",
          description: "Loading notebook from Google Drive...",
        });

        // Get Google access token
        const googleAccessToken = localStorage.getItem('googleAccessToken');
        if (!googleAccessToken) {
          throw new Error('No Google access token found. Please sign in first.');
        }

        // Check if token is still valid
        const exp = Number(localStorage.getItem("googleAccessTokenExpiresAt") || 0);
        if (Date.now() >= exp - 60_000) {
          throw new Error('Google access token expired. Please sign in again.');
        }

        // Download file from Google Drive
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
          headers: {
            'Authorization': `Bearer ${googleAccessToken}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to download file from Google Drive: ${response.status}`);
        }

        const notebookData = await response.json();

        // Convert Jupyter format back to our format
        const convertedNotebook = {
          id: Date.now().toString(), // Generate new ID for imported notebook
          title: notebookData.metadata?.title || `Imported from Drive`,
          cells: notebookData.cells?.map((cell: any) => ({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            type: cell.cell_type === 'code' ? 'code' : 'markdown',
            content: Array.isArray(cell.source) ? cell.source.join('') : cell.source || '',
            execution_state: 'idle',
            outputs: cell.outputs || [],
          })) || []
        };

        // Save the imported notebook locally
        const saveResponse = await fetch('/api/notebooks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(convertedNotebook),
        });

        if (!saveResponse.ok) {
          throw new Error('Failed to save imported notebook');
        }

        const savedNotebook = await saveResponse.json();

        toast({
          title: "Successfully imported",
          description: "Notebook imported from Google Drive successfully!",
        });

        setLocation(`/code/notebook/${savedNotebook.id}`);

      } catch (error) {
        console.error('Failed to import from Google Drive:', error);
        toast({
          title: "Import failed",
          description: error instanceof Error ? error.message : 'Failed to import notebook from Google Drive',
          variant: "destructive",
        });

        // Redirect to notebooks page on error
        setLocation('/code/notebooks');
      } finally {
        setIsLoading(false);
      }
    };

    handleDriveImport();
  }, [setLocation, toast]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="spinner inline-block mb-2 text-primary">
            <svg className="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <p className="text-lg font-medium">Importing notebook from Google Drive...</p>
          <p className="text-sm text-gray-500 mt-2">Please wait while we load your notebook</p>
        </div>
      </div>
    );
  }

  return null; // This component will redirect, so no need to render anything
}
