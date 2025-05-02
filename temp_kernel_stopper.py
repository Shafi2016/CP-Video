
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
