import { useEffect, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Notebook } from "@/components/notebook/Notebook";
import { Notebook as NotebookType } from "@/types";

// Default empty notebook template for new notebooks
const emptyNotebook: NotebookType = {
  id: "temp-new",
  title: "",
  cells: [],
  kernel: {
    id: "kernel-1",
    name: "python3",
    status: "idle"
  }
};
export default function NotebookPage() {
  const [, setLocation] = useLocation();
  const [codeMatch, codeParams] = useRoute("/code/notebook/:id");
  const [legacyMatch, legacyParams] = useRoute("/notebook/:id");
  const notebookId = codeMatch ? codeParams.id : legacyMatch ? legacyParams.id : undefined;

  // Query the specific notebook by ID - make a direct API call to get notebook content
  const { data: notebook, error, isLoading } = useQuery<NotebookType>({
    queryKey: [`/api/notebooks/${notebookId}`],
    queryFn: async () => {
      if (!notebookId) throw new Error('No notebook ID provided');
      console.log('⏳ Fetching notebook with ID:', notebookId);
      
      try {
        const response = await fetch(`/api/notebooks/${notebookId}`, {
          credentials: 'include',
        });
        console.log('📊 Fetch response status:', response.status);
        
        if (!response.ok) {
          console.error('❌ Failed to fetch notebook:', response.status, response.statusText);
          throw new Error(`Failed to fetch notebook: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('📓 Notebook data received:', data);
        return data;
      } catch (err) {
        console.error('🔥 Error fetching notebook:', err);
        throw err;
      }
    },
    enabled: !!notebookId, // Only run the query if we have a notebook ID
    staleTime: Infinity,
    retry: 1, // Limit retries
    refetchOnWindowFocus: false,
    refetchInterval: false, // Disable automatic refetching
  });

  // Use ref to track if we've already redirected to prevent infinite loops
  const hasRedirectedRef = useRef(false);
  
  useEffect(() => {
    if (error && !notebook && !hasRedirectedRef.current) {
      console.error("Error loading notebook:", error);
      hasRedirectedRef.current = true;
      // Add a small delay to avoid immediate redirect
      setTimeout(() => {
        setLocation("/code/notebooks");
      }, 100);
    }
  }, [error, notebook, setLocation]);

  // Add debugging to see the notebook data
  console.log('Notebook data:', notebook);
  
  // Loading state when fetching a specific notebook
  if (notebookId && !notebook && isLoading) {
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
  const validNotebook = notebookId && notebook && !Array.isArray(notebook) 
    ? notebook 
    : !notebookId ? emptyNotebook : undefined;
  // 104-px spacer ensures the first cell and Present Code button clear the fixed two-row navbar.
return (
  <div style={{ paddingTop: '104px' }}>
    <Notebook id={notebookId} initialNotebook={validNotebook} />
  </div>
);

}
