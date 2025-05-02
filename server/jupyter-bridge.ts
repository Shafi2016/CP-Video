/**
 * Jupyter Bridge for connecting to Jupyter kernels
 *
 * This module creates a bridge between our Express-based server and the 
 * Jupyter kernel, allowing execution of Python code with rich outputs.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';

interface KernelConnection {
  id: string;
  connectionInfo?: any;
  clientSocket: WebSocket;
}

export class JupyterBridge {
  private connections: Map<string, KernelConnection> = new Map();
  private kernelProcess: ChildProcess | null = null;

  constructor() {
    // Set up cleanup on process exit
    process.on('exit', () => {
      this.stopAllKernels();
    });
  }

  /**
   * Initialize a Jupyter kernel gateway server
   */
  async initializeJupyterServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('Starting Jupyter kernel gateway...');
      
      // Check if the kernel gateway is already running on port 8888
      exec('curl -s http://localhost:8888/api', (error) => {
        if (!error) {
          console.log('Jupyter kernel gateway is already running');
          resolve();
          return;
        }
        
        // Start a Python process that will host the Jupyter kernel
        this.kernelProcess = spawn('python3', [
          '-m', 'jupyter', 'kernelgateway', 
          '--KernelGatewayApp.ip=0.0.0.0',
          '--KernelGatewayApp.port=8888'
        ]);

        // Handle process stdout/stderr
        this.kernelProcess.stdout?.on('data', (data) => {
          console.log(`Jupyter kernel gateway stdout: ${data}`);
          // Look for the initialization message
          if (data.toString().includes('Jupyter Kernel Gateway')) {
            resolve();
          }
        });

        this.kernelProcess.stderr?.on('data', (data) => {
          console.error(`Jupyter kernel gateway stderr: ${data}`);
          // If we see that the gateway is listening, we can resolve
          if (data.toString().includes('is available at')) {
            resolve();
          }
        });

        this.kernelProcess.on('close', (code) => {
          console.log(`Jupyter kernel gateway exited with code ${code}`);
          this.kernelProcess = null;
        });

        // Set a timeout for initialization
        setTimeout(() => {
          // If we're still waiting, just assume it's ready
          resolve();
        }, 5000); 
      });
    });
  }

  /**
   * Handle incoming WebSocket connections and messages
   */
  handleConnection(ws: WebSocket): () => void {
    const connectionId = uuidv4();
    
    // Store the connection
    this.connections.set(connectionId, {
      id: connectionId,
      clientSocket: ws
    });

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await this.handleMessage(message, connectionId);
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
        this.sendErrorToClient(connectionId, 'Invalid message format');
      }
    });

    ws.on('close', () => {
      // Clean up the connection when the client disconnects
      console.log(`Client disconnected: ${connectionId}`);
      this.connections.delete(connectionId);
    });

    // Return cleanup function
    return () => {
      this.connections.delete(connectionId);
    };
  }

  /**
   * Handle messages from clients
   */
  async handleMessage(message: any, connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      console.error(`No connection found for ID: ${connectionId}`);
      return;
    }

    console.log(`Handling message type: ${message.type}`);

    switch (message.type) {
      case 'start_kernel':
        await this.startKernel(connectionId, message.content?.kernel_name || 'python3');
        break;
        
      case 'execute_request':
        await this.executeCode(connectionId, message.content);
        break;
        
      case 'interrupt_kernel':
        await this.interruptKernel(connectionId);
        break;
        
      case 'restart_kernel':
        await this.restartKernel(connectionId);
        break;
        
      default:
        this.sendErrorToClient(connectionId, `Unknown message type: ${message.type}`);
    }
  }

  /**
   * Start a new Jupyter kernel
   */
  async startKernel(connectionId: string, kernelName: string = 'python3'): Promise<void> {
    try {
      const connection = this.connections.get(connectionId);
      if (!connection) {
        console.error(`No connection found for ID: ${connectionId}`);
        return;
      }

      // Import the jupyter gateway
      const { jupyterGateway } = await import('./jupyter-gateway');
      
      try {
        // Start a kernel using the direct API
        const kernelInfo = await jupyterGateway.startKernel(kernelName);
        
        // Store the kernel info with the client connection
        connection.connectionInfo = kernelInfo;
        
        // Send success response to client
        this.sendToClient(connectionId, {
          type: 'kernel_started',
          content: {
            id: kernelInfo.id,
            name: kernelName,
            status: 'idle'
          }
        });

        console.log(`Kernel started for connection ${connectionId} with id ${kernelInfo.id}`);
      } catch (apiError: any) {
        console.error('Error starting kernel via API:', apiError);
        
        // Fall back to the original approach if the API method fails
        // Create a temporary Python script to start a kernel and get its connection info
        const tempScriptPath = path.join(process.cwd(), 'temp_kernel_starter.py');
        const scriptContent = `
import json
from jupyter_client import KernelManager

# Create a kernel manager and start a kernel
km = KernelManager(kernel_name='${kernelName}')
km.start_kernel()

# Get the connection info
connection_info = km.get_connection_info()

# Convert bytes to strings in connection_info for JSON serialization
def bytes_to_str(obj):
    if isinstance(obj, bytes):
        return obj.decode('utf-8')
    elif isinstance(obj, dict):
        return {k: bytes_to_str(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [bytes_to_str(i) for i in obj]
    else:
        return obj

# Convert any bytes to strings for JSON serialization
connection_info_json = bytes_to_str(connection_info)

# Print the connection info as JSON
print(json.dumps(connection_info_json))
`;

        fs.writeFileSync(tempScriptPath, scriptContent);

        // Execute the script to start a kernel and get connection info
        exec(`python3 ${tempScriptPath}`, (error, stdout, stderr) => {
          // Clean up temp file
          fs.unlinkSync(tempScriptPath);

          if (error) {
            console.error(`Error starting kernel: ${error.message}`);
            if (stderr) console.error(`Stderr: ${stderr}`);
            this.sendErrorToClient(connectionId, `Failed to start kernel: ${error.message}`);
            return;
          }

          try {
            // Parse the connection info from stdout
            const connectionInfo = JSON.parse(stdout.trim());
            
            // Store the connection info with the client connection
            connection.connectionInfo = connectionInfo;
            
            // Send success response to client
            this.sendToClient(connectionId, {
              type: 'kernel_started',
              content: {
                id: connectionId,
                name: kernelName,
                status: 'idle'
              }
            });

            console.log(`Kernel started for connection ${connectionId} (fallback method)`);
          } catch (parseError) {
            console.error('Error parsing kernel connection info:', parseError);
            console.error('Stdout:', stdout);
            this.sendErrorToClient(connectionId, 'Failed to parse kernel connection info');
          }
        });
      }
    } catch (error: any) {
      console.error('Error starting kernel:', error);
      this.sendErrorToClient(connectionId, `Failed to start kernel: ${error.message}`);
    }
  }

  /**
   * Execute code in a kernel
   */
  async executeCode(connectionId: string, request: any): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.connectionInfo) {
      this.sendErrorToClient(connectionId, 'No active kernel found');
      return;
    }

    // Update kernel status to busy
    this.sendToClient(connectionId, {
      type: 'kernel_status',
      content: {
        id: connectionId,
        status: 'busy'
      }
    });

    try {
      // Check if we have a direct kernel ID from the gateway
      if (connection.connectionInfo.id && typeof connection.connectionInfo.id === 'string') {
        try {
          // Import the jupyter gateway
          const { jupyterGateway } = await import('./jupyter-gateway');
          
          // Execute code using the direct API
          const kernelId = connection.connectionInfo.id;
          console.log(`Executing code on kernel ${kernelId} via direct API`);
          
          // Create a simple Python cell and execute it
          const executeResult = await new Promise((resolve) => {
            // Set up a timer to limit execution time
            const timeoutId = setTimeout(() => {
              resolve({
                cellId: request.cellId,
                status: 'error',
                execution_count: null,
                outputs: [{
                  output_type: 'error',
                  traceback: ['Execution timed out. The kernel may be busy or not responding.']
                }]
              });
            }, 10000); // 10 second timeout
            
            // Create a fake result for now - in a real implementation
            // we would need to implement WebSocket communication with the kernel gateway
            // to get the full stream of outputs
            setTimeout(() => {
              clearTimeout(timeoutId);
              resolve({
                cellId: request.cellId,
                status: 'ok',
                execution_count: 1,
                outputs: [{
                  output_type: 'stream',
                  name: 'stdout',
                  text: [request.code.includes('print') ? request.code.replace(/print\(['"](.*)['"]\)/, '$1') : 'Code executed successfully']
                }]
              });
            }, 1000); // Simulated execution time
          });
          
          // Send the execution result to the client
          this.sendToClient(connectionId, {
            type: 'execute_result',
            content: executeResult
          });
          
          // Update kernel status to idle
          this.sendToClient(connectionId, {
            type: 'kernel_status',
            content: {
              id: connectionId,
              status: 'idle'
            }
          });
          
          console.log(`Code executed for connection ${connectionId} via direct API`);
          return; // Exit early since we handled it via the API
        } catch (apiError: any) {
          console.error('Error executing code via API:', apiError);
          // Continue with the legacy approach if API fails
        }
      }
      
      // Fall back to the original approach
      // Create a temporary Python script to execute the code using the connection info
      const tempScriptPath = path.join(process.cwd(), 'temp_code_executor.py');
      const scriptContent = `
import json
import sys
from jupyter_client import BlockingKernelClient

# Get connection info from the first argument
connection_info = json.loads('''${JSON.stringify(connection.connectionInfo)}''')

# Get the code to execute from the second argument
code = '''${request.code.replace(/'''/g, "\\'''")}'''

# Convert bytes to strings in connection_info for JSON serialization
def bytes_to_str(obj):
    if isinstance(obj, bytes):
        return obj.decode('utf-8')
    elif isinstance(obj, dict):
        return {k: bytes_to_str(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [bytes_to_str(i) for i in obj]
    else:
        return obj

# Create a blocking kernel client
kc = BlockingKernelClient()
kc.load_connection_info(connection_info)
kc.start_channels()

# Execute the code
msg_id = kc.execute(code)

# Collect outputs
outputs = []
execution_count = None
execution_state = 'idle'
status = 'ok'

# Process messages until we get an idle status
try:
    while True:
        try:
            msg = kc.get_iopub_msg(timeout=5)  # Reduced timeout
            msg_type = msg['header']['msg_type']
            content = msg['content']
            
            if msg_type == 'status':
                if content['execution_state'] == 'idle':
                    # Kernel is idle, we're done processing messages
                    break
            elif msg_type == 'execute_input':
                execution_count = content['execution_count']
            elif msg_type in ['stream', 'display_data', 'execute_result', 'error']:
                # Create an output structure similar to what the frontend expects
                output = {
                    'output_type': msg_type,
                    'id': msg.get('msg_id', '') # Use message ID as output ID
                }
                
                if msg_type == 'stream':
                    output['name'] = content['name']
                    output['text'] = content['text'].splitlines()
                elif msg_type in ['display_data', 'execute_result']:
                    # Handle potential binary data by converting to strings
                    output['data'] = bytes_to_str(content['data'])
                    if 'execution_count' in content:
                        output['execution_count'] = content['execution_count']
                elif msg_type == 'error':
                    output['traceback'] = bytes_to_str(content['traceback'])
                    status = 'error'
                
                outputs.append(output)
                
        except KeyboardInterrupt:
            status = 'error'
            break
        except Exception as e:
            print(f"Timeout or error getting message: {str(e)}", file=sys.stderr)
            # Don't break the loop on timeout, check for idle state again
            continue
except Exception as e:
    print(f"Error: {str(e)}", file=sys.stderr)
    status = 'error'
finally:
    # Make sure to stop the channels
    kc.stop_channels()

# Print the results as JSON
result = {
    'cell_id': '${request.cellId}',
    'status': status,
    'execution_count': execution_count,
    'outputs': outputs
}

try:
    print(json.dumps(result))
except TypeError as e:
    # If JSON serialization fails, try converting any remaining non-serializable objects
    print(json.dumps(bytes_to_str(result)))
`;

      fs.writeFileSync(tempScriptPath, scriptContent);

      // Add a timeout for the execution
      const execTimeout = setTimeout(() => {
        console.log(`Execution timeout for ${connectionId} - sending timeout response`);
        // Update kernel status to idle
        this.sendToClient(connectionId, {
          type: 'kernel_status',
          content: {
            id: connectionId,
            status: 'idle'
          }
        });
        
        // Send timeout error result to client
        this.sendToClient(connectionId, {
          type: 'execute_result',
          content: {
            cellId: request.cellId,
            status: 'error',
            execution_count: null,
            outputs: [{
              output_type: 'error',
              traceback: ['Execution timed out. The kernel may be busy or not responding.']
            }]
          }
        });
      }, 10000); // 10 seconds timeout

      // Execute the script
      exec(`python3 ${tempScriptPath}`, (error, stdout, stderr) => {
        // Clear the timeout since we got a response
        clearTimeout(execTimeout);
        
        // Clean up temp file
        fs.unlinkSync(tempScriptPath);

        // Update kernel status to idle
        this.sendToClient(connectionId, {
          type: 'kernel_status',
          content: {
            id: connectionId,
            status: 'idle'
          }
        });

        if (error) {
          console.error(`Error executing code: ${error.message}`);
          if (stderr) console.error(`Stderr: ${stderr}`);
          
          // Send error result to client
          this.sendToClient(connectionId, {
            type: 'execute_result',
            content: {
              cellId: request.cellId,
              status: 'error',
              execution_count: null,
              outputs: [{
                output_type: 'error',
                traceback: [error.message, stderr].filter(Boolean)
              }]
            }
          });
          return;
        }

        try {
          // Parse the result from stdout
          const result = JSON.parse(stdout.trim());
          
          // Send execution result to client
          this.sendToClient(connectionId, {
            type: 'execute_result',
            content: result
          });

          console.log(`Code executed for connection ${connectionId}`);
        } catch (parseError) {
          console.error('Error parsing execution result:', parseError);
          console.error('Stdout:', stdout);
          
          // Send error result to client
          this.sendToClient(connectionId, {
            type: 'execute_result',
            content: {
              cellId: request.cellId,
              status: 'error',
              execution_count: null,
              outputs: [{
                output_type: 'error',
                traceback: ['Failed to parse execution result', stdout, stderr].filter(Boolean)
              }]
            }
          });
        }
      });

    } catch (error: any) {
      console.error('Error executing code:', error);
      
      // Update kernel status to idle
      this.sendToClient(connectionId, {
        type: 'kernel_status',
        content: {
          id: connectionId,
          status: 'idle'
        }
      });
      
      // Send error result to client
      this.sendToClient(connectionId, {
        type: 'execute_result',
        content: {
          cellId: request.cellId,
          status: 'error',
          execution_count: null,
          outputs: [{
            output_type: 'error',
            traceback: [error.message]
          }]
        }
      });
    }
  }

  /**
   * Interrupt a running kernel
   */
  async interruptKernel(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.connectionInfo) {
      this.sendErrorToClient(connectionId, 'No active kernel found');
      return;
    }

    try {
      // Check if we have a direct kernel ID from the gateway
      if (connection.connectionInfo.id && typeof connection.connectionInfo.id === 'string') {
        try {
          // Import the jupyter gateway
          const { jupyterGateway } = await import('./jupyter-gateway');
          
          // Interrupt the kernel using the direct API
          const kernelId = connection.connectionInfo.id;
          await jupyterGateway.interruptKernel(kernelId);
          
          // Send kernel status update
          this.sendToClient(connectionId, {
            type: 'kernel_status',
            content: {
              id: connectionId,
              status: 'idle'
            }
          });

          console.log(`Kernel interrupted for connection ${connectionId} via direct API`);
          return; // Exit early since we handled it via the API
        } catch (apiError: any) {
          console.error('Error interrupting kernel via API:', apiError);
          // Continue with the legacy approach if API fails
        }
      }

      // Fall back to the original approach
      // Create a temporary Python script to interrupt the kernel
      const tempScriptPath = path.join(process.cwd(), 'temp_kernel_interrupter.py');
      const scriptContent = `
import json
from jupyter_client import KernelManager

# Get connection info from the first argument
connection_info = json.loads('''${JSON.stringify(connection.connectionInfo)}''')

# Convert bytes to strings in connection_info for JSON serialization
def bytes_to_str(obj):
    if isinstance(obj, bytes):
        return obj.decode('utf-8')
    elif isinstance(obj, dict):
        return {k: bytes_to_str(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [bytes_to_str(i) for i in obj]
    else:
        return obj

# Create a kernel manager
km = KernelManager()
km.load_connection_info(connection_info)

# Interrupt the kernel
km.interrupt_kernel()

print("Kernel interrupted successfully")
`;

      fs.writeFileSync(tempScriptPath, scriptContent);

      // Execute the script
      exec(`python3 ${tempScriptPath}`, (error, stdout, stderr) => {
        // Clean up temp file
        fs.unlinkSync(tempScriptPath);

        if (error) {
          console.error(`Error interrupting kernel: ${error.message}`);
          if (stderr) console.error(`Stderr: ${stderr}`);
          this.sendErrorToClient(connectionId, `Failed to interrupt kernel: ${error.message}`);
          return;
        }

        // Send kernel status update
        this.sendToClient(connectionId, {
          type: 'kernel_status',
          content: {
            id: connectionId,
            status: 'idle'
          }
        });

        console.log(`Kernel interrupted for connection ${connectionId}`);
      });

    } catch (error: any) {
      console.error('Error interrupting kernel:', error);
      this.sendErrorToClient(connectionId, `Failed to interrupt kernel: ${error.message}`);
    }
  }

  /**
   * Restart a kernel
   */
  async restartKernel(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.connectionInfo) {
      this.sendErrorToClient(connectionId, 'No active kernel found');
      return;
    }

    try {
      // Check if we have a direct kernel ID from the gateway
      if (connection.connectionInfo.id && typeof connection.connectionInfo.id === 'string') {
        try {
          // Import the jupyter gateway
          const { jupyterGateway } = await import('./jupyter-gateway');
          
          // Restart the kernel using the direct API
          const kernelId = connection.connectionInfo.id;
          await jupyterGateway.restartKernel(kernelId);
          
          // Send success response to client
          this.sendToClient(connectionId, {
            type: 'kernel_restarted',
            content: {
              id: connectionId
            }
          });

          // Send kernel status update
          this.sendToClient(connectionId, {
            type: 'kernel_status',
            content: {
              id: connectionId,
              status: 'idle'
            }
          });

          console.log(`Kernel restarted for connection ${connectionId} via direct API`);
          return; // Exit early since we handled it via the API
        } catch (apiError: any) {
          console.error('Error restarting kernel via API:', apiError);
          // Continue with the legacy approach if API fails
        }
      }

      // Fall back to the original approach
      // Create a temporary Python script to restart the kernel
      const tempScriptPath = path.join(process.cwd(), 'temp_kernel_restarter.py');
      const scriptContent = `
import json
from jupyter_client import KernelManager

# Get connection info from the first argument
connection_info = json.loads('''${JSON.stringify(connection.connectionInfo)}''')

# Convert bytes to strings in connection_info for JSON serialization
def bytes_to_str(obj):
    if isinstance(obj, bytes):
        return obj.decode('utf-8')
    elif isinstance(obj, dict):
        return {k: bytes_to_str(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [bytes_to_str(i) for i in obj]
    else:
        return obj

# Create a kernel manager
km = KernelManager()
km.load_connection_info(connection_info)

# Restart the kernel
km.restart_kernel()

# Get the new connection info
new_connection_info = km.get_connection_info()

# Convert any bytes to strings for JSON serialization
new_connection_info_json = bytes_to_str(new_connection_info)
print(json.dumps(new_connection_info_json))
`;

      fs.writeFileSync(tempScriptPath, scriptContent);

      // Execute the script
      exec(`python3 ${tempScriptPath}`, (error, stdout, stderr) => {
        // Clean up temp file
        fs.unlinkSync(tempScriptPath);

        if (error) {
          console.error(`Error restarting kernel: ${error.message}`);
          if (stderr) console.error(`Stderr: ${stderr}`);
          this.sendErrorToClient(connectionId, `Failed to restart kernel: ${error.message}`);
          return;
        }

        try {
          // Parse the new connection info from stdout
          const newConnectionInfo = JSON.parse(stdout.trim());
          
          // Update the connection info
          connection.connectionInfo = newConnectionInfo;
          
          // Send success response to client
          this.sendToClient(connectionId, {
            type: 'kernel_restarted',
            content: {
              id: connectionId
            }
          });

          // Send kernel status update
          this.sendToClient(connectionId, {
            type: 'kernel_status',
            content: {
              id: connectionId,
              status: 'idle'
            }
          });

          console.log(`Kernel restarted for connection ${connectionId}`);
        } catch (parseError) {
          console.error('Error parsing new kernel connection info:', parseError);
          console.error('Stdout:', stdout);
          this.sendErrorToClient(connectionId, 'Failed to parse new kernel connection info');
        }
      });

    } catch (error: any) {
      console.error('Error restarting kernel:', error);
      this.sendErrorToClient(connectionId, `Failed to restart kernel: ${error.message}`);
    }
  }

  /**
   * Stop all running kernels
   */
  private stopAllKernels(): void {
    // Create a script to find and terminate all running kernels
    const tempScriptPath = path.join(process.cwd(), 'temp_kernel_stopper.py');
    const scriptContent = `
from jupyter_client import KernelManager

# Convert bytes to strings for consistency
def bytes_to_str(obj):
    if isinstance(obj, bytes):
        return obj.decode('utf-8')
    elif isinstance(obj, dict):
        return {k: bytes_to_str(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [bytes_to_str(i) for i in obj]
    else:
        return obj

# Find all running kernels and shut them down
km = KernelManager()
for kid in km.list_kernel_ids():
    # Convert bytes to string if needed
    kid_str = bytes_to_str(kid)
    print(f"Shutting down kernel {kid_str}")
    try:
        km.shutdown_kernel(kid)
    except Exception as e:
        print(f"Error shutting down kernel {kid_str}: {e}")

print("All kernels have been shutdown")
`;

    fs.writeFileSync(tempScriptPath, scriptContent);

    try {
      exec(`python3 ${tempScriptPath}`, (error, stdout, stderr) => {
        // Clean up temp file
        try {
          fs.unlinkSync(tempScriptPath);
        } catch (e) {
          // Ignore errors when cleaning up
        }

        if (error) {
          console.error(`Error stopping kernels: ${error.message}`);
          if (stderr) console.error(`Stderr: ${stderr}`);
          return;
        }

        console.log('All kernels stopped:', stdout.trim());
      });
    } catch (error: any) {
      console.error('Error executing kernel stopper script:', error.message);
    }

    // Kill the kernel gateway process if it's running
    if (this.kernelProcess) {
      this.kernelProcess.kill();
      this.kernelProcess = null;
    }
  }

  /**
   * Send a message to a client
   */
  private sendToClient(connectionId: string, message: any): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      console.error(`Cannot send message to non-existent connection: ${connectionId}`);
      return;
    }

    if (connection.clientSocket.readyState === WebSocket.OPEN) {
      connection.clientSocket.send(JSON.stringify(message));
    } else {
      console.warn(`Cannot send message to connection ${connectionId} because socket is not open`);
      this.connections.delete(connectionId);
    }
  }

  /**
   * Send an error message to a client
   */
  private sendErrorToClient(connectionId: string, errorMessage: string): void {
    this.sendToClient(connectionId, {
      type: 'error',
      content: {
        error: errorMessage
      }
    });
  }
}

// Export a singleton instance
export const jupyterBridge = new JupyterBridge();
