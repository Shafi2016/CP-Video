import json
from jupyter_client import KernelManager

# Create a kernel manager and start a kernel
print("Starting a kernel...")
km = KernelManager(kernel_name='python3')
km.start_kernel()

# Get the connection info
connection_info = km.get_connection_info()
print("Connection info:")

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
print(json.dumps(connection_info_json, indent=2))

# Execute a simple code cell
print("\nExecuting code...")
kc = km.client()
kc.start_channels()

msg_id = kc.execute("print('Hello from Jupyter kernel!')")

# Process the output messages
print("\nOutput:")
while True:
    try:
        msg = kc.get_iopub_msg(timeout=3)
        msg_type = msg['header']['msg_type']
        content = msg['content']
        
        print(f"Message type: {msg_type}")
        
        if msg_type == 'status' and content['execution_state'] == 'idle':
            print("Execution finished.")
            break
        elif msg_type == 'stream':
            print(f"Stream output: {content['text']}")
        elif msg_type == 'execute_result':
            print(f"Execute result: {content['data']}")
        elif msg_type == 'error':
            print(f"Error: {content['traceback']}")
    except:
        print("Timeout or error while getting messages.")
        break

# Clean up
kc.stop_channels()
km.shutdown_kernel()
print("Kernel shutdown.")
