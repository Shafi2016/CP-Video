import { Switch, Route, useLocation } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { AuthProvider } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/AuthContext";
import { AccessCodeGate } from "@/components/auth/AccessCodeGate";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import NotebookPage from "@/pages/notebook-page";
import Files from "@/pages/Files";
import OpenPage from "@/pages/OpenPage";
import RenderExport from "@/pages/RenderExport";
import RenderModePage from "@/pages/RenderModePage";
import LandingPage from "@/pages/LandingPage";
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import PricingPage from "@/pages/PricingPage";
import DashboardPage from "@/pages/DashboardPage";
import { useEffect } from "react";

function ProtectedRoutes() {
    const { currentUser, loading } = useAuth();
    const [, setLocation] = useLocation();

    useEffect(() => {
        if (!loading && !currentUser) {
            setLocation("/login");
        }
    }, [loading, currentUser, setLocation]);

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-950 via-gray-900 to-emerald-950 flex items-center justify-center text-slate-300">
                Loading...
            </div>
        );
    }

    if (!currentUser) {
        return null;
    }

    return (
        <Switch>
            <Route path="/dashboard" component={DashboardPage} />

            <Route path="/code" component={NotebookPage} />
            <Route path="/code/notebooks" component={NotebookPage} />
            <Route path="/code/notebook/:id" component={NotebookPage} />
            <Route path="/code/open" component={OpenPage} />
            <Route path="/code/files" component={Files} />

            <Route path="/codepresenter" component={NotebookPage} />
            <Route path="/codepresenter/notebooks" component={NotebookPage} />
            <Route path="/codepresenter/notebook/:id" component={NotebookPage} />
            <Route path="/codepresenter/open" component={OpenPage} />
            <Route path="/codepresenter/files" component={Files} />

            <Route path="/notebooks" component={NotebookPage} />
            <Route path="/notebook/:id" component={NotebookPage} />
            <Route path="/notebook" component={NotebookPage} />
            <Route path="/open" component={OpenPage} />
            <Route path="/files" component={Files} />

            <Route component={NotFound} />
        </Switch>
    );
}

function Router() {
    return (
        <Switch>
            {/* Render Export - Deterministic Mode */}
            <Route path="/render/export" component={RenderExport} />
            <Route path="/render-mode" component={RenderModePage} />

            {/* Public routes */}
            <Route path="/login" component={LoginPage} />
            <Route path="/signup" component={SignupPage} />
            <Route path="/pricing" component={PricingPage} />
            <Route path="/" component={LandingPage} />

            {/* Protected routes */}
            <Route>
                <ProtectedRoutes />
            </Route>
        </Switch>
    );
}

function App() {
    useEffect(() => {
        const originalConsoleError = console.error;
        console.error = (...args) => {
            const errorMessage = args[0]?.toString() || '';
            if (errorMessage.includes('WebSocket') || errorMessage.includes('network') || errorMessage.includes('reload')) {
                return;
            }
            originalConsoleError.apply(console, args);
        };
        return () => { console.error = originalConsoleError; };
    }, []);

    return (
        <ThemeProvider>
            <AccessCodeGate>
                <AuthProvider>
                    <TooltipProvider>
                        <Toaster />
                        <Router />
                    </TooltipProvider>
                </AuthProvider>
            </AccessCodeGate>
        </ThemeProvider>
    );
}

export default App;
