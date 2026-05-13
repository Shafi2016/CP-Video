import { Button } from "@/components/ui/button";
import { Code } from "lucide-react";
import { toast } from "@/hooks/use-toast";

/**
 * Component that provides file path helper information
 */
export const FilePathHelper = () => {
  const copyPathExample = () => {
    navigator.clipboard.writeText(`
# Define helper function to find uploaded files
def get_file_path(filename):
    """Find the correct path to an uploaded file"""
    import os
    # Try different possible locations
    possible_paths = [
        # Current directory
        filename,
        # Uploads directory (absolute)
        f"/uploads/{filename}",
        # Uploads directory (relative)
        f"uploads/{filename}",
        # Server uploads directory
        f"../uploads/{filename}"
    ]
    
    for path in possible_paths:
        if os.path.exists(path):
            print(f"Found file at: {path}")
            return path
    
    print(f"Warning: File '{filename}' not found in any known location")
    return filename

# Example for reading uploaded CSV files
import pandas as pd

# Use the helper function
df = pd.read_csv(get_file_path("results(5).csv"))
`);
    
    toast({
      title: "Code copied to clipboard",
      description: "Example code has been copied to your clipboard",
    });
  };
  
  return (
    <Button 
      variant="outline" 
      size="sm" 
      className="gap-1" 
      onClick={copyPathExample}
    >
      <Code className="h-3.5 w-3.5" />
      Copy File Helper
    </Button>
  );
};
