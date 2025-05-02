import { Switch, Route } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import NotebookPage from "@/pages/notebook-page";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/notebook/:id" component={NotebookPage} />
      <Route path="/notebook" component={NotebookPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <TooltipProvider>
      <Toaster />
      <Router />
    </TooltipProvider>
  );
}

export default App;
