import { useEffect, useRef, useState } from "react";
import { loadMonaco } from "@/lib/monaco-loader";
import { Spinner } from "@/components/ui/spinner";

interface MonacoEditorProps {
  language: string;
  value: string;
  onChange: (value: string) => void;
  height?: number;
}

export default function MonacoEditor({
  language,
  value,
  onChange,
  height = 200,
}: MonacoEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const monacoRef = useRef<any>(null);
  const editorInstanceRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelMonacoInit = false;

    const initMonaco = async () => {
      setIsLoading(true);
      try {
        const monaco = await loadMonaco();
        if (cancelMonacoInit) return;

        monacoRef.current = monaco;

        if (editorRef.current && !editorInstanceRef.current) {
          // Configure Monaco with Python options
          monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: true,
            noSyntaxValidation: true,
          });

          monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
            target: monaco.languages.typescript.ScriptTarget.ES2016,
            allowNonTsExtensions: true,
          });

          // Create editor
          editorInstanceRef.current = monaco.editor.create(editorRef.current, {
            value,
            language,
            theme: document.documentElement.classList.contains("dark") 
              ? "vs-dark" 
              : "vs",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            lineNumbers: "on",
            glyphMargin: false,
            folding: true,
            lineDecorationsWidth: 10,
            automaticLayout: true,
            tabSize: 4,
            fontSize: 14,
            fontFamily: "'Fira Code', monospace",
          });

          // Add event listener for changes
          editorInstanceRef.current.onDidChangeModelContent(() => {
            onChange(editorInstanceRef.current.getValue());
          });
        }
      } catch (error) {
        console.error("Failed to load Monaco Editor:", error);
      } finally {
        setIsLoading(false);
      }
    };

    initMonaco();

    const handleThemeChange = () => {
      if (monacoRef.current && editorInstanceRef.current) {
        const isDark = document.documentElement.classList.contains("dark");
        monacoRef.current.editor.setTheme(isDark ? "vs-dark" : "vs");
      }
    };

    // Add observer for theme changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "class"
        ) {
          handleThemeChange();
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      cancelMonacoInit = true;
      observer.disconnect();
      if (editorInstanceRef.current) {
        editorInstanceRef.current.dispose();
        editorInstanceRef.current = null;
      }
    };
  }, []);

  // Update editor value when prop changes
  useEffect(() => {
    if (editorInstanceRef.current && value !== editorInstanceRef.current.getValue()) {
      editorInstanceRef.current.setValue(value);
    }
  }, [value]);

  // Update editor height
  useEffect(() => {
    if (editorInstanceRef.current) {
      editorInstanceRef.current.layout();
    }
  }, [height]);

  return (
    <div className="relative">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-100 dark:bg-neutral-800 bg-opacity-75 z-10">
          <Spinner />
        </div>
      )}
      <div 
        ref={editorRef} 
        className="font-mono text-sm monaco-editor" 
        style={{ height: `${height}px` }}
      />
    </div>
  );
}
