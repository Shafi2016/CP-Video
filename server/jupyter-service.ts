import { WebSocket } from "ws";
import { spawn, ChildProcess } from "child_process";
import { v4 as uuidv4 } from "uuid";

interface KernelProcess {
  id: string;
  process: ChildProcess;
  connection: WebSocket;
  executing: boolean;
}

export class JupyterService {
  private kernels: Map<string, KernelProcess> = new Map();
  private clients: Set<WebSocket> = new Set();

  constructor() {
    // Clean up any orphaned kernels when the service is destroyed
    process.on('exit', () => {
      for (const kernel of this.kernels.values()) {
        this.stopKernel(kernel.id);
      }
    });
  }

  registerClient(ws: WebSocket): () => void {
    this.clients.add(ws);
    
    // Return cleanup function
    return () => {
      this.clients.delete(ws);
      
      // Find any kernels associated with this connection and stop them
      for (const [id, kernel] of this.kernels.entries()) {
        if (kernel.connection === ws) {
          this.stopKernel(id);
        }
      }
    };
  }

  async handleMessage(message: any, ws: WebSocket): Promise<void> {
    console.log("Handling message:", message.type);
    
    switch (message.type) {
      case 'start_kernel':
        await this.startKernel(message.content?.kernel_name || 'python3', ws);
        break;
        
      case 'execute_request':
        await this.executeCode(message.content, ws);
        break;
        
      case 'interrupt_kernel':
        await this.interruptExecution(message.content?.kernel_id, ws);
        break;
        
      case 'restart_kernel':
        await this.restartKernel(message.content?.kernel_id, ws);
        break;
        
      case 'stop_kernel':
        await this.stopKernel(message.content?.kernel_id);
        break;
        
      default:
        this.sendError(ws, `Unknown message type: ${message.type}`);
    }
  }

  async startKernel(kernelName: string, ws: WebSocket): Promise<void> {
    try {
      // Generate a unique ID for this kernel
      const kernelId = uuidv4();
      
      // Start a Python process with ipykernel for Jupyter compatibility
      const process = spawn('python', [
        '-c',
        `
        import json
        import sys
        import traceback
        from ipykernel.kernelapp import IPKernelApp
        from io import StringIO

        class CaptureOutput:
            def __init__(self):
                self.value = []
            
            def write(self, data):
                self.value.append(data)
                return len(data)
            
            def flush(self):
                pass

        def execute_code(code):
            stdout_capture = CaptureOutput()
            stderr_capture = CaptureOutput()
            old_stdout, old_stderr = sys.stdout, sys.stderr
            sys.stdout, sys.stderr = stdout_capture, stderr_capture
            
            try:
                # Execute the code
                result = eval(compile(code, '<string>', 'exec'))
                status = "ok"
                error = None
                traceback_text = None
            except Exception as e:
                status = "error"
                error = str(e)
                traceback_text = traceback.format_exc()
                result = None
            finally:
                sys.stdout, sys.stderr = old_stdout, old_stderr
            
            return {
                "status": status,
                "stdout": ''.join(stdout_capture.value),
                "stderr": ''.join(stderr_capture.value),
                "result": result,
                "error": error,
                "traceback": traceback_text
            }

        # Monitor stdin for commands
        while True:
            try:
                command = input()
                command_data = json.loads(command)
                
                if command_data.get("type") == "execute":
                    code = command_data.get("code", "")
                    cell_id = command_data.get("cell_id", "")
                    
                    result = execute_code(code)
                    
                    # Send the result back
                    print(json.dumps({
                        "type": "result",
                        "cell_id": cell_id,
                        "status": result["status"],
                        "stdout": result["stdout"],
                        "stderr": result["stderr"],
                        "result": str(result["result"]) if result["result"] is not None else None,
                        "error": result["error"],
                        "traceback": result["traceback"]
                    }))
                    sys.stdout.flush()
                elif command_data.get("type") == "exit":
                    break
            except Exception as e:
                print(json.dumps({
                    "type": "error",
                    "error": str(e),
                    "traceback": traceback.format_exc()
                }))
                sys.stdout.flush()
        `
      ]);
      
      // Store the kernel process
      this.kernels.set(kernelId, {
        id: kernelId,
        process,
        connection: ws,
        executing: false
      });
      
      // Set up handlers for the process
      process.stdout.on('data', (data) => {
        try {
          const lines = data.toString().trim().split('\n');
          
          for (const line of lines) {
            if (!line.trim()) continue;
            
            const result = JSON.parse(line);
            
            if (result.type === 'result') {
              const outputs = [];
              
              // Handle stdout output
              if (result.stdout && result.stdout.trim()) {
                outputs.push({
                  id: uuidv4(),
                  output_type: 'stream',
                  name: 'stdout',
                  text: result.stdout.trim().split('\n')
                });
              }
              
              // Handle stderr output
              if (result.stderr && result.stderr.trim()) {
                outputs.push({
                  id: uuidv4(),
                  output_type: 'stream',
                  name: 'stderr',
                  text: result.stderr.trim().split('\n')
                });
              }
              
              // Handle execution result
              if (result.result && result.result !== 'None') {
                outputs.push({
                  id: uuidv4(),
                  output_type: 'execute_result',
                  execution_count: 1,
                  data: {
                    'text/plain': result.result
                  }
                });
              }
              
              // Handle errors
              if (result.status === 'error' && result.traceback) {
                outputs.push({
                  id: uuidv4(),
                  output_type: 'error',
                  traceback: result.traceback.split('\n')
                });
              }
              
              // Mark the kernel as no longer executing
              const kernel = this.kernels.get(kernelId);
              if (kernel) {
                kernel.executing = false;
              }
              
              // Send execution result to client
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'execute_result',
                  content: {
                    cellId: result.cell_id,
                    status: result.status,
                    execution_count: 1,
                    outputs
                  }
                }));
              }
            }
          }
        } catch (error) {
          console.error('Error processing kernel output:', error);
        }
      });
      
      process.stderr.on('data', (data) => {
        console.error(`Kernel error: ${data}`);
        
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'kernel_error',
            content: {
              error: data.toString()
            }
          }));
        }
      });
      
      process.on('close', (code) => {
        console.log(`Kernel process exited with code ${code}`);
        this.kernels.delete(kernelId);
        
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'kernel_died',
            content: {
              id: kernelId,
              code
            }
          }));
        }
      });
      
      // Send success response to client
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'kernel_started',
          content: {
            id: kernelId,
            name: kernelName,
            status: 'idle'
          }
        }));
      }
      
    } catch (error) {
      console.error('Error starting kernel:', error);
      this.sendError(ws, `Failed to start kernel: ${error.message}`);
    }
  }

  async executeCode(request: any, ws: WebSocket): Promise<void> {
    // Find an active kernel for this connection
    let kernelProcess: KernelProcess | undefined;
    let kernelId: string | undefined;
    
    for (const [id, kernel] of this.kernels.entries()) {
      if (kernel.connection === ws) {
        kernelProcess = kernel;
        kernelId = id;
        break;
      }
    }
    
    if (!kernelProcess || !kernelId) {
      return this.sendError(ws, 'No active kernel found');
    }
    
    if (kernelProcess.executing) {
      return this.sendError(ws, 'Kernel is already executing code');
    }
    
    try {
      // Mark the kernel as executing
      kernelProcess.executing = true;
      
      // Send kernel status update
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'kernel_status',
          content: {
            id: kernelId,
            status: 'busy'
          }
        }));
      }
      
      // Send the code to the kernel for execution
      kernelProcess.process.stdin.write(JSON.stringify({
        type: 'execute',
        code: request.code,
        cell_id: request.cellId
      }) + '\n');
      
    } catch (error) {
      console.error('Error executing code:', error);
      kernelProcess.executing = false;
      
      this.sendError(ws, `Failed to execute code: ${error.message}`);
      
      // Send kernel status update
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'kernel_status',
          content: {
            id: kernelId,
            status: 'idle'
          }
        }));
      }
    }
  }

  async interruptExecution(kernelId: string | undefined, ws: WebSocket): Promise<void> {
    if (!kernelId) {
      // Find an active kernel for this connection
      for (const [id, kernel] of this.kernels.entries()) {
        if (kernel.connection === ws) {
          kernelId = id;
          break;
        }
      }
    }
    
    if (!kernelId || !this.kernels.has(kernelId)) {
      return this.sendError(ws, 'No active kernel found');
    }
    
    try {
      const kernel = this.kernels.get(kernelId)!;
      
      // Send SIGINT to the process
      kernel.process.kill('SIGINT');
      
      // Mark the kernel as no longer executing
      kernel.executing = false;
      
      // Send kernel status update
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'kernel_status',
          content: {
            id: kernelId,
            status: 'idle'
          }
        }));
      }
      
    } catch (error) {
      console.error('Error interrupting kernel:', error);
      this.sendError(ws, `Failed to interrupt kernel: ${error.message}`);
    }
  }

  async restartKernel(kernelId: string | undefined, ws: WebSocket): Promise<void> {
    if (!kernelId) {
      // Find an active kernel for this connection
      for (const [id, kernel] of this.kernels.entries()) {
        if (kernel.connection === ws) {
          kernelId = id;
          break;
        }
      }
    }
    
    if (!kernelId || !this.kernels.has(kernelId)) {
      return this.sendError(ws, 'No active kernel found');
    }
    
    try {
      const kernel = this.kernels.get(kernelId)!;
      const kernelName = 'python3'; // Default to python3
      
      // Stop the current kernel
      await this.stopKernel(kernelId);
      
      // Start a new kernel
      await this.startKernel(kernelName, ws);
      
      // Send success message
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'kernel_restarted',
          content: {
            id: kernelId
          }
        }));
      }
      
    } catch (error) {
      console.error('Error restarting kernel:', error);
      this.sendError(ws, `Failed to restart kernel: ${error.message}`);
    }
  }

  async stopKernel(kernelId: string | undefined): Promise<void> {
    if (!kernelId || !this.kernels.has(kernelId)) {
      return;
    }
    
    try {
      const kernel = this.kernels.get(kernelId)!;
      
      // Send exit command to the kernel
      kernel.process.stdin.write(JSON.stringify({
        type: 'exit'
      }) + '\n');
      
      // Kill the process after a timeout if it hasn't exited
      setTimeout(() => {
        if (this.kernels.has(kernelId)) {
          kernel.process.kill();
          this.kernels.delete(kernelId);
        }
      }, 1000);
      
    } catch (error) {
      console.error('Error stopping kernel:', error);
      
      // Force kill the process
      try {
        const kernel = this.kernels.get(kernelId)!;
        kernel.process.kill();
      } catch (e) {
        // Ignore errors when killing
      }
      
      this.kernels.delete(kernelId);
    }
  }

  private sendError(ws: WebSocket, errorMessage: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'error',
        content: {
          error: errorMessage
        }
      }));
    }
  }
}
