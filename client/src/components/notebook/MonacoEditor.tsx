import { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import { Spinner } from "@/components/ui/spinner";

interface MonacoEditorProps {
  language: string;
  value: string;
  onChange: (value: string) => void;
  height?: number;
}

// Configure Monaco worker
self.MonacoEnvironment = {
  getWorkerUrl: function (_moduleId: any, label: string) {
    if (label === 'json') {
      return './monaco-editor/esm/vs/language/json/json.worker?worker';
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return './monaco-editor/esm/vs/language/css/css.worker?worker';
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return './monaco-editor/esm/vs/language/html/html.worker?worker';
    }
    if (label === 'typescript' || label === 'javascript') {
      return './monaco-editor/esm/vs/language/typescript/ts.worker?worker';
    }
    return './monaco-editor/esm/vs/editor/editor.worker?worker';
  }
};

export default function MonacoEditor({
  language,
  value,
  onChange,
  height = 200,
}: MonacoEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const editorInstanceRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelMonacoInit = false;

    const initMonaco = async () => {
      setIsLoading(true);
      try {
        if (cancelMonacoInit) return;

        if (editorRef.current && !editorInstanceRef.current) {
          // Set up basic editor configuration
          const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
            value,
            language: language === 'python' ? 'python' : language,
            theme: document.documentElement.classList.contains("dark") 
              ? "jupyter-python-dark" 
              : "jupyter-python",
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
          };

          // Create editor
          editorInstanceRef.current = monaco.editor.create(editorRef.current, editorOptions);

          // Add event listener for changes
          editorInstanceRef.current.onDidChangeModelContent(() => {
            onChange(editorInstanceRef.current?.getValue() || "");
          });

          // Focus editor when created
          editorInstanceRef.current.focus();
        }
      } catch (error) {
        console.error("Failed to load Monaco Editor:", error);
      } finally {
        setIsLoading(false);
      }
    };

    initMonaco();

    // Clean up
    return () => {
      cancelMonacoInit = true;
      if (editorInstanceRef.current) {
        editorInstanceRef.current.dispose();
        editorInstanceRef.current = null;
      }
    };
  }, [language]);

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
