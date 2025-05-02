#!/usr/bin/env python3

import json
import sys
import io
import traceback
from contextlib import redirect_stdout, redirect_stderr

# Get the code to execute from command line argument
code = sys.argv[1] if len(sys.argv) > 1 else ''

# Get the cell ID from the second argument if provided
cell_id = sys.argv[2] if len(sys.argv) > 2 else 'unknown'

# Storage for results
result = {
    'cell_id': cell_id,
    'status': 'ok',
    'execution_count': 1,
    'outputs': []
}

# Import common modules to make available in the execution environment
try:
    import numpy as np
    import matplotlib
    matplotlib.use('Agg')  # Use non-interactive backend
    import matplotlib.pyplot as plt
    HAS_MATPLOTLIB = True
except ImportError:
    HAS_MATPLOTLIB = False

# Define persistent namespace dictionary
namespace = {}
# Add builtins that might be useful
if HAS_MATPLOTLIB:
    namespace.update({
        'np': np,
        'plt': plt,
        'matplotlib': matplotlib
    })

# Capture stdout and stderr
f_stdout = io.StringIO()
f_stderr = io.StringIO()

try:
    # Redirect stdout and stderr
    with redirect_stdout(f_stdout), redirect_stderr(f_stderr):
        # Execute the code
        exec(code, namespace)
    
    # Get captured output
    stdout_output = f_stdout.getvalue()
    stderr_output = f_stderr.getvalue()
    
    # Add outputs to result
    if stdout_output:
        result['outputs'].append({
            'output_type': 'stream',
            'name': 'stdout',
            'text': stdout_output.splitlines() if stdout_output else []
        })
    
    if stderr_output:
        result['outputs'].append({
            'output_type': 'stream',
            'name': 'stderr',
            'text': stderr_output.splitlines() if stderr_output else []
        })
    
    # If matplotlib is available, check for figures to display
    if HAS_MATPLOTLIB and plt.get_fignums():
        for fig_num in plt.get_fignums():
            fig = plt.figure(fig_num)
            img_data = io.BytesIO()
            fig.savefig(img_data, format='png')
            img_data.seek(0)
            import base64
            result['outputs'].append({
                'output_type': 'display_data',
                'data': {
                    'image/png': base64.b64encode(img_data.getvalue()).decode('utf-8')
                }
            })
            plt.close(fig)
    
    # If there are no outputs, add a success message
    if not result['outputs']:
        result['outputs'].append({
            'output_type': 'stream',
            'name': 'stdout',
            'text': ['Code executed successfully - no output']
        })
        
except Exception as e:
    # Get detailed traceback
    tb_lines = traceback.format_exception(type(e), e, e.__traceback__)
    
    # Handle execution errors
    result['status'] = 'error'
    result['outputs'] = [{
        'output_type': 'error',
        'traceback': tb_lines
    }]

# Print the results as JSON
print(json.dumps(result))
