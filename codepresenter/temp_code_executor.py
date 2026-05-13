
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
connection_info = json.loads('''{"transport":"tcp","ip":"127.0.0.1","shell_port":55994,"iopub_port":55995,"stdin_port":55996,"hb_port":55997,"control_port":55998,"signature_scheme":"hmac-sha256","key":"fb6db541-d993e95e08e34cb3f3bff715"}''')

# Validate ZMQ connection info before proceeding
required = ["ip","shell_port","iopub_port","stdin_port","hb_port","key","transport","signature_scheme"]
missing = [k for k in required if k not in connection_info]
if missing:
    # Return a structured error immediately so JS doesn't hit the 60-min timeout
    sys.stdout = original_stdout
    print(json.dumps({
        "cellId": "6aty1zf82",
        "status": "error",
        "execution_count": None,
        "outputs": [{
            "output_type": "error",
            "traceback": [f"Missing ZMQ fields in connection_info: {missing}. Gateway kernel IDs cannot be used with BlockingKernelClient."]
        }]
    }))
    sys.exit(1)

# Get the code to execute (normalized to support %pip/!pip)
code = '''response = query_engine.query("What is the summary of the document?")
print(str(response))'''

# Apply server-side normalization to ensure %pip/!pip work in all environments
_normalized = '''response = query_engine.query("What is the summary of the document?")
print(str(response))'''
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
        rep = kc.get_shell_msg(timeout=900)
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
            timeout_sec = 1800 if any(pattern in code.lower() for pattern in ['websearchtool', 'requests.', 'urllib', 'httpx', 'aiohttp']) else 900
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
    'cellId': '6aty1zf82',
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
