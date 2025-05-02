import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Book, FileText, Terminal, Settings, FileCode } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NotebookListItem } from "@/types";

export function Sidebar() {
  const [location] = useLocation();

  const { data: recentNotebooks = [] } = useQuery<NotebookListItem[]>({
    queryKey: ['/api/notebooks/recent'],
    staleTime: 60 * 1000, // 1 minute
  });

  const navItems = [
    { label: "Notebooks", icon: <Book className="h-5 w-5 mr-3" />, path: "/" },
    { label: "Files", icon: <FileText className="h-5 w-5 mr-3" />, path: "/files" },
    { label: "Console", icon: <Terminal className="h-5 w-5 mr-3" />, path: "/console" },
    { label: "Settings", icon: <Settings className="h-5 w-5 mr-3" />, path: "/settings" },
  ];

  return (
    <div className="hidden md:flex md:flex-col md:w-64 bg-white dark:bg-neutral-800 border-r border-neutral-200 dark:border-neutral-700 h-screen">
      <div className="flex items-center h-16 px-4 border-b border-neutral-200 dark:border-neutral-700">
        <div className="flex items-center">
          <svg className="h-10 w-10 mr-2 text-primary" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 16.5a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15zm-1.5-6a1.5 1.5 0 1 0 3 0V9a1.5 1.5 0 0 0-3 0v4.5z"
            />
          </svg>
          <span className="text-xl font-semibold">CodePresenter</span>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <nav className="flex-1 px-2 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.path;
            return (
              <Link key={item.path} href={item.path}>
                <Button
                  variant="ghost"
                  className={`w-full justify-start ${
                    isActive
                      ? "bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300"
                      : "text-neutral-700 dark:text-neutral-300"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </Button>
              </Link>
            );
          })}
        </nav>

        {recentNotebooks && recentNotebooks.length > 0 && (
          <div className="px-3 py-4 border-t border-neutral-200 dark:border-neutral-700">
            <h3 className="px-2 text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
              Recent Files
            </h3>
            <div className="mt-2 space-y-1">
              {recentNotebooks.map((notebook: any) => (
                <Link
                  key={notebook.id}
                  href={`/notebook/${notebook.id}`}
                >
                  <Button
                    variant="ghost"
                    className="w-full justify-start text-neutral-700 dark:text-neutral-300"
                  >
                    <FileCode className="h-4 w-4 mr-3 text-neutral-500" />
                    {notebook.title}
                  </Button>
                </Link>
              ))}
            </div>
          </div>
        )}


      </ScrollArea>
    </div>
  );
}
