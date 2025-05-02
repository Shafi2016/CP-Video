/**
 * Direct integration with the Jupyter Kernel Gateway API
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';

const API_URL = 'http://localhost:8888';

export interface KernelInfo {
  id: string;
  name: string;
}

export class JupyterGateway {
  /**
   * List all available kernels on the gateway
   */
  async listKernels(): Promise<KernelInfo[]> {
    try {
      const response = await axios.get(`${API_URL}/api/kernels`);
      return response.data;
    } catch (error: any) {
      console.error('Error listing kernels:', error.message);
      throw new Error(`Failed to list kernels: ${error.message}`);
    }
  }

  /**
   * Start a new kernel
   */
  async startKernel(name: string = 'python3'): Promise<KernelInfo> {
    try {
      const response = await axios.post(`${API_URL}/api/kernels`, { name });
      return response.data;
    } catch (error: any) {
      console.error('Error starting kernel:', error.message);
      throw new Error(`Failed to start kernel: ${error.message}`);
    }
  }

  /**
   * Execute code on a specific kernel using proper WebSocket communication
   * 
   * This method creates a WebSocket connection to the kernel channels
   * and communicates directly with the kernel to execute code and receive outputs
   */
  async executeCode(kernelId: string, code: string, cellId: string): Promise<any> {
    // Create WebSocket URL for kernel channels
    const kernelUrl = `ws://localhost:8888/api/kernels/${kernelId}/channels`;
    
    return new Promise((resolve, reject) => {
      try {
        // Create a unique message ID and session for this execution
        const msgId = uuidv4();
        const sessionId = uuidv4();
        
        // Connect to kernel via WebSocket
        const ws = new WebSocket(kernelUrl);
        
        // Collect all outputs from the execution
        const outputs: any[] = [];
        let executionCount: number | null = null;
        let executionStatus = 'ok';
        
        // Set timeout for execution
        const timeoutId = setTimeout(() => {
          console.log(`WebSocket execution timeout for kernel ${kernelId}`);
          cleanup('Execution timed out');
        }, 30000); // 30 second timeout
        
        // Cleanup function to close WebSocket and resolve/reject promise
        const cleanup = (errorMsg?: string) => {
          clearTimeout(timeoutId);
          if (ws.readyState === WebSocket.OPEN) {
            ws.close();
          }
          
          if (errorMsg) {
            reject(new Error(errorMsg));
          } else {
            resolve({
              cellId,
              status: executionStatus,
              execution_count: executionCount,
              outputs: outputs.length > 0 ? outputs : [{
                output_type: 'stream',
                name: 'stdout',
                text: ['Code executed but produced no output']
              }]
            });
          }
        };
        
        // Handle WebSocket events
        ws.onopen = () => {
          console.log(`WebSocket connected to kernel ${kernelId}`);
          
          // Create execute request message
          const executeRequest = {
            header: {
              msg_id: msgId,
              username: 'user',
              session: sessionId,
              msg_type: 'execute_request',
              version: '5.2'
            },
            parent_header: {},
            metadata: {},
            content: {
              code,
              silent: false,
              store_history: true,
              user_expressions: {},
              allow_stdin: false,
              stop_on_error: true
            },
            channel: 'shell'
          };
          
          // Send execute request
          ws.send(JSON.stringify(executeRequest));
        };
        
        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            const msgType = message.header.msg_type;
            const content = message.content;
            
            // Handle different message types
            switch (msgType) {
              case 'status':
                if (content.execution_state === 'idle') {
                  // Kernel is idle, we're done processing messages
                  console.log('Kernel is idle, finishing execution');
                  cleanup();
                }
                break;
                
              case 'execute_input':
                executionCount = content.execution_count;
                break;
                
              case 'execute_reply':
                // Check execution status
                executionStatus = content.status;
                if (content.status === 'error') {
                  console.error('Execute reply error:', content);
                }
                break;
                
              case 'stream':
                outputs.push({
                  output_type: 'stream',
                  name: content.name, // stdout or stderr
                  text: content.text.split('\n')
                });
                break;
                
              case 'display_data':
              case 'execute_result':
                outputs.push({
                  output_type: msgType,
                  data: content.data,
                  metadata: content.metadata,
                  execution_count: content.execution_count
                });
                break;
                
              case 'error':
                executionStatus = 'error';
                outputs.push({
                  output_type: 'error',
                  ename: content.ename,
                  evalue: content.evalue,
                  traceback: content.traceback
                });
                break;
            }
          } catch (err) {
            console.error('Error processing WebSocket message:', err);
          }
        };
        
        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          cleanup(`WebSocket error: ${error}`);
        };
        
        ws.onclose = () => {
          console.log('WebSocket connection closed');
          // Only cleanup if not already done
          if (timeoutId) clearTimeout(timeoutId);
        };
        
      } catch (error: any) {
        console.error('Error setting up WebSocket connection:', error.message);
        reject(new Error(`Failed to execute code: ${error.message}`));
      }
    });
  }

  /**
   * Interrupt a kernel execution
   */
  async interruptKernel(kernelId: string): Promise<void> {
    try {
      await axios.post(`${API_URL}/api/kernels/${kernelId}/interrupt`);
    } catch (error: any) {
      console.error('Error interrupting kernel:', error.message);
      throw new Error(`Failed to interrupt kernel: ${error.message}`);
    }
  }

  /**
   * Restart a kernel
   */
  async restartKernel(kernelId: string): Promise<void> {
    try {
      await axios.post(`${API_URL}/api/kernels/${kernelId}/restart`);
    } catch (error: any) {
      console.error('Error restarting kernel:', error.message);
      throw new Error(`Failed to restart kernel: ${error.message}`);
    }
  }

  /**
   * Delete/shutdown a kernel
   */
  async deleteKernel(kernelId: string): Promise<void> {
    try {
      await axios.delete(`${API_URL}/api/kernels/${kernelId}`);
    } catch (error: any) {
      console.error('Error deleting kernel:', error.message);
      throw new Error(`Failed to delete kernel: ${error.message}`);
    }
  }
}

// Export a singleton instance
export const jupyterGateway = new JupyterGateway();
