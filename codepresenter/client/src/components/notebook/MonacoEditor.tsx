import { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import { Spinner } from "@/components/ui/spinner";

interface MonacoEditorProps {
  language: string;
  value: string;
  onChange: (value: string) => void;
  height?: number;
  fontSize?: number;
}

// Configure Monaco workers via Vite worker imports to ensure correct bundling and MIME types
// @ts-ignore
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
// @ts-ignore
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
// @ts-ignore
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
// @ts-ignore
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
// @ts-ignore
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).MonacoEnvironment = {
  getWorker: (_moduleId: string, label: string) => {
    if (label === 'json') return new (jsonWorker as any)();
    if (label === 'css' || label === 'scss' || label === 'less') return new (cssWorker as any)();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new (htmlWorker as any)();
    if (label === 'typescript' || label === 'javascript') return new (tsWorker as any)();
    return new (editorWorker as any)();
  }
};

export default function MonacoEditor({
  language,
  value,
  onChange,
  height = 200,
  fontSize = 14,
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
          const LINE_HEIGHT = 20; // px
          const pad = 4; // fixed minimal padding
          // Set up basic editor configuration
          const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
            value,
            language: language === 'python' ? 'python' : language,
            theme: document.documentElement.classList.contains("dark") 
              ? "vs-dark" 
              : "vs",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            scrollbar: {
              vertical: 'hidden',
              horizontal: 'hidden',
              handleMouseWheel: false,
              alwaysConsumeMouseWheel: false
            },
            scrollBeyondLastColumn: 0,
            lineNumbers: "on",
            glyphMargin: false,
            folding: true,
            lineDecorationsWidth: 10,
            automaticLayout: true,
            tabSize: 4,
            fontSize,
            fontFamily: "'Fira Code', monospace",
            overviewRulerBorder: false,
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            lineHeight: LINE_HEIGHT,
            // Disable word wrapping to allow horizontal scrolling
            wordWrap: 'off',
            padding: {
              top: pad,
              bottom: pad,
            },
            // Prevent editor from creating its own overflow scrollbars
            fixedOverflowWidgets: true,
            overflowWidgetsDomNode: editorRef.current?.parentElement || undefined,
            // Accessibility and read-only flags as requested
            readOnly: false,
            domReadOnly: false,
            ariaLabel: 'Code editor',
          };

          // Override editor colors to match container background
          const isDark = document.documentElement.classList.contains("dark");
          monaco.editor.defineTheme('custom-theme', {
            base: isDark ? 'vs-dark' : 'vs',
            inherit: true,
            rules: [],
            colors: {
              'editor.background': isDark ? '#262626' : '#f9fafb', // neutral-800 : neutral-50
            }
          });

          // Create editor
          editorInstanceRef.current = monaco.editor.create(editorRef.current, editorOptions);

          // Apply custom theme
          monaco.editor.setTheme('custom-theme');

          // Add event listener for changes
          editorInstanceRef.current.onDidChangeModelContent(() => {
            onChange(editorInstanceRef.current?.getValue() || "");
          });

          // Do NOT auto-focus here — when multiple cells exist, each editor
          // calls focus() on mount and the browser scrolls to the last one,
          // hiding cell 1. Users click a cell to focus it instead.
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

  // Update editor fontSize when prop changes
  useEffect(() => {
    if (editorInstanceRef.current) {
      editorInstanceRef.current.updateOptions({ fontSize });
    }
  }, [fontSize]);

  // Update editor height
  useEffect(() => {
    if (editorInstanceRef.current) {
      editorInstanceRef.current.layout();
      // Keep consistent minimal padding regardless of height
      editorInstanceRef.current.updateOptions({
        lineHeight: 20,
        padding: { top: 4, bottom: 4 },
      });
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
  style={{ 
    height: `${height}px`,
    backgroundColor: 'transparent'
  }}
/>    </div>
  );
}
