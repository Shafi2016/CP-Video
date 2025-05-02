import { useState, useCallback, useEffect, useRef } from "react";
import { jupyterClient } from "@/lib/jupyter-client";
import { ExecuteResponse } from "@/types";
import { useToast } from "@/hooks/use-toast";

export function useJupyter() {
  const [isConnected, setIsConnected] = useState(false);
  const [kernelStatus, setKernelStatus] = useState<string>("idle");
  const [kernelInfo, setKernelInfo] = useState(null);
  const executionCallbacks = useRef(new Map<string, (result: ExecuteResponse) => void>());
  const { toast } = useToast();

  useEffect(() => {
    // Set up message handlers
    jupyterClient.onMessage((message) => {
      if (message.type === "kernel_status") {
        setKernelStatus(message.content.status);
      } else if (message.type === "kernel_info") {
        setKernelInfo(message.content);
      } else if (message.type === "execute_result") {
        const callback = executionCallbacks.current.get(message.content.cellId);
        if (callback) {
          callback(message.content);
          executionCallbacks.current.delete(message.content.cellId);
        }
      }
    });

    // Set up connection state handlers
    jupyterClient.onOpen(() => {
      setIsConnected(true);
      toast({
        title: "Connected",
        description: "Connected to Jupyter server",
      });
    });

    jupyterClient.onClose(() => {
      setIsConnected(false);
      toast({
        title: "Disconnected",
        description: "Lost connection to Jupyter server",
        variant: "destructive",
      });
    });

    jupyterClient.onError(() => {
      setIsConnected(false);
      toast({
        title: "Connection Error",
        description: "Failed to connect to Jupyter server",
        variant: "destructive",
      });
    });

    // Clean up on unmount
    return () => {
      jupyterClient.disconnect();
    };
  }, [toast]);

  const connectToKernel = useCallback(async (kernelName = "python3") => {
    try {
      await jupyterClient.connect();
      await jupyterClient.startKernel(kernelName);
    } catch (error) {
      console.error("Failed to connect to kernel:", error);
      toast({
        title: "Connection Failed",
        description: "Could not connect to Jupyter kernel",
        variant: "destructive",
      });
    }
  }, [toast]);

  const executeCode = useCallback(
    (code: string, cellId: string): Promise<ExecuteResponse> => {
      return new Promise((resolve, reject) => {
        if (!isConnected) {
          reject(new Error("Not connected to kernel"));
          return;
        }

        // Register callback for this execution
        executionCallbacks.current.set(cellId, resolve);

        // Send execute request
        jupyterClient.executeCode(code, cellId).catch((error) => {
          executionCallbacks.current.delete(cellId);
          reject(error);
        });

        // Set a timeout for execution
        setTimeout(() => {
          if (executionCallbacks.current.has(cellId)) {
            executionCallbacks.current.delete(cellId);
            reject(new Error("Execution timed out"));
          }
        }, 60000); // 1 minute timeout
      });
    },
    [isConnected]
  );

  const interruptKernel = useCallback(async () => {
    try {
      await jupyterClient.interruptKernel();
    } catch (error) {
      console.error("Failed to interrupt kernel:", error);
      toast({
        title: "Interrupt Failed",
        description: "Could not interrupt kernel execution",
        variant: "destructive",
      });
    }
  }, [toast]);

  const restartKernel = useCallback(async () => {
    try {
      await jupyterClient.restartKernel();
      toast({
        title: "Kernel Restarted",
        description: "Jupyter kernel has been restarted",
      });
    } catch (error) {
      console.error("Failed to restart kernel:", error);
      toast({
        title: "Restart Failed",
        description: "Could not restart kernel",
        variant: "destructive",
      });
    }
  }, [toast]);

  return {
    isConnected,
    kernelStatus,
    kernelInfo,
    connectToKernel,
    executeCode,
    interruptKernel,
    restartKernel,
  };
}
