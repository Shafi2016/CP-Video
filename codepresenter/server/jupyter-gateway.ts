/**
 * Direct integration with Jupyter Server/Kernel Gateway channels (Node ws).
 * Minimal, resilient, and with proper WS error visibility.
 */

import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";

type ExecStatus = "ok" | "error";

const API_URL = (process.env.JUPYTER_URL || "http://127.0.0.1:8888").trim();
// Lazy load TOKEN to ensure .env is loaded first
const getToken = () => (process.env.JUPYTER_TOKEN || "").trim();

const WS_TIMEOUT_MS = Number(process.env.JUPYTER_WS_TIMEOUT_MS || process.env.EXECUTION_TIMEOUT_MS || 30 * 60 * 1000);
const DRAIN_AFTER_REPLY_MS = Number(process.env.JUPYTER_DRAIN_AFTER_REPLY_MS || 200);
const DRAIN_AFTER_IDLE_MS = Number(process.env.JUPYTER_DRAIN_AFTER_IDLE_MS || 150);
const PING_INTERVAL_MS = Number(process.env.JUPYTER_WS_PING_INTERVAL_MS || 25_000);

function restParams() {
  const TOKEN = getToken();
  return TOKEN ? { token: TOKEN } : undefined;
}
function buildWsUrl(path: string): string {
  const TOKEN = getToken();
  const u = new URL(API_URL);
  const wsProtocol = u.protocol === "https:" ? "wss:" : "ws:";
  const qs = TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : "";
  return `${wsProtocol}//${u.host}${path}${qs}`;
}

export interface KernelInfo { id: string; name: string; }

// Track gateway initialization state
let gatewayInitialized = false;
let gatewayInitializing = false;

export class JupyterGateway {
  private sessionId = uuidv4();

  /**
   * Ensure the Jupyter Kernel Gateway is running before making API calls.
   * This is called automatically by all public methods.
   */
  private async ensureGatewayRunning(): Promise<void> {
    if (gatewayInitialized) return;
    if (gatewayInitializing) {
      // Wait for ongoing initialization
      while (gatewayInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      // If the other caller succeeded, we're done; otherwise fall through to retry
      if (gatewayInitialized) return;
    }

    gatewayInitializing = true;
    try {
      // Import and call startKernelGateway from jupyter-bridge
      const { startKernelGateway } = await import('./jupyter-bridge');
      console.log('🚀 [JupyterGateway] Ensuring Kernel Gateway is running...');
      await startKernelGateway();
      gatewayInitialized = true;
      console.log('✅ [JupyterGateway] Kernel Gateway is ready');
    } catch (e) {
      console.error('❌ [JupyterGateway] Failed to start Kernel Gateway:', (e as any)?.message || e);
      throw e;
    } finally {
      gatewayInitializing = false;
    }
  }

  async listKernels(): Promise<KernelInfo[]> {
    await this.ensureGatewayRunning();
    const { data } = await axios.get(`${API_URL}/api/kernels`, {
      params: restParams(),
      timeout: 10_000,
    });
    return data;
  }

  async startKernel(name = "python3"): Promise<KernelInfo> {
    await this.ensureGatewayRunning();
    const { data } = await axios.post(
      `${API_URL}/api/kernels`,
      { name },
      { params: restParams(), timeout: 15_000 }
    );
    return data;
  }

  async executeCode(
    kernelId: string,
    userCode: string,
    cellId: string,
    sessionId?: string
  ): Promise<{ cellId: string; status: ExecStatus; execution_count: number | null; outputs: any[] }> {
    await this.ensureGatewayRunning();
    const wsUrl = buildWsUrl(`/api/kernels/${encodeURIComponent(kernelId)}/channels`);

    // Import secret manager for session-specific secrets
    const { secretManager } = await import('./secret-manager');

    // Build environment variables injection dynamically
    let envVars: Record<string, string> = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
      JUPYTER_TOKEN: process.env.JUPYTER_TOKEN || '',
      FIREBASE_API_KEY: process.env.FIREBASE_API_KEY || '',
      ACCESS_CODE: process.env.ACCESS_CODE || ''
    };

    // Add session-specific secrets if sessionId provided
    if (sessionId) {
      const sessionSecrets = secretManager.getSessionEnvVars(sessionId);
      envVars = { ...envVars, ...sessionSecrets };
      console.log(`🔍 Injecting ${Object.keys(sessionSecrets).length} session-specific secrets for session: ${sessionId}`);
    }

    const envInjectionCode = Object.entries(envVars)
      .filter(([_, value]) => value && value.trim() !== '')
      .map(([key, value]) => `os.environ["${key}"] = """${value.replace(/"""/g, '\\"""')}"""`)
      .join('\n');

    // Detect if user code uses LlamaIndex / heavy embedding workloads
    const usesLlamaIndex = /llama_index|VectorStoreIndex|from_documents|StorageContext|SimpleDirectoryReader/i.test(userCode);
    const usesOpenAIEmbedding = usesLlamaIndex || /OpenAIEmbedding|embed_model|embeddings?\s*=/i.test(userCode);

    // Small, safe prelude to enable top-level await and fix file paths
    // Heavy operations (file symlinks, LlamaIndex tuning) run only once per kernel via guard flags
    const PRELUDE = `
try:
    import IPython
    ip = IPython.get_ipython()
    if ip:
        try: ip.run_line_magic("autoawait", "asyncio")
        except Exception: pass
except Exception: pass
try:
    import nest_asyncio; nest_asyncio.apply()
except Exception: pass

import os, sys
from pathlib import Path

# Inject environment variables from server process
${envInjectionCode}

# --- File symlinks: run only once per kernel session ---
if not globals().get('_cp_files_linked'):
    _upload_paths = [
        Path.cwd() / "uploads",
        Path.cwd().parent / "uploads",
        Path.cwd().parent.parent / "uploads",
        Path("/uploads") if Path("/uploads").exists() else None,
    ]
    _upload_paths = [p for p in _upload_paths if p and p.exists()]
    if _upload_paths:
        _main_uploads = _upload_paths[0]
        for _file in _main_uploads.iterdir():
            if _file.is_file():
                _local_path = Path.cwd() / _file.name
                try:
                    if _local_path.exists():
                        _local_path.unlink()
                    _local_path.symlink_to(_file)
                except Exception:
                    try:
                        import shutil
                        shutil.copy2(_file, _local_path)
                    except Exception:
                        pass
    globals()['_cp_files_linked'] = True

${usesOpenAIEmbedding ? `
# --- LlamaIndex / OpenAI Embedding performance tuning ---
# Run once per kernel to configure fast batch embedding & connection pooling
if not globals().get('_cp_llama_tuned'):
    try:
        # Set OpenAI client timeouts via environment (picked up by openai SDK)
        os.environ.setdefault('OPENAI_TIMEOUT', '120')
        os.environ.setdefault('OPENAI_MAX_RETRIES', '3')

        # Increase httpx connection pool for concurrent embedding requests
        try:
            import httpx
            # Larger pool = more parallel embedding calls
            os.environ.setdefault('HTTPX_DEFAULT_POOL_CONNECTIONS', '20')
            os.environ.setdefault('HTTPX_DEFAULT_POOL_MAXSIZE', '20')
        except ImportError:
            pass

        # Configure LlamaIndex global settings for faster embedding
        try:
            from llama_index.core import Settings as _LISettings
            # Increase embed batch size from default 10 to 100 for fewer API round-trips
            if _LISettings.embed_model is not None:
                if hasattr(_LISettings.embed_model, 'embed_batch_size'):
                    _LISettings.embed_model.embed_batch_size = max(
                        _LISettings.embed_model.embed_batch_size, 100
                    )
            # Set chunk size/overlap for more efficient chunking
            if _LISettings.chunk_size and _LISettings.chunk_size < 1024:
                _LISettings.chunk_size = 1024
        except ImportError:
            pass

        # Patch OpenAIEmbedding default batch size when it gets instantiated
        try:
            from llama_index.embeddings.openai import OpenAIEmbedding as _OAIEmbed
            _orig_init = _OAIEmbed.__init__
            def _patched_init(self, *args, **kwargs):
                kwargs.setdefault('embed_batch_size', 100)
                kwargs.setdefault('timeout', 120.0)
                _orig_init(self, *args, **kwargs)
            _OAIEmbed.__init__ = _patched_init
        except ImportError:
            try:
                from llama_index.core.embeddings import OpenAIEmbedding as _OAIEmbed2
                _orig_init2 = _OAIEmbed2.__init__
                def _patched_init2(self, *args, **kwargs):
                    kwargs.setdefault('embed_batch_size', 100)
                    kwargs.setdefault('timeout', 120.0)
                    _orig_init2(self, *args, **kwargs)
                _OAIEmbed2.__init__ = _patched_init2
            except ImportError:
                pass

        print("⚡ LlamaIndex/OpenAI embedding optimized (batch=100, pool=20)")
    except Exception as _e:
        print(f"⚠️ LlamaIndex tuning skipped: {_e}")
    globals()['_cp_llama_tuned'] = True
` : ''}
`.trim();

    const codeToSend = `${PRELUDE}\n${userCode}`;

    const execMsgId = uuidv4();
    const infoMsgId = uuidv4();

    let resolved = false;
    let status: ExecStatus = "ok";
    let execCount: number | null = null;
    const outputs: any[] = [];
    let sawExecuteReply = false;
    let drainTimer: NodeJS.Timeout | null = null;
    let pingTimer: NodeJS.Timeout | null = null;

    const makeMsg = (msg_type: string, content: any, parent?: string) => ({
      header: {
        msg_id: uuidv4(),
        username: "user",
        session: this.sessionId,
        msg_type,
        version: "5.3",
      },
      parent_header: parent ? { msg_id: parent } : {},
      metadata: {},
      content,
      channel: "shell",
    });

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        perMessageDeflate: false,
        headers: { Origin: "http://localhost" }, // helps with strict Origin checks
      });

      console.log(`[Gateway] Connecting to ${wsUrl.replace(/token=[^&]+/, 'token=***')}`);
      const tokenUsed = getToken();
      console.log(`[Gateway] Using token: ${tokenUsed ? tokenUsed.substring(0, 4) + '***' : 'NONE'}`);

      const endResolve = () => {
        if (resolved) return;
        resolved = true;
        clearTimers();
        try { ws.close(); } catch { }
        resolve({ cellId, status, execution_count: execCount, outputs });
      };
      const endReject = (err: Error) => {
        if (resolved) return;
        resolved = true;
        clearTimers();
        try { ws.close(); } catch { }
        reject(err);
      };
      const scheduleDrain = (ms: number) => {
        if (drainTimer) clearTimeout(drainTimer);
        drainTimer = setTimeout(endResolve, ms);
      };
      const clearTimers = () => {
        if (drainTimer) clearTimeout(drainTimer);
        if (pingTimer) clearInterval(pingTimer);
        clearTimeout(timeout);
      };

      const timeout = setTimeout(() => {
        endReject(new Error(`WS execution timed out (>${WS_TIMEOUT_MS} ms)`));
      }, WS_TIMEOUT_MS);

      ws.on("open", () => {
        // keep-alive
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try { ws.ping(); } catch { }
          }
        }, PING_INTERVAL_MS);

        // (1) kernel_info to validate channel
        const infoReq = makeMsg("kernel_info_request", {});
        (infoReq.header as any).msg_id = infoMsgId;
        ws.send(JSON.stringify(infoReq));

        // (2) execute request
        const execReq = makeMsg("execute_request", {
          code: codeToSend,
          silent: false,
          store_history: true,
          user_expressions: {},
          allow_stdin: false,
          stop_on_error: true,
        });
        (execReq.header as any).msg_id = execMsgId;
        ws.send(JSON.stringify(execReq));
      });

      ws.on("unexpected-response", (_req, res) => {
        const code = res.statusCode;
        endReject(new Error(`WS upgrade rejected by server (HTTP ${code}). Check JUPYTER_TOKEN / Origin.`));
      });

      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
          const t = msg?.header?.msg_type;
          const content = msg?.content;
          const parentId = msg?.parent_header?.msg_id;
          if (!t || !content) return;

          switch (t) {
            case "kernel_info_reply":
              break;

            case "status":
              if (content.execution_state === "idle") {
                if (sawExecuteReply) scheduleDrain(DRAIN_AFTER_IDLE_MS);
              }
              break;

            case "execute_input":
              if (parentId === execMsgId) execCount = content.execution_count ?? execCount;
              break;

            case "execute_reply":
              if (parentId === execMsgId) {
                sawExecuteReply = true;
                if (content.status === "error") status = "error";
                scheduleDrain(DRAIN_AFTER_REPLY_MS);
              }
              break;

            case "stream": {
              const name = content.name || "stdout";
              const text = typeof content.text === "string"
                ? content.text
                : Array.isArray(content.text) ? content.text.join("") : "";
              let stream = outputs.find((o) => o.output_type === "stream" && o.name === name);
              if (!stream) {
                stream = { output_type: "stream", name, text: [] as string[] };
                outputs.push(stream);
              }
              const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
              for (const line of lines) if (line.length) stream.text.push(line);
              break;
            }

            case "display_data":
              outputs.push({ output_type: "display_data", data: content.data, metadata: content.metadata || {} });
              break;

            case "execute_result":
              outputs.push({
                output_type: "execute_result",
                data: content.data,
                metadata: content.metadata || {},
                execution_count: content.execution_count,
              });
              break;

            case "error":
              status = "error";
              outputs.push({
                output_type: "error",
                ename: content.ename,
                evalue: content.evalue,
                traceback: content.traceback,
              });
              scheduleDrain(DRAIN_AFTER_REPLY_MS);
              break;

            default:
              break;
          }
        } catch (e) {
          console.error("[Gateway] WS parse error:", e);
        }
      });

      ws.on("error", (err) => endReject(new Error(`WebSocket error: ${err.message || String(err)}`)));

      ws.on("close", (code, reason) => {
        if (resolved) return;
        if (sawExecuteReply) endResolve();
        else endReject(new Error(`WebSocket closed early (code ${code}) ${reason?.toString?.() || ""}`));
      });
    });
  }

  async interruptKernel(kernelId: string): Promise<void> {
    await this.ensureGatewayRunning();
    await axios.post(
      `${API_URL}/api/kernels/${encodeURIComponent(kernelId)}/interrupt`,
      {},
      { params: restParams(), timeout: 8_000 }
    );
  }

  async restartKernel(kernelId: string): Promise<void> {
    await this.ensureGatewayRunning();
    await axios.post(
      `${API_URL}/api/kernels/${encodeURIComponent(kernelId)}/restart`,
      {},
      { params: restParams(), timeout: 15_000 }
    );
  }

  async deleteKernel(kernelId: string): Promise<void> {
    await this.ensureGatewayRunning();
    await axios.delete(
      `${API_URL}/api/kernels/${encodeURIComponent(kernelId)}`,
      { params: restParams(), timeout: 8_000 }
    );
  }
}

export const jupyterGateway = new JupyterGateway();
