import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Sidebar } from "@/components/layout/Sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, FileCode, ChevronDown, Upload, FilePlus } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useTheme } from "@/hooks/use-theme";
import { NotebookListItem } from "@/types";
import { Separator } from "@/components/ui/separator";
import { NotebookUpload } from "@/components/notebook/NotebookUpload";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';

export default function Home() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  
  const { data: notebooks, isLoading } = useQuery<NotebookListItem[]>({
    queryKey: ["/api/notebooks"],
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: false,
    refetchInterval: false, // Disable automatic refetching
  });

  // Display all notebooks without filtering
  const filteredNotebooks = notebooks;

  const [showNotebookUpload, setShowNotebookUpload] = useState(false);
  const [showNewNotebook, setShowNewNotebook] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile sidebar */}
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="p-0 w-4/5">
          <Sidebar
            isCollapsed={false}
            onToggleCollapse={() => {}}
            sidebarWidth={sidebarWidth}
            onSidebarWidthChange={setSidebarWidth}
          />
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar */}
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={setSidebarWidth}
      />

      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Top navigation */}
        <div className="bg-white dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700">
          <div className="flex items-center justify-between h-16 px-4">
            <div className="flex items-center md:hidden">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileSidebarOpen(true)}
              >
                <ChevronDown className="h-5 w-5" />
              </Button>
            </div>

            <div className="flex items-center h-16 px-4 gap-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="font-medium px-3">File</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => setShowNotebookUpload(true)}>
                    <Upload className="h-4 w-4 mr-2" /> Upload notebook
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <h1 className="text-xl font-semibold">CodePresenter</h1>
            </div>

            <div className="flex items-center space-x-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="font-medium">File</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => setShowNotebookUpload(true)}>
                    <Upload className="h-4 w-4 mr-2" /> Upload notebook
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => window.location.href = "/code"}>
                    <FilePlus className="h-4 w-4 mr-2" /> New notebook
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-auto p-6 bg-white dark:bg-neutral-900">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
              <h2 className="text-2xl font-bold mb-4 md:mb-0">
                Notebooks
              </h2>
              <div className="flex flex-col sm:flex-row gap-2">
                <Link href="/code">
                  <Button className="bg-primary" size="lg">
                    <Plus className="mr-2 h-5 w-5" />
                    New Notebook
                  </Button>
                </Link>
                <Button 
                  variant="outline" 
                  onClick={() => setShowNotebookUpload(true)}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Notebook
                </Button>
              </div>
            </div>
            
            {/* Add a call-to-action if no notebooks exist */}
            {filteredNotebooks && filteredNotebooks.length === 0 && !isLoading && (
              <div className="mt-8 mb-12 text-center p-8 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
                <FileCode className="h-16 w-16 mx-auto mb-4 text-primary opacity-70" />
                <h3 className="text-lg font-medium mb-2">No notebooks found</h3>
                <p className="text-gray-500 dark:text-gray-400 mb-6">
                  Get started by creating a new notebook or uploading an existing one.
                </p>
                <div className="flex justify-center gap-4">
                  <Link href="/code">
                    <Button className="bg-primary">
                      <Plus className="mr-2 h-4 w-4" />
                      Create New Notebook
                    </Button>
                  </Link>
                  <Button 
                    variant="outline" 
                    onClick={() => setShowNotebookUpload(true)}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Upload Notebook
                  </Button>
                </div>
              </div>
            )}
            
            <Separator className="my-6" />
            
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
                {[...Array(6)].map((_, i) => (
                  <Card key={i} className="animate-pulse">
                    <CardHeader className="pb-2">
                      <div className="h-6 bg-neutral-200 dark:bg-neutral-700 rounded w-3/4 mb-2"></div>
                      <div className="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-1/2"></div>
                    </CardHeader>
                    <CardContent>
                      <div className="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-full mb-2"></div>
                      <div className="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-5/6"></div>
                    </CardContent>
                    <CardFooter className="flex justify-between pt-2">
                      <div className="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-1/4"></div>
                      <div className="h-8 bg-neutral-200 dark:bg-neutral-700 rounded w-1/4"></div>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
                  <thead>
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase">Title</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase">Last Modified</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase">Path</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredNotebooks && filteredNotebooks.length > 0 ? (
                      filteredNotebooks.map((notebook) => (
                        <tr key={notebook.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800">
                          <td className="px-4 py-2 font-medium">{notebook.title}</td>
                          <td className="px-4 py-2">{new Date(notebook.lastModified).toLocaleDateString()}</td>
                          <td className="px-4 py-2">{notebook.path || 'No path'}</td>
                          <td className="px-4 py-2">
                            <Button size="sm" variant="ghost" onClick={() => window.location.href = `/code/notebook/${notebook.id}`}>Open</Button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="text-center py-8 text-neutral-400">No notebooks found</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Render NotebookUpload conditionally */}
      {showNotebookUpload && (
        <NotebookUpload onSuccess={() => {
          setShowNotebookUpload(false);
          // Refresh the notebooks list after upload
          queryClient.invalidateQueries({queryKey: ["/api/notebooks"]});
        }} />
      )}
    </div>
  );
}