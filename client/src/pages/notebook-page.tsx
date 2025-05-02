import { useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Notebook } from "@/components/notebook/Notebook";
import { Notebook as NotebookType } from "@/types";

export default function NotebookPage() {
  const [, setLocation] = useLocation();
  const [match, params] = useRoute("/notebook/:id");
  const notebookId = match ? params.id : undefined;

  const { data: notebook, error, isLoading } = useQuery<NotebookType>({
    queryKey: ['/api/notebooks', notebookId],
    enabled: !!notebookId,
  });

  useEffect(() => {
    if (error) {
      console.error("Error loading notebook:", error);
      setLocation("/");
    }
  }, [error, setLocation]);

  // Add some debugging to see the notebook data
  console.log('Notebook data:', notebook);
  
  return <Notebook id={notebookId} initialNotebook={notebook} />;
}
