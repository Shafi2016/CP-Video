import { JupyterMessage, ExecuteRequest } from "@/types";
import { getRuntimeConfig, loadRuntimeConfig } from "@/lib/runtime-config";

class JupyterClient {
  private socket: WebSocket | null = null;
  private messageHandlers: ((message: JupyterMessage) => void)[] = [];
  private openHandlers: (() => void)[] = [];
  private closeHandlers: (() => void)[] = [];
  private errorHandlers: ((error: Event) => void)[] = [];
  private connectionPromise: Promise<void> | null = null;
  private messageQueue: any[] = [];
  private kernelId: string | null = null;

  constructor() {
    this.connect = this.connect.bind(this);
    this.disconnect = this.disconnect.bind(this);
    this.sendMessage = this.sendMessage.bind(this);
    this.onMessage = this.onMessage.bind(this);
    this.onOpen = this.onOpen.bind(this);
    this.onClose = this.onClose.bind(this);
    this.onError = this.onError.bind(this);
    this.startKernel = this.startKernel.bind(this);
    this.executeCode = this.executeCode.bind(this);
    this.interruptKernel = this.interruptKernel.bind(this);
    this.restartKernel = this.restartKernel.bind(this);
  }

  connect(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      void loadRuntimeConfig();
      const configuredWsUrl =
        getRuntimeConfig().codePresenter?.wsUrl ||
        (import.meta.env.VITE_CODEPRESENTER_WS_URL as string | undefined);
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = configuredWsUrl || `${protocol}//${window.location.host}/ws`;

      console.log('[JupyterClient] Current host:', window.location.host);
      console.log('[JupyterClient] Using WebSocket URL:', wsUrl);
      console.log(`Connecting to WebSocket at ${wsUrl}`);
      this.socket = new WebSocket(wsUrl);

      // Set a connection timeout
      const connectionTimeout = setTimeout(() => {
        if (this.socket && this.socket.readyState !== WebSocket.OPEN) {
          console.error("WebSocket connection timeout");
          this.socket.close();
          this.socket = null;
          this.connectionPromise = null;
          reject(new Error("WebSocket connection timeout"));
        }
      }, 5000); // 5 second timeout

      this.socket.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log("WebSocket connection established");
        this.openHandlers.forEach((handler) => handler());

        // Process any messages that were queued
        this.messageQueue.forEach((msg) => this.sendMessage(msg));
        this.messageQueue = [];

        resolve();
      };

      this.socket.onclose = (event) => {
        clearTimeout(connectionTimeout);
        console.log("🔴 WebSocket connection closed", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
          kernelId: this.kernelId,
          timestamp: new Date().toISOString()
        });
        this.closeHandlers.forEach((handler) => handler());
        this.socket = null;
        this.connectionPromise = null;
        this.kernelId = null;

        if (event.wasClean) {
          console.log("🟢 Clean WebSocket close");
          resolve();
        } else {
          console.warn(`🟡 WebSocket connection closed unexpectedly: ${event.code}`);
          reject(new Error(`WebSocket closed unexpectedly (code ${event.code})`));
        }
      };

      this.socket.onerror = (event) => {
        clearTimeout(connectionTimeout);
        console.error("WebSocket error:", event);
        this.errorHandlers.forEach((handler) => handler(event));
        this.socket = null;
        this.connectionPromise = null;
        reject(new Error("WebSocket connection error"));
      };

      this.socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          // Special handling for heartbeat and connection messages
          if (message.type === "heartbeat") {
            console.log("💓 Heartbeat received from server", message.content);
            // Send heartbeat response if needed
            this.sendMessage({
              type: "heartbeat_response",
              content: { timestamp: new Date().toISOString() }
            });
            return; // Don't forward heartbeats to application
          } else if (message.type === "connection_ack") {
            console.log("👍 Connection acknowledged by server", message.content);
            // Don't need to forward this to application either
            return;
          } else {
            console.log("📥 Received message:", message);
          }

          // Update kernelId BEFORE calling handlers so isKernelActive() is
          // already true when startKernel()'s handler resolves the promise.
          if (message.type === "kernel_started" && message.content?.id) {
            this.kernelId = message.content.id;
            console.log("🆗 Kernel started with ID:", this.kernelId);
          }

          this.messageHandlers.forEach((handler) => handler(message));
        } catch (error) {
          console.error("❌ Error parsing WebSocket message:", error);
        }
      };
    });

    return this.connectionPromise;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
      this.connectionPromise = null;
    }
  }

  sendMessage(message: any): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      // Queue message if socket is not ready
      this.messageQueue.push(message);

      // Try to connect if not already connecting
      if (!this.connectionPromise) {
        this.connect().catch(console.error);
      }
    }
  }

  onMessage(handler: (message: JupyterMessage) => void): () => void {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
    };
  }

  onOpen(handler: () => void): () => void {
    this.openHandlers.push(handler);
    return () => {
      this.openHandlers = this.openHandlers.filter((h) => h !== handler);
    };
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.push(handler);
    return () => {
      this.closeHandlers = this.closeHandlers.filter((h) => h !== handler);
    };
  }

  onError(handler: (error: Event) => void): () => void {
    this.errorHandlers.push(handler);
    return () => {
      this.errorHandlers = this.errorHandlers.filter((h) => h !== handler);
    };
  }

  async startKernel(kernelName: string = "python3"): Promise<void> {
    await this.connect();

    this.sendMessage({
      type: "start_kernel",
      content: {
        kernel_name: kernelName,
      },
    });

    // Return a promise that resolves when kernel is started
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Kernel start timeout"));
      }, 30000);

      const handler = (message: JupyterMessage) => {
        if (message.type === "kernel_started") {
          cleanup();
          resolve();
        } else if (message.type === "kernel_error" || message.type === "error") {
          cleanup();
          reject(new Error(message.content?.error || "Failed to start kernel"));
        }
      };

      const unsubscribe = this.onMessage(handler);

      const cleanup = () => {
        clearTimeout(timeout);
        unsubscribe();
      };
    });
  }

  async executeCode(code: string, cellId: string): Promise<void> {
    if (!this.kernelId) {
      throw new Error("No active kernel");
    }

    const executeRequest: ExecuteRequest = {
      code,
      cellId,
    };

    this.sendMessage({
      type: "execute_request",
      content: executeRequest,
    });
  }

  async interruptKernel(): Promise<void> {
    if (!this.kernelId) {
      throw new Error("No active kernel");
    }

    this.sendMessage({
      type: "interrupt_kernel",
      content: {
        kernel_id: this.kernelId,
      },
    });
  }

  async restartKernel(): Promise<void> {
    if (!this.kernelId) {
      throw new Error("No active kernel");
    }

    this.sendMessage({
      type: "restart_kernel",
      content: {
        kernel_id: this.kernelId,
      },
    });

    // Return a promise that resolves when kernel is restarted
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Kernel restart timeout"));
      }, 30000);

      const handler = (message: JupyterMessage) => {
        if (message.type === "kernel_restarted") {
          cleanup();
          resolve();
        } else if (message.type === "kernel_error") {
          cleanup();
          reject(new Error(message.content?.error || "Failed to restart kernel"));
        }
      };

      const unsubscribe = this.onMessage(handler);

      const cleanup = () => {
        clearTimeout(timeout);
        unsubscribe();
      };
    });
  }

  isSocketConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  isKernelActive(): boolean {
    return this.kernelId !== null;
  }
}

export const jupyterClient = new JupyterClient();
