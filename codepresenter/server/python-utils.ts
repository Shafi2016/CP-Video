/**
 * Python environment utilities to ensure consistent Python execution
 * across Windows and other platforms.
 */
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

function resolveWindowsPythonExecutable(): string {
  const condaPrefix = process.env.CONDA_PREFIX;
  const condaPython = condaPrefix ? path.join(condaPrefix, 'python.exe') : undefined;
  const condaScriptsPython = condaPrefix ? path.join(condaPrefix, 'Scripts', 'python.exe') : undefined;

  const userProfile = process.env.USERPROFILE;
  const userAnacondaPython = userProfile ? path.join(userProfile, 'anaconda3', 'python.exe') : undefined;
  const userMinicondaPython = userProfile ? path.join(userProfile, 'miniconda3', 'python.exe') : undefined;

  const candidates = [
    process.env.PYTHON_EXECUTABLE,
    process.env.PYTHON_EXE,
    condaPython,
    condaScriptsPython,
    userAnacondaPython,
    userMinicondaPython,
    'F:\\Anaconda\\envs\\trends\\python.exe',
    'F:\\Anaconda\\python.exe',
    'python'
  ].filter((value): value is string => Boolean(value && value.trim()));

  const fallbackCommands = new Set(['python', 'python3', 'py']);
  let lastFallbackCommand: string | undefined;

  for (const candidate of candidates) {
    const resolved = candidate.trim();
    const looksLikePath = resolved.includes('\\') || resolved.includes('/') || /^[a-zA-Z]:/.test(resolved);

    if (!looksLikePath) {
      const normalized = resolved.toLowerCase();
      if (fallbackCommands.has(normalized)) {
        lastFallbackCommand = resolved;
        continue;
      }
      return resolved;
    }

    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  return lastFallbackCommand || 'python';
}

// Python executable path configuration for consistent environment usage
// In Cloud Run or production, always use python3. In Windows dev, use Anaconda if available
export const PYTHON_EXECUTABLE = (() => {
  // Check if we're in Cloud Run or container environment
  if (process.env.K_SERVICE || process.env.NODE_ENV === 'production') {
    return 'python3';
  }
  
  // Local development - use platform-specific paths
  return process.platform === 'win32' 
    ? resolveWindowsPythonExecutable()
    : 'python3';
})();

// FFmpeg executable path configuration
export const FFMPEG_EXECUTABLE = process.platform === 'win32'
  ? 'C:\\ProgramData\\anaconda3\\Library\\bin\\ffmpeg.exe'
  : '/usr/bin/ffmpeg';

// Kernel name constant
export const DEFAULT_KERNEL_NAME = 'python3';

// Helper function to check if a Python package is installed in the current environment
export async function checkPythonPackageInstalled(packageName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const command = `${PYTHON_EXECUTABLE} -c "import ${packageName}; print('OK')"`;
    
    exec(command, (error: any, stdout: string, stderr: string) => {
      if (error || stderr) {
        console.log(`Package ${packageName} is not available: ${stderr || error?.message}`);
        resolve(false);
        return;
      }
      
      console.log(`Package ${packageName} is available`);
      resolve(true);
    });
  });
}

// Helper function to check if FFmpeg is available and configured
export async function checkFFmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const command = process.platform === 'win32'
      ? `"${FFMPEG_EXECUTABLE}" -version`
      : `${FFMPEG_EXECUTABLE} -version`;
    
    exec(command, (error: any, stdout: string, stderr: string) => {
      if (error) {
        console.log(`FFmpeg is not available: ${error.message}`);
        resolve(false);
        return;
      }
      
      console.log(`FFmpeg is available: ${stdout.split('\n')[0]}`);
      resolve(true);
    });
  });
}

// Creates a Python script to configure FFmpeg for pydub and other libraries
export async function createFFmpegConfigScript(outputDir: string): Promise<string> {
  const scriptPath = path.join(outputDir, 'configure_ffmpeg.py');
  const scriptContent = `
# FFmpeg configuration script for pydub and manim
import os
import sys

# Set FFmpeg paths for pydub
os.environ['FFMPEG_BINARY'] = r'${FFMPEG_EXECUTABLE.replace(/\\/g, '\\\\')}'
os.environ['IMAGEIO_FFMPEG_EXE'] = r'${FFMPEG_EXECUTABLE.replace(/\\/g, '\\\\')}'

# Print configuration info
print(f"FFmpeg configured with path: {os.environ['FFMPEG_BINARY']}")
print(f"Python executable: {sys.executable}")

# Attempt to import key packages with the configuration
try:
    import pydub
    print(f"Pydub imported successfully")
except ImportError as e:
    print(f"Pydub import error: {e}")

try:
    # This will use the configured FFmpeg path
    from pydub.utils import get_encoder_name
    print(f"FFmpeg encoder: {get_encoder_name()}")
except Exception as e:
    print(f"FFmpeg detection error: {e}")
`;

  fs.writeFileSync(scriptPath, scriptContent);
  return scriptPath;
}
