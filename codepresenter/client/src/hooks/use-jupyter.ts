import { useState, useEffect, useCallback, useRef } from 'react';
import { jupyterClient } from '@/lib/jupyter-client';
import type { ExecuteResponse } from '@/types';
import { useToast } from '@/hooks/use-toast';

const EXECUTION_TIMEOUT_MS = Number(import.meta.env.VITE_JUPYTER_EXECUTION_TIMEOUT_MS || 30 * 60 * 1000);

// Shared promise so concurrent callers wait for the same kernel startup flow
let connectPromise: Promise<void> | null = null;

export function useJupyter() {
  const [isConnected, setIsConnected] = useState(jupyterClient.isSocketConnected());
  const [isKernelReady, setIsKernelReady] = useState(jupyterClient.isKernelActive());
  const [kernelStatus, setKernelStatus] = useState<string>("idle");
  const [kernelInfo, setKernelInfo] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [lastActivity, setLastActivity] = useState<Date>(new Date());
  const executionCallbacks = useRef(new Map<string, (result: ExecuteResponse) => void>());
  const autoDisconnectTimer = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

  // Auto-disconnect after 30 minutes of inactivity
  const AUTO_DISCONNECT_TIME = 30 * 60 * 1000; // 30 minutes

  // Auto-disconnect timer functions
  const resetAutoDisconnectTimer = useCallback(() => {
    clearAutoDisconnectTimer();
    autoDisconnectTimer.current = setTimeout(() => {
      if (isConnected) {
        toast({
          title: "Auto-disconnect",
          description: "Disconnected due to inactivity (30 minutes)",
          variant: "destructive",
        });
        disconnectFromKernel();
      }
    }, AUTO_DISCONNECT_TIME);
  }, [isConnected]);

  const clearAutoDisconnectTimer = useCallback(() => {
    if (autoDisconnectTimer.current) {
      clearTimeout(autoDisconnectTimer.current);
      autoDisconnectTimer.current = null;
    }
  }, []);

  const updateActivity = useCallback(() => {
    setLastActivity(new Date());
    if (isConnected) {
      resetAutoDisconnectTimer();
    }
  }, [isConnected, resetAutoDisconnectTimer]);

  useEffect(() => {
    // Set up message handlers
    jupyterClient.onMessage((message) => {
      if (message.type === "kernel_status") {
        setKernelStatus(message.content.status);
      } else if (message.type === "kernel_info") {
        setKernelInfo(message.content);
      } else if (message.type === "kernel_started" || message.type === "kernel_restarted") {
        setIsKernelReady(true);
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
      setConnectionStatus('connected');
      setLastActivity(new Date());
      resetAutoDisconnectTimer();
      toast({
        title: "Connected",
        description: "Connected to Jupyter server",
      });
    });

    jupyterClient.onClose(() => {
      setIsConnected(false);
      setIsKernelReady(false);
      setConnectionStatus('disconnected');
      clearAutoDisconnectTimer();
      toast({
        title: "Disconnected",
        description: "Lost connection to Jupyter server",
        variant: "destructive",
      });
    });

    jupyterClient.onError(() => {
      setIsConnected(false);
      setIsKernelReady(false);
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
    // Already fully ready: nothing to do
    if (jupyterClient.isSocketConnected() && jupyterClient.isKernelActive()) {
      setConnectionStatus('connected');
      setIsKernelReady(true);
      return;
    }

    // If another caller is already connecting, wait for it to finish
    if (connectPromise) {
      await connectPromise;
      return;
    }

    try {
      connectPromise = (async () => {
        setConnectionStatus('connecting');
        await jupyterClient.connect();
        await jupyterClient.startKernel(kernelName);
        setIsKernelReady(true); // Ensure state is updated after await
        updateActivity();
      })();

      await connectPromise;
    } catch (error) {
      console.error("Failed to connect to kernel:", error);
      setConnectionStatus('disconnected');
      setIsKernelReady(false);
      toast({
        title: "Connection Failed",
        description: "Could not connect to Jupyter kernel",
        variant: "destructive",
      });
      throw error;
    } finally {
      connectPromise = null;
    }
  }, [toast, updateActivity]);

  const disconnectFromKernel = useCallback(() => {
    try {
      jupyterClient.disconnect();
      setConnectionStatus('disconnected');
      setIsKernelReady(false);
      clearAutoDisconnectTimer();
      toast({
        title: "Disconnected",
        description: "Manually disconnected from Jupyter server",
      });
    } catch (error) {
      console.error("Failed to disconnect:", error);
    }
  }, [clearAutoDisconnectTimer, toast]);

  const executeCode = useCallback(
    (code: string, cellId: string): Promise<ExecuteResponse> => {
      return new Promise(async (resolve, reject) => {
        // Lazy connection: auto-connect when executing if not connected
        if (!isConnected || !jupyterClient.isKernelActive()) {
          try {
            console.log('🔄 Auto-connecting to kernel for execution...');
            await connectToKernel();
          } catch (error) {
            reject(new Error("Failed to connect to kernel"));
            return;
          }
        }

        if (!jupyterClient.isKernelActive()) {
          reject(new Error("Kernel is not ready yet. Please wait a moment."));
          return;
        }

        // Update activity on code execution
        updateActivity();

        // Register callback for this execution
        executionCallbacks.current.set(cellId, resolve);

        // Send execute request
        jupyterClient.executeCode(code, cellId).catch((error) => {
          executionCallbacks.current.delete(cellId);
          reject(error);
        });

        // Set a timeout for execution (configurable, extended for long-running indexing)
        const timeout = EXECUTION_TIMEOUT_MS;
        setTimeout(() => {
          if (executionCallbacks.current.has(cellId)) {
            executionCallbacks.current.delete(cellId);
            // Attempt to interrupt to avoid orphaned execution
            try { jupyterClient.interruptKernel(); } catch { }
            console.warn(`[useJupyter] Execution timeout for cell ${cellId}; sent interrupt to kernel.`);

            // Send execution result with error
            const timeoutError: ExecuteResponse = {
              cellId,
              status: 'error',
              outputs: [{
                id: Math.random().toString(),
                output_type: 'error',
                traceback: ['Execution timed out. The kernel may be busy or not responding.']
              }]
            };
            resolve(timeoutError);
          }
        }, timeout);
      });
    },
    [isConnected, updateActivity, connectToKernel]
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
      setIsKernelReady(true); // Ensure state is updated
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
    isKernelReady,
    kernelStatus,
    kernelInfo,
    connectionStatus,
    lastActivity,
    connectToKernel,
    disconnectFromKernel,
    executeCode,
    interruptKernel,
    restartKernel,
  };
}
