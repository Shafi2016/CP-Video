/**
 * Direct integration with the Jupyter Kernel Gateway API
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

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
   * Execute code on a specific kernel
   */
  async executeCode(kernelId: string, code: string): Promise<any> {
    try {
      // Create a unique message ID for this execution
      const msgId = uuidv4();
      
      // Execute the code
      const response = await axios.post(
        `${API_URL}/api/kernels/${kernelId}/channels`,
        {
          header: {
            msg_id: msgId,
            username: 'user',
            session: uuidv4(),
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
          }
        }
      );
      
      return response.data;
    } catch (error: any) {
      console.error('Error executing code:', error.message);
      throw new Error(`Failed to execute code: ${error.message}`);
    }
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
