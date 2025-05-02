import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Sidebar } from "@/components/layout/Sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Plus, Search, FileCode, ChevronDown } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useTheme } from "@/hooks/use-theme";
import { NotebookListItem } from "@/types";
import { Separator } from "@/components/ui/separator";
import { NotebookUpload } from "@/components/notebook/NotebookUpload";

export default function Home() {
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  
  const { data: notebooks, isLoading } = useQuery<NotebookListItem[]>({
    queryKey: ['/api/notebooks'],
  });

  const filteredNotebooks = notebooks?.filter(
    (notebook) => notebook.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile sidebar */}
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="p-0 w-4/5">
          <Sidebar />
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar */}
      <Sidebar />

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

            <div className="flex-1 mx-4">
              <h1 className="text-xl font-semibold">Jupyter Notebooks</h1>
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex items-center">
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => {
                    const newTheme = theme === "dark" ? "light" : "dark";
                    setTheme(newTheme);
                  }}
                >
                  {theme === "dark" ? "Switch to Light" : "Switch to Dark"}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-auto p-6 bg-white dark:bg-neutral-900">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
              <h2 className="text-2xl font-bold mb-4 md:mb-0">
                My Notebooks
              </h2>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-neutral-500 h-4 w-4" />
                  <Input
                    type="search"
                    placeholder="Search notebooks..."
                    className="pl-10"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <NotebookUpload onSuccess={() => {
                    // Refresh the notebooks list
                  }} />
                  <Link href="/notebook">
                    <Button className="bg-primary">
                      <Plus className="mr-2 h-4 w-4" />
                      New Notebook
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
            
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
            ) : filteredNotebooks && filteredNotebooks.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
                {filteredNotebooks.map((notebook) => (
                  <Link key={notebook.id} href={`/notebook/${notebook.id}`}>
                    <Card className="cursor-pointer hover:shadow-md transition-shadow">
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center">
                          <FileCode className="h-5 w-5 mr-2 text-primary" />
                          {notebook.title}
                        </CardTitle>
                        <CardDescription>
                          Last modified: {new Date(notebook.lastModified).toLocaleDateString()}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-neutral-600 dark:text-neutral-400 truncate">
                          {notebook.path}
                        </p>
                      </CardContent>
                      <CardFooter className="flex justify-between pt-2">
                        <span className="text-xs text-neutral-500">Python</span>
                        <Button variant="ghost" size="sm">
                          Open
                        </Button>
                      </CardFooter>
                    </Card>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <FileCode className="mx-auto h-12 w-12 text-neutral-400" />
                <h3 className="mt-4 text-lg font-medium">No notebooks found</h3>
                <p className="mt-2 text-neutral-600 dark:text-neutral-400">
                  {searchQuery
                    ? `No results for "${searchQuery}"`
                    : "Get started by creating or uploading a notebook"}
                </p>
                <div className="flex gap-3 justify-center mt-6">
                  <NotebookUpload onSuccess={() => {
                    // Refresh the notebooks list
                  }} />
                  <Link href="/notebook">
                    <Button className="bg-primary">
                      <Plus className="mr-2 h-4 w-4" />
                      Create a new notebook
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
