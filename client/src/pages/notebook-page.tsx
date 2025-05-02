import { useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Notebook } from "@/components/notebook/Notebook";
import { Notebook as NotebookType } from "@/types";

export default function NotebookPage() {
  const [, setLocation] = useLocation();
  const [match, params] = useRoute("/notebook/:id");
  const notebookId = match ? params.id : undefined;

  // Query the specific notebook by ID - make a direct API call to get notebook content
  const { data: notebook, error, isLoading } = useQuery<NotebookType>({
    queryKey: [`/api/notebooks/${notebookId}`],
    enabled: !!notebookId,
    retry: 1, // Limit retries
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (error) {
      console.error("Error loading notebook:", error);
      setLocation("/");
    }
  }, [error, setLocation]);

  // Add debugging to see the notebook data
  console.log('Notebook data:', notebook);
  
  // Create a new notebook if no ID is provided or initialize with fetched data
  if (notebookId && !notebook) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="spinner inline-block mb-2 text-primary">
            <svg className="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <p className="text-lg font-medium">Loading notebook...</p>
        </div>
      </div>
    );
  }
  
  // Make sure we're not passing a list of notebooks as initialNotebook
  const validNotebook = notebook && !Array.isArray(notebook) ? notebook : undefined;
  return <Notebook id={notebookId} initialNotebook={validNotebook} />;
}
