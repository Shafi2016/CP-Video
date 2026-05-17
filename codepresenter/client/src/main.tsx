import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import { initializeFirebaseConfig } from "@/lib/firebase";
import { installAccessCodeFetchPatch } from "@/lib/access-code";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: Infinity,
    },
    mutations: {
      retry: false,
    },
  },
});

installAccessCodeFetchPatch();

void loadRuntimeConfig().then(() => initializeFirebaseConfig()).finally(() => {
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
});
