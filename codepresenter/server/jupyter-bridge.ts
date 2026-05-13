/**
 * Jupyter Bridge for connecting to Jupyter kernels
 *
 * This module creates a bridge between our Express-based server and the 
 * Jupyter kernel, allowing execution of Python code with rich outputs.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { exec, execFile, spawn, ChildProcess } from 'child_process';

// Import Python utility functions for consistent environment handling
import { PYTHON_EXECUTABLE, DEFAULT_KERNEL_NAME } from './python-utils';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

// Configurable timeouts with sensible defaults
// Overall execution timeout (ms)
const EXECUTION_TIMEOUT_MS = Number(process.env.EXECUTION_TIMEOUT_MS || 60 * 60 * 1000); // 60 minutes
// Subprocess timeout (ms) - slightly less than EXECUTION_TIMEOUT_MS
const SUBPROCESS_TIMEOUT_MS = Number(process.env.SUBPROCESS_TIMEOUT_MS || Math.max(0, EXECUTION_TIMEOUT_MS - 30_000));
// Per-message idle timeout in the kernel IOPub channel (seconds)
const IOPUB_MESSAGE_TIMEOUT_SEC = Number(process.env.IOPUB_MESSAGE_TIMEOUT_SEC || 900); // 15 minutes
// Network operation timeout for tools like WebSearchTool (seconds)
const NETWORK_TOOL_TIMEOUT_SEC = Number(process.env.NETWORK_TOOL_TIMEOUT_SEC || 1800); // 30 minutes

function getLocalJupyterPaths() {
  const runtimeDir = path.join(process.cwd(), 'temp', 'jupyter-runtime');
  const dataDir = path.join(process.cwd(), 'temp', 'jupyter-data');
  const configDir = path.join(process.cwd(), 'temp', 'jupyter-config');
  const pythonUserBaseDir = path.join(process.cwd(), 'temp', 'python-user');
  const ipythonDir = path.join(process.cwd(), 'temp', 'ipython');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(pythonUserBaseDir, { recursive: true });
  fs.mkdirSync(ipythonDir, { recursive: true });

  return { runtimeDir, dataDir, configDir, pythonUserBaseDir, ipythonDir };
}

function getLocalJupyterEnv(): NodeJS.ProcessEnv {
  const { runtimeDir, dataDir, configDir, pythonUserBaseDir, ipythonDir } = getLocalJupyterPaths();

  return {
    ...process.env,
    JUPYTER_RUNTIME_DIR: runtimeDir,
    JUPYTER_DATA_DIR: dataDir,
    JUPYTER_CONFIG_DIR: configDir,
    PYTHONUSERBASE: pythonUserBaseDir,
    IPYTHONDIR: ipythonDir,
  };
}

function createCookieSecretFile(): string {
  const { runtimeDir } = getLocalJupyterPaths();
  const cookieSecretFile = path.join(
    runtimeDir,
    `jupyter_cookie_secret_${process.pid}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  );
  fs.writeFileSync(cookieSecretFile, crypto.randomBytes(32), { flag: 'wx' });
  return cookieSecretFile;
}

async function canImportPythonModule(pythonCmd: string, moduleName: string, timeoutMs: number = 30000): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(`[Python probe] Checking module '${moduleName}' with: ${pythonCmd} (timeout: ${timeoutMs}ms)`);
    // Use execFile to avoid Windows cmd.exe double-quote mangling issues
    execFile(pythonCmd, ['-c', `import ${moduleName}; print('OK')`], { timeout: timeoutMs, env: getLocalJupyterEnv() }, (error, stdout, stderr) => {
      if (error) {
        console.warn(`[Python probe] FAILED to import ${moduleName}: ${stderr || error.message}`);
        resolve(false);
      } else {
        console.log(`[Python probe] OK – ${moduleName} available (${pythonCmd})`);
        resolve(true);
      }
    });
  });
}

// Module-level promise to prevent concurrent startKernelGateway calls from
// spawning competing gateway processes on the same port (race between pre-warm
// and first user request).
let _kgStartupPromise: Promise<void> | null = null;

 function isWindowsApplicationControlBlock(value: unknown): boolean {
   const message = String(value ?? '').toLowerCase();
   return message.includes('application control policy has blocked this file') ||
     message.includes('smart app control has blocked') ||
     message.includes('winerror 4551');
 }

 function formatKernelGatewayLaunchError(pythonCmd: string, value: unknown): Error {
   const message = String(value ?? '').trim();
   if (isWindowsApplicationControlBlock(message)) {
     return new Error(
       `Windows Application Control blocked Jupyter Kernel Gateway while using ${pythonCmd}. ` +
       `The launcher now uses the direct kernel_gateway module entrypoint, so this system still needs a Windows security allow/exception for the blocked Jupyter/Python component.`
     );
   }
   return new Error(message || `Failed to launch Jupyter Kernel Gateway using ${pythonCmd}`);
 }

 function buildKernelGatewayArgs(port: number, token: string, cookieSecretFile: string = createCookieSecretFile()): string[] {
   const args = [
     '-m', 'kernel_gateway',
     `--KernelGatewayApp.ip=127.0.0.1`,
     `--KernelGatewayApp.port=${port}`,
     `--KernelGatewayApp.api=kernel_gateway.jupyter_websocket`,
     `--KernelGatewayApp.allow_origin=*`,
     `--KernelGatewayApp.allow_credentials=True`,
     `--KernelGatewayApp.cookie_secret_file=${cookieSecretFile}`
   ];

   if (token) {
     args.push(`--KernelGatewayApp.auth_token=${token}`);
   }

   return args;
 }

// Launcher for Jupyter Kernel Gateway that waits for it to be ready.
// Binds to 127.0.0.1 and logs errors without throwing.
export async function startKernelGateway(): Promise<void> {
  // If a startup is already in progress, wait for it instead of spawning a second process
  if (_kgStartupPromise) {
    console.log('⏳ Kernel Gateway startup already in progress, waiting...');
    return _kgStartupPromise;
  }

  _kgStartupPromise = _doStartKernelGateway();
  try {
    await _kgStartupPromise;
  } finally {
    _kgStartupPromise = null;
  }
}

async function _doStartKernelGateway(): Promise<void> {
  const JUPYTER_PORT = Number(process.env.JUPYTER_PORT || 8888);
  const JUPYTER_TOKEN = process.env.JUPYTER_TOKEN || '';
  const JUPYTER_URL = `http://127.0.0.1:${JUPYTER_PORT}`;

  // First, check if a gateway is already running on this port
  // Use more attempts (5 × 1s) to allow for a gateway that was just spawned
  const isAlreadyRunning = await checkGatewayReady(JUPYTER_URL, JUPYTER_TOKEN, 5, 1000);
  if (isAlreadyRunning) {
    console.log(`✅ Jupyter Kernel Gateway already running on port ${JUPYTER_PORT}`);
    return;
  }

  try {
    // Use the consistent Python executable from python-utils
    const pythonCmd = PYTHON_EXECUTABLE;
    console.log(`🐍 Resolved PYTHON_EXECUTABLE: ${pythonCmd}`);

    // Retry the probe with increasing timeouts — Anaconda on Windows can be very slow to cold-start
    const probeTimeouts = [30000, 45000, 60000, 90000]; // 30s, 45s, 60s, 90s
    let hasJupyter = false;
    for (let attempt = 0; attempt < probeTimeouts.length; attempt++) {
      const timeout = probeTimeouts[attempt];
      console.log(`🔍 Probe attempt ${attempt + 1}/${probeTimeouts.length} (timeout: ${timeout}ms)...`);
      hasJupyter = await canImportPythonModule(pythonCmd, 'kernel_gateway', timeout);
      if (hasJupyter) break;
      if (attempt < probeTimeouts.length - 1) {
        console.log(`⏳ Retrying probe in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    if (!hasJupyter) {
      throw new Error(
        `Selected Python executable does not have Jupyter installed: ${pythonCmd}. ` +
        `Install with: "${pythonCmd}" -m pip install jupyter jupyter-kernel-gateway jupyter-client ipykernel`
      );
    }

    const args = buildKernelGatewayArgs(JUPYTER_PORT, JUPYTER_TOKEN);
    let launchError: Error | null = null;

    console.log(`🚀 Starting Jupyter Kernel Gateway on port ${JUPYTER_PORT}...`);
    const child = spawn(pythonCmd, args, {
      stdio: 'pipe',
      env: {
        ...getLocalJupyterEnv(),
        KG_ALLOW_ORIGIN: '*',
        KG_ALLOW_CREDENTIALS: 'True',
        ...(JUPYTER_TOKEN ? { KG_AUTH_TOKEN: JUPYTER_TOKEN } : {}),
        // Additional environment variables for CORS
        JUPYTER_ALLOW_ORIGIN: '*',
        JUPYTER_ALLOW_ORIGIN_PAT: '.*',
        JUPYTER_DISABLE_CHECK_XSRF: 'True'
      }
    });
    child.stdout?.on('data', (d) => console.log(`[KG] ${String(d).trim()}`));
    child.stderr?.on('data', (d) => {
      const message = String(d).trim();
      console.warn(`[KG!] ${message}`);
      if (!launchError && isWindowsApplicationControlBlock(message)) {
        launchError = formatKernelGatewayLaunchError(pythonCmd, message);
      }
    });
    child.on('error', (e) => {
      launchError = launchError || formatKernelGatewayLaunchError(pythonCmd, e?.message || e);
      console.warn('⚠️ kernelgateway spawn error:', e.message);
    });
    child.on('exit', (code) => {
      if (code && !launchError) {
        launchError = new Error(`Jupyter Kernel Gateway exited with code ${code}`);
      }
      console.warn('⚠️ kernelgateway exited:', code);
    });

    // Wait for the gateway to become ready (up to 30 seconds)
    const ready = await checkGatewayReady(JUPYTER_URL, JUPYTER_TOKEN, 30, 1000);
    if (ready) {
      console.log(`✅ Jupyter Kernel Gateway is ready on port ${JUPYTER_PORT}`);
    } else if (launchError) {
      throw launchError;
    } else {
      throw new Error(`Jupyter Kernel Gateway did not become ready on port ${JUPYTER_PORT} (timeout waiting for /api)`);
    }
  } catch (e: any) {
    console.warn('⚠️ Failed to start kernelgateway:', e?.message || e);
    throw e;
  }
}

/**
 * Check if the Jupyter Kernel Gateway is ready by polling /api endpoint
 */
async function checkGatewayReady(baseUrl: string, token: string, maxAttempts: number, intervalMs: number): Promise<boolean> {
  const axios = (await import('axios')).default;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const url = token ? `${baseUrl}/api?token=${encodeURIComponent(token)}` : `${baseUrl}/api`;
      const response = await axios.get(url, { timeout: 2000 });
      if (response.status === 200) {
        return true;
      }
    } catch {
      // Gateway not ready yet
    }
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
  return false;
}

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
   * Enhanced detection for network-dependent operations
   */
  private hasNetworkOperations(code: string): boolean {
    const networkPatterns = [
      /WebSearchTool/i,
      /requests\./,
      /urllib/,
      /httpx/,
      /aiohttp/,
      /fetch\(/,
      /axios/,
      /\.get\(/,
      /\.post\(/,
      /\.request\(/,
      /search.*web/i,
      /web.*search/i,
      /from agents import/i,
      /WebSearchTool/i,
      /Runner\.run_sync/i,
      /Runner\.run\b/i,
      // Add patterns for your specific use case
      /Agent\(/i,
      /Runner\.run/i,
      /gpt-[0-9]/i,
      /openai/i,
      /claude/i,
      /model.*=.*["\']gpt/i,
      // Common API patterns
      /api.*call/i,
      /await.*api/i,
      /\.run\(/i,
      /async.*def/i,
      // LlamaIndex / embedding workloads (make many API calls)
      /VectorStoreIndex/i,
      /from_documents/i,
      /llama_index/i,
      /StorageContext/i,
      /SimpleDirectoryReader/i,
      /OpenAIEmbedding/i,
      /embed_model/i,
    ];

    // Also check for async patterns which often involve network calls
    const hasAsync = /await\s+\w+/i.test(code) || /async\s+def/i.test(code);
    const hasModelCall = /model.*=.*["\'][^"\']*["\']/.test(code);

    // Check for immediate workaround flag
    const hasForceFlag = code.includes("os.environ['FORCE_NETWORK_TIMEOUT']") ||
      code.includes('FORCE_NETWORK_TIMEOUT');

    return networkPatterns.some(pattern => pattern.test(code)) ||
      (hasAsync && hasModelCall) ||
      hasForceFlag;
  }

  /**
   * Normalize IPython/Colab-style code to work reliably in Jupyter.
   * - Converts lines starting with "%pip " or "!pip " into Python subprocess calls
   * - Wraps top-level await calls in async functions (like Colab does)
   * - Keeps other lines unchanged
   */
  private normalizeMagics(code: string): string {
    try {
      // Transport-level rewrite: intelligently convert any *_sync calls to awaited async equivalents
      let rewritten = code;

      // Enhanced agent isolation when agent code is detected to prevent cross-execution contamination
      const hasAgentCode = /from agents import|Agent\(|WebSearchTool|Runner\.run_sync|Runner\.run/i.test(rewritten);
      if (hasAgentCode) {
        // Generate unique session ID for this execution
        const sessionId = Math.random().toString(36).substring(7);

        // Inject session uniqueness into agent creation
        rewritten = rewritten.replace(
          /Agent\s*\(\s*name\s*=\s*["']([^"']+)["']/g,
          `Agent(name="${sessionId}_$1"`
        );

        const stateClearingPrefix = [
          '# Complete agent isolation - prevent cross-execution contamination',
          'import gc',
          'import sys',
          'import os',
          '',
          '# Force complete module reload to clear internal caches',
          'modules_to_reload = []',
          'for module_name in list(sys.modules.keys()):',
          '    if any(x in module_name.lower() for x in ["agents", "phidata", "openai", "search"]):',
          '        modules_to_reload.append(module_name)',
          '',
          'for module_name in modules_to_reload:',
          '    try:',
          '        del sys.modules[module_name]',
          '    except:',
          '        pass',
          '',
          '# Clear all variables that might hold agent state',
          'vars_to_clear = []',
          'for var_name in list(globals().keys()):',
          '    if any(x in var_name.lower() for x in ["agent", "runner", "result", "web", "search", "response"]):',
          '        vars_to_clear.append(var_name)',
          '',
          'for var_name in vars_to_clear:',
          '    try:',
          '        del globals()[var_name]',
          '    except:',
          '        pass',
          '',
          '# Clear potential environment caches',
          'for key in list(os.environ.keys()):',
          '    if any(x in key.upper() for x in ["CACHE", "AGENT", "SEARCH", "RESULT"]):',
          '        try:',
          '            del os.environ[key]',
          '        except:',
          '            pass',
          '',
          '# Force garbage collection',
          'gc.collect()',
          '',
          '# Add unique session marker to force fresh execution',
          'import uuid',
          `_session_id = "${sessionId}"`,
          'os.environ["AGENT_SESSION_ID"] = _session_id',
          '',
        ].join('\n');
        rewritten = stateClearingPrefix + '\n' + rewritten;
      }
      // Pattern 1: object.method_sync(args).chained...
      rewritten = rewritten.replace(
        /(\w+(?:\.\w+)*\.)(\w+_sync)\s*(\([^)]*\))((?:\.[a-zA-Z_][a-zA-Z0-9_]*(?:\([^)]*\))?)*)/g,
        (_match, objectPath, methodName, args, chainedPart) => {
          const asyncMethodName = String(methodName).replace(/_sync$/, '');
          return chainedPart && chainedPart.length > 0
            ? `(await ${objectPath}${asyncMethodName}${args})${chainedPart}`
            : `await ${objectPath}${asyncMethodName}${args}`;
        }
      );
      // Pattern 2: function_sync(args).chained...
      rewritten = rewritten.replace(
        /(\b\w+_sync)\s*(\([^)]*\))((?:\.[a-zA-Z_][a-zA-Z0-9_]*(?:\([^)]*\))?)*)/g,
        (_match, functionName, args, chainedPart) => {
          const asyncFunctionName = String(functionName).replace(/_sync$/, '');
          return chainedPart && chainedPart.length > 0
            ? `(await ${asyncFunctionName}${args})${chainedPart}`
            : `await ${asyncFunctionName}${args}`;
        }
      );
      const didRewrite = rewritten !== code;
      code = rewritten;
      const lines = code.split('\n');
      const out: string[] = [];
      // If we rewrote to 'await', force async wrapper
      let hasTopLevelAwait = didRewrite;

      for (const raw of lines) {
        const line = raw.trim();
        const isPipMagic = line.startsWith('%pip ') || line.startsWith('!pip ');

        if (isPipMagic) {
          // Extract arguments after the magic - split properly to handle flags and package names
          const args = line.replace(/^[%!]pip\s+/, '').trim();
          if (args) {
            // Split args by spaces but preserve quoted strings
            const argList = args.match(/(?:[^\s"]+|"[^"]*")+/g) || [args];
            // Build a Python snippet that performs the installation
            out.push([
              'import sys, subprocess',
              'try:',
              `    subprocess.check_call([sys.executable, '-m', 'pip'] + ${JSON.stringify(argList)})`,
              `    print("✅ pip install completed:", ${JSON.stringify(args)})`,
              'except subprocess.CalledProcessError as e:',
              `    print("❌ pip install failed:", ${JSON.stringify(args)}, file=sys.stderr)`,
              '    print("Error:", str(e), file=sys.stderr)'
            ].join('\n'));
          }
        } else {
          // Check for top-level await (not inside function/class/try/etc)
          if (line.includes('await ') && !line.startsWith('#') &&
            !this.isInsideFunction(raw, lines, lines.indexOf(raw))) {
            hasTopLevelAwait = true;
          }
          // Keep non-pip lines exactly as they are
          out.push(raw);
        }
      }

      // If we found top-level await, wrap in async function with execution guard
      if (hasTopLevelAwait) {
        const wrappedCode = [
          'import asyncio',
          'import uuid',
          '',
          '# Generate unique execution ID to prevent double execution',
          '_exec_id = str(uuid.uuid4())',
          'if not hasattr(globals(), "_last_exec_id") or globals().get("_last_exec_id") != _exec_id:',
          '    globals()["_last_exec_id"] = _exec_id',
          '    ',
          '    async def _async_cell():',
          ...out.map(line => '        ' + line),
          '    ',
          '    # Execute the async cell',
          '    asyncio.run(_async_cell())'
        ].join('\n');
        return wrappedCode;
      }

      return out.join('\n');
    } catch (e) {
      // Fail-safe: return original code
      return code;
    }
  }

  /**
   * Sanitize execution outputs to filter out non-output message types and normalize stream text
   */
  private sanitizeOutputs(result: any): any {
    const allowedOutputTypes = new Set([
      'stream',
      'display_data',
      'execute_result',
      'error',
      'update_display_data',
      'clear_output'
    ]);

    const outputs = Array.isArray(result?.outputs) ? result.outputs : [];
    const cleanOutputs = outputs
      .filter((output: any) => allowedOutputTypes.has(output?.output_type))
      .map((output: any) => {
        // Ensure stream.text is an array for client, dedupe consecutive duplicate lines
        if (output.output_type === 'stream') {
          const textArr = Array.isArray(output.text)
            ? output.text
            : (typeof output.text === 'string' ? [output.text] : []);

          const dedupedText = textArr.filter((line: string, index: number) =>
            index === 0 || line !== textArr[index - 1]
          );

          return { ...output, text: dedupedText };
        }
        return output;
      });

    // Normalize top-level casing: use cellId consistently
    const cellId = result.cellId ?? result.cell_id ?? undefined;

    return { ...result, cellId, outputs: cleanOutputs };
  }

  /**
   * Check if a line with await is inside a function/class/try block
   */
  private isInsideFunction(currentLine: string, allLines: string[], currentIndex: number): boolean {
    // Simple heuristic: check if we're indented and there's a function/class/try above us
    const currentIndent = currentLine.length - currentLine.trimStart().length;
    if (currentIndent === 0) return false; // Top level

    // Look backwards for function/class/try definitions
    for (let i = currentIndex - 1; i >= 0; i--) {
      const line = allLines[i].trim();
      const lineIndent = allLines[i].length - allLines[i].trimStart().length;

      if (lineIndent < currentIndent &&
        (line.startsWith('def ') || line.startsWith('async def ') ||
          line.startsWith('class ') || line.startsWith('try:'))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Initialize a Jupyter kernel gateway server
   */
  async initializeJupyterServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('Using existing Jupyter kernel gateway...');

      // Check if the kernel gateway is already running on port 8888
      exec('curl -s http://localhost:8888/api', (error) => {
        if (!error) {
          console.log('Jupyter kernel gateway is already running');
          resolve();
          return;
        }

        // Start using the specific Python path from Anaconda
        this.kernelProcess = spawn(PYTHON_EXECUTABLE, buildKernelGatewayArgs(8888, ''), {
          env: {
            ...getLocalJupyterEnv(),
            KG_ALLOW_ORIGIN: '*',
            KG_ALLOW_CREDENTIALS: 'True',
            // CORS environment variables
            JUPYTER_ALLOW_ORIGIN: '*',
            JUPYTER_ALLOW_ORIGIN_PAT: '.*',
            JUPYTER_DISABLE_CHECK_XSRF: 'True',
            // Ensure WebSocket settings propagate via environment as well
            JUPYTER_WEBSOCKET_PING_INTERVAL: '0',
            JUPYTER_WEBSOCKET_PING_TIMEOUT: '0'
          }, // Inherit all environment variables from parent process
          stdio: ['pipe', 'pipe', 'pipe']
        });

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

        // Prevent process crash on spawn errors in restricted environments
        this.kernelProcess.on('error', (e) => {
          console.warn('⚠️ Jupyter kernel gateway spawn error (non-fatal):', (e as any)?.message || e);
          // Resolve to avoid blocking server readiness
          resolve();
        });

        this.kernelProcess.on('close', (code) => {
          console.log(`Jupyter kernel gateway exited with code ${code}`);
          this.kernelProcess = null;
        });

        // Set a timeout for initialization and warm up the kernel
        // Set a timeout for initialization and warm up the kernel
        const checkInterval = setInterval(() => {
          exec('curl -s http://localhost:8888/api', (err) => {
            if (!err) {
              clearInterval(checkInterval);
              console.log('✅ Jupyter kernel gateway is ready!');

              // Warm up the kernel
              this.warmUpKernel().then(() => {
                console.log('✅ Kernel warm-up completed');
                resolve();
              }).catch(e => {
                console.log('⚠️ Kernel warm-up failed, but continuing:', e);
                resolve();
              });
            }
          });
        }, 1000);

        // Safety timeout - if it doesn't start in 30 seconds, resolve anyway (might be working but curl failed)
        setTimeout(() => {
          clearInterval(checkInterval);
          console.log('⚠️ Jupyter startup check timed out, assuming ready...');
          resolve();
        }, 30000);
      });
    });
  }

  /**
   * Enhanced warm up the kernel with your specific dependencies
   */
  private async warmUpKernel(): Promise<void> {
    return new Promise((resolve, reject) => {
      const warmupCode = `
# Kernel warm-up: pre-load common modules to reduce cold start time
import sys
import os
import json
import time
import asyncio

# Fix WebSocket configuration FIRST
os.environ['JUPYTER_WEBSOCKET_PING_INTERVAL'] = '0'
os.environ['JUPYTER_WEBSOCKET_PING_TIMEOUT'] = '0'

# Fix ZMQ connection handling for cloud environments
import os
import zmq

# Enable ZMQ_ROUTER_HANDOVER for all ROUTER sockets
os.environ['ZMQ_ROUTER_HANDOVER'] = '1'

# Configure ZMQ context for better cloud reliability
try:
    ctx = zmq.Context.instance()
    # Set socket options for cloud environments
    ctx.setsockopt(zmq.ROUTER_HANDOVER, 1)
    ctx.setsockopt(zmq.LINGER, 1000)  # 1 second linger
    ctx.setsockopt(zmq.RECONNECT_IVL, 1000)  # Reconnect every 1 second
    ctx.setsockopt(zmq.RECONNECT_IVL_MAX, 5000)  # Max 5 seconds
    print("✅ ZMQ cloud reliability options enabled")
except Exception as e:
    print(f"⚠️ ZMQ options warning: {e}")

# Make event loop re-entrant to avoid deadlocks from libraries that manage loops
try:
    import nest_asyncio
except Exception:
    try:
        import subprocess, sys
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'nest_asyncio'])
        import nest_asyncio
        print("📦 Installed nest_asyncio")
    except Exception as e:
        print("⚠️ Could not install nest_asyncio:", e)
        nest_asyncio = None

try:
    if 'nest_asyncio' in globals() and nest_asyncio is not None:
        nest_asyncio.apply()
        print("✅ nest_asyncio applied")
    else:
        print("⚠️ nest_asyncio not applied: module unavailable")
except Exception as e:
    print("⚠️ nest_asyncio apply failed:", e)

# Pre-install and import your specific dependencies
try:
    import subprocess
    # Optionally perform quick checks that don't depend on unavailable packages
    print("✅ Basic warmup imports loaded")

    # Try to warm up agent framework if available (no hard failure if missing)
    try:
        # Prefer a generic 'agents' interface if present
        from agents import Agent, Runner, WebSearchTool  # type: ignore
        dummy_agent = Agent(
            name="WarmupAgent",
            instructions="Warmup agent",
            model="gpt-4o-mini",
            tools=[WebSearchTool()],
        )
        try:
            _warm = Runner.run_sync(dummy_agent, "test")
            print("✅ Agent framework warmed up successfully")
        except Exception as e:
            print(f"⚠️ Agent warmup had issues but continuing: {e}")
        try:
            del dummy_agent
            del _warm
        except Exception:
            pass
    except Exception as e:
        print(f"ℹ️ Agent framework not available or failed to warm: {e}")
    
except Exception as e:
    print(f"⚠️ Warmup warning: {e}")
    # Don't fail the warmup, just log the issue

print("🔥 Kernel warm-up complete")
`;

      const execOptions = {
        timeout: 120000, // Increase to 2 minutes for package installation
        maxBuffer: 1024 * 1024 * 5, // 5MB buffer for installation logs
        env: {
          ...process.env,
          // Keep warmup subprocess consistent with the kernel gateway python environment.
          PYTHONNOUSERSITE: '1'
        }
      };

      const pythonExe = PYTHON_EXECUTABLE;

      exec(`"${pythonExe}" -c "${warmupCode.replace(/"/g, '\\"')}"`, execOptions, (error, stdout, stderr) => {
        if (error) {
          console.log('⚠️ Enhanced warm-up had issues but continuing:', error.message);
          console.log('Stdout:', stdout);
          console.log('Stderr:', stderr);
          // Don't reject - warm-up failure shouldn't block kernel startup
          resolve();
        } else {
          console.log('✅ Enhanced kernel warm-up completed:', stdout);
          resolve();
        }
      });
    });
  }

  /**
   * Handle incoming WebSocket connections and messages
   */
  handleConnection(ws: WebSocket): () => void {
    const connectionId = uuidv4();
    let heartbeatInterval: NodeJS.Timeout;

    console.log(`✅ Client connected: ${connectionId}`);

    // Store the connection
    this.connections.set(connectionId, {
      id: connectionId,
      clientSocket: ws
    });

    // Send initial connection ack
    this.sendToClient(connectionId, {
      type: 'connection_ack',
      content: { id: connectionId, timestamp: new Date().toISOString() }
    });

    // Set up heartbeat to keep connection alive (send every 5 minutes instead of 30 seconds)
    heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        this.sendToClient(connectionId, {
          type: 'heartbeat',
          content: { timestamp: new Date().toISOString() }
        });
        console.log(`✅ Sent heartbeat to client: ${connectionId}`);
      } else {
        // Clear interval if WebSocket is no longer open
        clearInterval(heartbeatInterval);
        console.log(`⚠️ Heartbeat stopped for closed connection: ${connectionId}`);
      }
    }, 300000); // Send heartbeat every 5 minutes

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log(`✅ Received message from client ${connectionId}:`, { type: message.type });
        await this.handleMessage(message, connectionId);
      } catch (error) {
        console.error('❌ Error handling WebSocket message:', error);
        this.sendErrorToClient(connectionId, 'Invalid message format');
      }
    });

    ws.on('error', (error) => {
      console.error(`❌ WebSocket error for client ${connectionId}:`, error);
    });

    ws.on('close', (code, reason) => {
      // Clean up the connection when the client disconnects
      console.log(`❌ Client disconnected: ${connectionId}`, {
        code,
        reason: reason.toString(),
        timestamp: new Date().toISOString(),
        hasConnectionInfo: !!this.connections.get(connectionId)?.connectionInfo
      });

      // Clear the heartbeat interval
      clearInterval(heartbeatInterval);

      // Clean up the connection
      this.connections.delete(connectionId);
    });

    // Return cleanup function
    return () => {
      clearInterval(heartbeatInterval);
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
        await this.executeCodeWithRecovery(connectionId, message.content);
        break;

      case 'interrupt_kernel':
        await this.interruptKernel(connectionId);
        break;

      case 'restart_kernel':
        await this.restartKernel(connectionId);
        break;

      case 'heartbeat_response':
        // Client acknowledging heartbeat - no action needed
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
        // No fallback — propagate the error clearly so the user can fix the root cause
        this.sendErrorToClient(connectionId, `Failed to start kernel: ${apiError.message}`);
      }
    } catch (error: any) {
      console.error('Error starting kernel:', error);
      this.sendErrorToClient(connectionId, `Failed to start kernel: ${error.message}`);
    }
  }

  /**
   * Execute code with connection recovery logic
   */
  private async executeCodeWithRecovery(connectionId: string, request: any): Promise<void> {
    // Attempts are environment-driven to avoid hardcoding
    let maxAttempts = Number(process.env.EXECUTE_MAX_ATTEMPTS || 3);
    // If the cell contains pip magic/installs, avoid retries to prevent duplicate pip outputs
    const codeForRetryCheck = String(request?.code || '');
    const hasPipMagic = /(^(?:\s)*)[%!]pip\s+|subprocess\.check_call\(\[sys\.executable, '-m', 'pip']/.test(codeForRetryCheck);
    if (hasPipMagic) {
      maxAttempts = 1;
    }
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`🔄 Execution attempt ${attempt}/${maxAttempts} for ${connectionId}`);

        // Check if this is a network/agent operation
        const isAgentOperation = /from agents import|Agent\(|WebSearchTool|Runner\.run_sync/i.test(request.code || '');
        const isNetworkOperation = this.hasNetworkOperations(request.code || '');

        if (isAgentOperation && attempt > 1) {
          // Force clean kernel state before retry
          await this.cleanKernelState(connectionId);
        }

        await this.executeCode(connectionId, request);
        return; // Success!

      } catch (error: any) {
        lastError = error;
        console.log(`❌ Attempt ${attempt} failed:`, error.message);

        // Check if it's a ZMQ connection issue
        if (error.message.includes('busy') ||
          error.message.includes('timeout') ||
          error.message.includes('zmq') ||
          error.message.includes('kernel')) {

          if (attempt < maxAttempts) {
            // Best-effort: send an interrupt to clear any stuck execution
            try {
              console.log(`🛑 Sending interrupt before retry (attempt ${attempt + 1})...`);
              await this.interruptKernel(connectionId);
            } catch (ie) {
              console.warn('⚠️ Interrupt before retry failed (continuing):', (ie as any)?.message || ie);
            }

            console.log(`🔄 ZMQ/busy/timeout detected, retrying in ${attempt * 2} seconds...`);
            await new Promise(resolve => setTimeout(resolve, attempt * 2000));
            continue;
          }
        }
        throw error;
      }
    }

    throw lastError;
  }

  private async cleanKernelState(connectionId: string): Promise<void> {
    // Force clean the kernel ZMQ state
    const connection = this.connections.get(connectionId);
    if (connection?.connectionInfo) {
      console.log('🧹 Cleaning kernel ZMQ state...');

      // Reset the connection info to force fresh ZMQ connections
      const oldConnectionInfo = connection.connectionInfo;
      connection.connectionInfo = null;

      // Small delay to let ZMQ cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Restore or recreate connection
      connection.connectionInfo = oldConnectionInfo;
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

          // Execute code using the direct WebSocket API
          const kernelId = connection.connectionInfo.id;
          console.log(`Executing code on kernel ${kernelId} via WebSocket API`);

          try {
            // Normalize Colab-style magics before sending to kernel
            const codeToRun = this.normalizeMagics(request.code || '');
            // Use the gateway to execute the code with WebSockets
            const executeResult = await jupyterGateway.executeCode(kernelId, codeToRun, request.cellId);
            console.log(`WebSocket execution completed for kernel ${kernelId}`);
            console.log('Raw executeResult:', JSON.stringify(executeResult, null, 2));

            // Sanitize outputs to filter out non-output message types and normalize stream text
            let sanitized;
            try {
              sanitized = this.sanitizeOutputs(executeResult);
              console.log('Sanitized result:', JSON.stringify(sanitized, null, 2));
            } catch (sanitizeError) {
              console.error('Error in sanitizeOutputs:', sanitizeError);
              // Fall back to original result if sanitization fails
              sanitized = executeResult;
            }

            // Send the execution result to the client
            this.sendToClient(connectionId, {
              type: 'execute_result',
              content: sanitized
            });

            // Update kernel status to idle
            this.sendToClient(connectionId, {
              type: 'kernel_status',
              content: {
                id: connectionId,
                status: 'idle'
              }
            });

            console.log(`Code executed for connection ${connectionId} via WebSocket API`);
            return; // Exit early since we handled it via the API

          } catch (wsError) {
            console.error('WebSocket execution failed:', wsError);
            // Continue to fallback execution (do not return here)
          }

          // This section will only run if the WebSocket approach failed
          // We'll continue to the legacy code execution below
        } catch (apiError: any) {
          console.error('Error executing code via API:', apiError);
          // Continue with the legacy approach if API fails
        }
      }

      // Fall back to the original approach - ensure we have proper ZMQ connection info
      const zmqInfo = await this.ensureZmqKernel(connection, 'python3');

      // Detect if this is an agent-related operation (subset of network ops) and apply stronger timeouts
      const codeStr = request.code || '';
      const isAgentOperation = /from agents import|Agent\(|WebSearchTool|Runner\.run_sync|Runner\.run/i.test(codeStr);
      const isNetworkOperation = this.hasNetworkOperations(codeStr);
      // Use environment-driven default timeouts only (no hardcoded multipliers)
      const effectiveTimeout = EXECUTION_TIMEOUT_MS;
      const effectiveSubprocessTimeout = SUBPROCESS_TIMEOUT_MS;

      console.log(`Executing code with timeout (${effectiveTimeout}ms)`);

      // Create a temporary Python script to execute the code using the connection info
      const tempScriptPath = path.join(process.cwd(), 'temp_code_executor.py');
      const normalizedCode = this.normalizeMagics(request.code || '');
      const scriptContent = `
import sys
import os
import gc

# CRITICAL: Clear all possible output caches before execution
if hasattr(sys, '_getframe'):
    try:
        frame = sys._getframe()
        while frame:
            if 'result' in frame.f_locals:
                del frame.f_locals['result']
            if 'final_output' in frame.f_locals:
                del frame.f_locals['final_output']
            frame = frame.f_back
    except:
        pass

# Clear stdout/stderr buffers
sys.stdout.flush()
sys.stderr.flush()

# Force garbage collection
gc.collect()

# Clear IPython output cache if it exists
try:
    from IPython import get_ipython
    ipython = get_ipython()
    if ipython:
        ipython.reset(new_session=False)
        if hasattr(ipython, 'displayhook'):
            ipython.displayhook.finish_displayhook()
except:
    pass

# Clear any global variables that might hold previous results
for var_name in list(globals().keys()):
    if var_name.startswith('_') and var_name not in ['__name__', '__doc__', '__package__']:
        try:
            del globals()[var_name]
        except:
            pass

import os
import sys

# CRITICAL: Set ZMQ options BEFORE any other imports
os.environ['ZMQ_ROUTER_HANDOVER'] = '1'
os.environ['ZMQ_LINGER'] = '1000'
os.environ['ZMQ_RECONNECT_IVL'] = '1000'
os.environ['ZMQ_RECONNECT_IVL_MAX'] = '5000'

import json
from io import StringIO

# Now configure ZMQ context BEFORE creating any clients
import zmq
try:
    ctx = zmq.Context.instance()
    ctx.setsockopt(zmq.ROUTER_HANDOVER, 1)
    ctx.setsockopt(zmq.LINGER, 1000)
    ctx.setsockopt(zmq.RECONNECT_IVL, 1000)
    ctx.setsockopt(zmq.RECONNECT_IVL_MAX, 5000)
    print("✅ ZMQ cloud reliability options enabled", file=sys.stderr)
except Exception as e:
    print(f"⚠️ ZMQ options warning: {e}", file=sys.stderr)

# ONLY NOW import and create the kernel client
from jupyter_client import BlockingKernelClient

# Suppress stdout during execution to prevent double printing
original_stdout = sys.stdout
sys.stdout = StringIO()

# Get connection info from the first argument
connection_info = json.loads('''${JSON.stringify(zmqInfo)}''')

# Validate ZMQ connection info before proceeding
required = ["ip","shell_port","iopub_port","stdin_port","hb_port","key","transport","signature_scheme"]
missing = [k for k in required if k not in connection_info]
if missing:
    # Return a structured error immediately so JS doesn't hit the 60-min timeout
    sys.stdout = original_stdout
    print(json.dumps({
        "cellId": "${request.cellId}",
        "status": "error",
        "execution_count": None,
        "outputs": [{
            "output_type": "error",
            "traceback": [f"Missing ZMQ fields in connection_info: {missing}. Gateway kernel IDs cannot be used with BlockingKernelClient."]
        }]
    }))
    sys.exit(1)

# Get the code to execute (normalized to support %pip/!pip)
code = '''${(request.code || '').replace(/'''/g, "\\'\\'")}'''

# Apply server-side normalization to ensure %pip/!pip work in all environments
_normalized = '''${(normalizedCode || '').replace(/'''/g, "\\'\\'")}'''
if _normalized and _normalized.strip():
    code = _normalized

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

# Wait for execute_reply on shell channel for robustness
try:
    while True:
        rep = kc.get_shell_msg(timeout=${IOPUB_MESSAGE_TIMEOUT_SEC})
        if rep.get("parent_header", {}).get("msg_id") == msg_id and rep["header"]["msg_type"] == "execute_reply":
            break
except Exception as e:
    # Not fatal—IOPub idle will usually be enough
    pass

# Collect outputs
outputs = []
execution_count = None
execution_state = 'idle'
status = 'ok'

# Process messages until we get an idle status
try:
    while True:
        try:
            # Use extended timeout for network operations
            timeout_sec = ${NETWORK_TOOL_TIMEOUT_SEC} if any(pattern in code.lower() for pattern in ['websearchtool', 'requests.', 'urllib', 'httpx', 'aiohttp']) else ${IOPUB_MESSAGE_TIMEOUT_SEC}
            msg = kc.get_iopub_msg(timeout=timeout_sec)  # configurable seconds between messages
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
                    # Ensure text is an array of lines to match WS gateway
                    txt = content.get('text', '')
                    if isinstance(txt, list):
                        lines = [str(x) for x in txt if x is not None]
                    elif isinstance(txt, str):
                        lines = txt.splitlines()
                    else:
                        lines = []
                    output['text'] = lines
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
            # Don't break on timeout - operations (e.g., web searches) can have long gaps between messages
            print(f"Waiting for more messages (timeout/error): {str(e)}", file=sys.stderr)
            continue
except Exception as e:
    print(f"Error: {str(e)}", file=sys.stderr)
    status = 'error'
finally:
    # Make sure to stop the channels
    kc.stop_channels()

# Print the results as JSON
result = {
    'cellId': '${request.cellId}',
    'status': status,
    'execution_count': execution_count,
    'outputs': outputs
}

# At the very end, restore stdout only for the JSON result
sys.stdout = original_stdout
try:
    print(json.dumps(result))
except TypeError as e:
    # If JSON serialization fails, try converting any remaining non-serializable objects
    print(json.dumps(bytes_to_str(result)))
`;

      fs.writeFileSync(tempScriptPath, scriptContent);

      // Add a timeout for the execution (configurable, extended for network operations)
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
              traceback: [isNetworkOperation ?
                'Network operation timed out. WebSearchTool or similar network tools may be blocked or slow in this environment.' :
                'Execution timed out. The kernel may be busy or not responding.']
            }]
          }
        });
      }, effectiveTimeout);

      // Emit periodic execution progress updates to the client while running
      const startedAt = Date.now();
      const progressInterval = setInterval(() => {
        const elapsedMs = Date.now() - startedAt;
        this.sendToClient(connectionId, {
          type: 'execution_progress',
          content: {
            cellId: request.cellId,
            message: 'Cell still running...',
            elapsedMs
          }
        });
      }, 30_000); // every 30 seconds

      // Execute the script with a timeout slightly less than effective timeout
      const execOptions = {
        timeout: effectiveSubprocessTimeout,
        maxBuffer: 1024 * 1024 * 100, // Increase buffer to 100MB for larger outputs (agents can be verbose)
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          AGENT_TIMEOUT: isAgentOperation ? '300' : (process.env.AGENT_TIMEOUT || '180'),
          WEBSEARCH_TIMEOUT: isAgentOperation ? '180' : (process.env.WEBSEARCH_TIMEOUT || '120'),
          // ZMQ reliability options
          ZMQ_ROUTER_HANDOVER: '1',
          ZMQ_LINGER: '1000',
          ZMQ_RECONNECT_IVL: '1000',
          ZMQ_RECONNECT_IVL_MAX: '5000',
          // Jupyter specific timeout increases
          JUPYTER_KERNEL_TIMEOUT: '300',
          JUPYTER_STARTUP_TIMEOUT: '60'
        }
      } as const;

      exec(`"${PYTHON_EXECUTABLE}" "${tempScriptPath}"`, execOptions, (error, stdout, stderr) => {
        // Clear the timeout since we got a response
        try {
          clearTimeout(execTimeout);
        } catch (err) {
          console.error('Error clearing timeout:', err);
        }
        // Clear progress interval
        try {
          clearInterval(progressInterval);
        } catch (e) {
          // ignore
        }

        // Clean up temp file
        try {
          if (fs.existsSync(tempScriptPath)) {
            fs.unlinkSync(tempScriptPath);
          }
        } catch (unlinkError) {
          console.error(`Error removing temporary script: ${unlinkError}`);
          // Continue execution despite file cleanup error
        }

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
      exec(`"${PYTHON_EXECUTABLE}" "${tempScriptPath}"`, (error, stdout, stderr) => {
        // Clean up temp file
        try {
          if (fs.existsSync(tempScriptPath)) {
            fs.unlinkSync(tempScriptPath);
          }
        } catch (unlinkError) {
          console.error(`Error removing temporary script: ${unlinkError}`);
          // Continue execution despite file cleanup error
        }

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
      exec(`"${PYTHON_EXECUTABLE}" "${tempScriptPath}"`, (error, stdout, stderr) => {
        // Clean up temp file
        try {
          if (fs.existsSync(tempScriptPath)) {
            fs.unlinkSync(tempScriptPath);
          }
        } catch (unlinkError) {
          console.error(`Error removing temporary script: ${unlinkError}`);
          // Continue execution despite file cleanup error
        }

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
      exec(`"${PYTHON_EXECUTABLE}" "${tempScriptPath}"`, (error, stdout, stderr) => {
        // Clean up temp file
        try {
          if (fs.existsSync(tempScriptPath)) {
            fs.unlinkSync(tempScriptPath);
          }
        } catch (e) {
          console.error(`Error removing temporary script: ${e}`);
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
      try {
        const messageStr = JSON.stringify(message);
        console.log(`Sending message to ${connectionId}:`, message.type, messageStr.length, 'bytes');
        connection.clientSocket.send(messageStr);
      } catch (error) {
        console.error(`Error serializing message for ${connectionId}:`, error);
        console.error('Message that failed:', message);
        // Try to send a simple error message instead
        try {
          connection.clientSocket.send(JSON.stringify({
            type: 'error',
            content: { error: 'Message serialization failed' }
          }));
        } catch (fallbackError) {
          console.error(`Even fallback message failed for ${connectionId}:`, fallbackError);
        }
      }
    } else {
      console.warn(`Cannot send message to connection ${connectionId} because socket is not open`);
      this.connections.delete(connectionId);
    }
  }

  /**
   * Check if connection info has required ZMQ fields
   */
  private hasZmqFields(ci: any): boolean {
    const req = ['ip', 'shell_port', 'iopub_port', 'stdin_port', 'hb_port', 'key', 'transport', 'signature_scheme'];
    return !!ci && req.every(k => k in ci);
  }

  /**
   * Ensure we have proper ZMQ connection info for fallback execution
   */
  private async ensureZmqKernel(connection: KernelConnection, kernelName = 'python3'): Promise<any> {
    if (this.hasZmqFields(connection.connectionInfo)) return connection.connectionInfo;

    // Start a fresh local kernel and return its full ZMQ connection info
    const tempScriptPath = path.join(process.cwd(), 'temp_kernel_starter_zmq.py');
    const script = `
import json
from jupyter_client import KernelManager

km = KernelManager(kernel_name='${kernelName}')
km.start_kernel()
info = km.get_connection_info()

def b2s(o):
    if isinstance(o, bytes): return o.decode('utf-8')
    if isinstance(o, dict): return {k: b2s(v) for k,v in o.items()}
    if isinstance(o, list): return [b2s(v) for v in o]
    return o

print(json.dumps(b2s(info)))
`;
    fs.writeFileSync(tempScriptPath, script);
    return await new Promise((resolve, reject) => {
      exec(`"${PYTHON_EXECUTABLE}" "${tempScriptPath}"`, (err, stdout, stderr) => {
        try { if (fs.existsSync(tempScriptPath)) fs.unlinkSync(tempScriptPath); } catch { }
        if (err) return reject(new Error(`Failed to start local kernel: ${err.message}\n${stderr || ''}`));
        try {
          const info = JSON.parse(stdout.trim());
          connection.connectionInfo = info; // persist
          resolve(info);
        } catch (e: any) {
          reject(new Error(`Bad ZMQ connection JSON: ${e.message}\n${stdout}`));
        }
      });
    });
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
