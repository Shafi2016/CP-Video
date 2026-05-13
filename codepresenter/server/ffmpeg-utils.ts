import * as fs from "fs";
import * as path from "path";

type FFTool = "ffmpeg" | "ffprobe";

function exeName(tool: FFTool): string {
  return process.platform === "win32" ? `${tool}.exe` : tool;
}

function collectNestedCandidates(rootDir: string, tool: FFTool): string[] {
  const candidates: string[] = [];
  const exe = exeName(tool);

  const envsDir = path.join(rootDir, "envs");
  if (fs.existsSync(envsDir)) {
    try {
      for (const entry of fs.readdirSync(envsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        candidates.push(path.join(envsDir, entry.name, "Library", "bin", exe));
        candidates.push(path.join(envsDir, entry.name, "Scripts", exe));
        if (process.platform !== "win32") {
          candidates.push(path.join(envsDir, entry.name, "bin", tool));
        }
      }
    } catch {
      // ignore unreadable env directories
    }
  }

  const pkgsDir = path.join(rootDir, "pkgs");
  if (fs.existsSync(pkgsDir)) {
    try {
      for (const entry of fs.readdirSync(pkgsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.toLowerCase().startsWith("ffmpeg")) continue;
        candidates.push(path.join(pkgsDir, entry.name, "Library", "bin", exe));
        if (process.platform !== "win32") {
          candidates.push(path.join(pkgsDir, entry.name, "bin", tool));
        }
      }
    } catch {
      // ignore unreadable package directories
    }
  }

  return candidates;
}

function resolveExecutable(tool: FFTool): string {
  const envVars =
    tool === "ffmpeg"
      ? ["FFMPEG_BINARY", "IMAGEIO_FFMPEG_EXE", "FFMPEG_PATH", "FFMPEG_EXECUTABLE"]
      : ["FFPROBE_BINARY", "FFPROBE_PATH", "FFPROBE_EXECUTABLE"];

  for (const name of envVars) {
    const value = process.env[name]?.trim();
    if (!value) continue;
    if (fs.existsSync(value)) return value;
    // Bare command name supplied via env — return it even if fs.existsSync fails
    // (PATH resolution will handle it when spawn runs).
    if (!value.includes(path.sep) && !value.includes("/") && !/^[a-zA-Z]:/.test(value)) {
      return value;
    }
  }

  // For ffprobe, try deriving from a resolved ffmpeg env var — they almost
  // always live in the same directory.
  if (tool === "ffprobe") {
    const ffmpegEnv =
      process.env.FFMPEG_BINARY
      || process.env.IMAGEIO_FFMPEG_EXE
      || process.env.FFMPEG_PATH
      || process.env.FFMPEG_EXECUTABLE;
    if (ffmpegEnv && (ffmpegEnv.includes(path.sep) || ffmpegEnv.includes("/"))) {
      const guess = path.join(path.dirname(ffmpegEnv), exeName("ffprobe"));
      if (fs.existsSync(guess)) return guess;
    }
  }

  const exe = exeName(tool);
  const condaPrefix = process.env.CONDA_PREFIX?.trim();
  const userProfile = process.env.USERPROFILE?.trim();
  const home = process.env.HOME?.trim();

  const condaRootCandidates = Array.from(
    new Set(
      [
        condaPrefix
          ? path.basename(path.dirname(condaPrefix)).toLowerCase() === "envs"
            ? path.dirname(path.dirname(condaPrefix))
            : condaPrefix
          : undefined,
        "C:\\ProgramData\\anaconda3",
        "C:\\ProgramData\\miniconda3",
        userProfile ? path.join(userProfile, "anaconda3") : undefined,
        userProfile ? path.join(userProfile, "miniconda3") : undefined,
        home ? path.join(home, "anaconda3") : undefined,
        home ? path.join(home, "miniconda3") : undefined,
      ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim()))
    )
  );

  const nestedCandidates = condaRootCandidates.flatMap((rootDir) =>
    collectNestedCandidates(rootDir, tool)
  );

  const candidates = [
    condaPrefix ? path.join(condaPrefix, "Library", "bin", exe) : undefined,
    condaPrefix ? path.join(condaPrefix, "Scripts", exe) : undefined,
    condaPrefix && process.platform !== "win32" ? path.join(condaPrefix, "bin", tool) : undefined,
    "C:\\ProgramData\\anaconda3\\envs\\gpu\\Library\\bin\\" + exe,
    "C:\\ProgramData\\anaconda3\\Library\\bin\\" + exe,
    userProfile ? path.join(userProfile, "anaconda3", "Library", "bin", exe) : undefined,
    userProfile ? path.join(userProfile, "miniconda3", "Library", "bin", exe) : undefined,
    ...nestedCandidates,
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim()));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  // Last resort: rely on PATH lookup at spawn time.
  return tool;
}

export function resolveFFmpegExecutable(): string {
  return resolveExecutable("ffmpeg");
}

export function resolveFFprobeExecutable(): string {
  return resolveExecutable("ffprobe");
}

export function formatFFmpegSpawnError(executable: string, error: any): string {
  if (error?.code === "ENOENT") {
    return `FFmpeg/ffprobe executable not found. Resolved executable: ${executable}. Install FFmpeg or set FFMPEG_BINARY, IMAGEIO_FFMPEG_EXE, FFMPEG_PATH, or FFMPEG_EXECUTABLE to the full ffmpeg path.`;
  }
  return error?.message || `Failed to launch process using ${executable}`;
}
