import { CellOutput } from "@/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

interface OutputAreaProps {
  outputs: CellOutput[];
}

const TextOutput = ({ text }: { text: string[] }) => (
  <pre className="p-3 text-sm text-slate-800 font-mono whitespace-pre-wrap overflow-x-auto bg-white border border-neutral-200 rounded-md shadow-[inset_0_0_0_1px_rgba(0,0,0,0.02)]">
    {text.join("\n")}
  </pre>
);

const HtmlOutput = ({ html }: { html: string }) => {
  // Fix video paths by converting Windows backslashes to forward slashes
  const fixedHtml = html.replace(/src="([^"]*)"/g, (match, src) => {
    // Convert backslashes to forward slashes for web compatibility
    const fixedSrc = src.replace(/\\/g, '/');
    return `src="${fixedSrc}"`;
  });
  
  return (
    <div
      className="p-2"
      dangerouslySetInnerHTML={{ __html: fixedHtml }}
    />
  );
};

const ErrorOutput = ({ traceback }: { traceback: string[] }) => (
  <Alert variant="destructive" className="bg-red-50 dark:bg-red-900/20">
    <AlertTriangle className="h-4 w-4" />
    <AlertDescription>
      <pre className="whitespace-pre-wrap text-sm text-red-700 dark:text-red-300 font-mono mt-2 overflow-x-auto">
        {traceback.join("\n")}
      </pre>
    </AlertDescription>
  </Alert>
);

const ImageOutput = ({ src, alt = "Output image" }: { src: string; alt?: string }) => (
  <div className="p-2 flex justify-start">
    <img 
      src={src} 
      alt={alt} 
      className="max-w-full h-auto object-contain max-h-[70vh] rounded-md" 
    />
  </div>
);

export function OutputArea({ outputs }: OutputAreaProps) {
  if (!outputs || outputs.length === 0) {
    return null;
  }

  return (
    <ScrollArea className="bg-white rounded overflow-x-auto w-full p-1">
      {outputs.map((output, index) => {
        if (output.output_type === "stream" && output.text) {
          return <TextOutput key={index} text={output.text} />;
        }
        
        if (output.output_type === "error" && output.traceback) {
          return <ErrorOutput key={index} traceback={output.traceback} />;
        }
        
        if (output.output_type === "display_data" || output.output_type === "execute_result") {
          if (output.data?.["text/html"]) {
            return <HtmlOutput key={index} html={output.data["text/html"]} />;
          }
          
          if (output.data?.["image/png"]) {
            return (
              <ImageOutput 
                key={index} 
                src={`data:image/png;base64,${output.data["image/png"]}`} 
              />
            );
          }
          
          if (output.data?.["text/plain"]) {
            return <TextOutput key={index} text={[output.data["text/plain"]]} />;
          }
        }
        
        return null;
      })}
    </ScrollArea>
  );
}
