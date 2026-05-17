import express, { Request, Response } from "express";
import crypto from "crypto";
import fs from "fs";
import * as fsp from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { resolveFFmpegExecutable } from "./ffmpeg-utils";
import { voiceService, type Cell, type GeneratedScript, type VoiceOption } from "./services/voice-service";
import { normalizeTeachingProvider, type TeachingProviderName } from "./services/ai-providers";

type VideoFormat = "landscape" | "shorts" | "square";
type NarrationStyle = "educational" | "professional" | "casual";
type NarrationDuration = "short" | "medium" | "long";
type RenderJobStatus = "queued" | "running" | "recording" | "processing" | "complete" | "error";

interface RenderRequestBody {
  cells: Cell[];
  videoFormat?: VideoFormat;
  videoSpeed?: number;
  fontSize?: number;
  voice?: VoiceOption | "none";
  style?: NarrationStyle;
  duration?: NarrationDuration;
  context?: string;
  aiProvider?: TeachingProviderName | "auto";
  aiModel?: string;
}

function normalizeFontSize(fontSize?: number) {
  return Number.isFinite(fontSize) ? Math.max(12, Math.min(28, Math.round(Number(fontSize)))) : 14;
}

interface RenderTimelineItem {
  cellIndex: number;
  startMs: number;
  codeEndMs: number;
  outputStartMs: number;
  endMs: number;
}

interface RenderJob {
  id: string;
  status: RenderJobStatus;
  progress: number;
  message: string;
  error?: string;
  createdAt: number;
  cells: Cell[];
  request: Required<Omit<RenderRequestBody, "cells" | "context" | "aiProvider" | "aiModel">> & {
    context?: string;
    aiProvider?: TeachingProviderName | "auto";
    aiModel?: string;
    frontendOrigin: string;
  };
  script?: GeneratedScript;
  audioPath?: string;
  audioDurationSeconds?: number;
  timeline?: RenderTimelineItem[];
  totalDurationMs?: number;
  downloadUrl?: string;
}

const jobs = new Map<string, RenderJob>();
const serverBootId = crypto.randomUUID();
const serverStartedAt = Date.now();
const uploadsDir = path.resolve(process.cwd(), "uploads");
const videosDir = path.join(uploadsDir, "videos");
const tempRoot = process.env.K_SERVICE ? "/tmp" : path.resolve(process.cwd(), "temp");
const renderJobsDir = path.join(tempRoot, "render-jobs");
const tempDir = path.join(tempRoot, "render-temp");

function ensureDirs() {
  for (const dir of [uploadsDir, videosDir, renderJobsDir, tempDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function getViewport(format: VideoFormat) {
  if (format === "shorts") return { width: 1080, height: 1920 };
  if (format === "square") return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

function publicUploadPathToAbsolute(publicPathValue: string) {
  return path.resolve(process.cwd(), publicPathValue.replace(/^\/+/, ""));
}

function getFfmpegExecutable() {
  return typeof ffmpegStatic === "string" && ffmpegStatic.trim()
    ? ffmpegStatic
    : resolveFFmpegExecutable();
}

function getInternalRenderOrigin() {
  const port = Number(process.env.PORT) || 8080;
  return `http://127.0.0.1:${port}`;
}

async function runProcess(executable: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    proc.stdout.on("data", () => undefined);
    proc.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${path.basename(executable)} exited with code ${code}`));
    });
  });
}

async function convertToMp4(inputWebm: string, outputMp4: string, audioPublicPath?: string) {
  const ffmpegExecutable = getFfmpegExecutable();
  const args = ["-y", "-i", inputWebm];

  if (audioPublicPath) {
    args.push(
      "-i",
      publicUploadPathToAbsolute(audioPublicPath),
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-af",
      "apad",
      "-shortest",
      "-movflags",
      "+faststart",
      outputMp4,
    );
  } else {
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outputMp4,
    );
  }

  await runProcess(getFfmpegExecutable(), args);
}

function typingCharsPerSecond(duration: NarrationDuration, speed: number) {
  const base = duration === "long" ? 15 : duration === "medium" ? 22 : 32;
  const speedFactor = Math.min(1.35, Math.max(0.65, (speed || 50) / 50));
  return base * speedFactor;
}

function estimateCellNarrationMs(job: RenderJob, cellIndex: number) {
  const segments = job.script?.segments || [];
  const matching = segments.filter((segment) => segment.cellIndex === cellIndex);
  const rawMs = matching.reduce((sum, segment) => sum + Math.max(0, segment.estimatedDuration || 0) * 1000, 0);
  const totalEstimatedMs = segments.reduce((sum, segment) => sum + Math.max(0, segment.estimatedDuration || 0) * 1000, 0);
  const actualAudioMs = Math.max(0, (job.audioDurationSeconds || 0) * 1000);
  const scale = totalEstimatedMs > 0 && actualAudioMs > 0 ? actualAudioMs / totalEstimatedMs : 1;
  return Math.max(0, Math.round(rawMs * scale));
}

function buildRenderTimeline(job: RenderJob) {
  const cps = typingCharsPerSecond(job.request.duration, job.request.videoSpeed);
  const outputHoldMs = job.request.duration === "long" ? 6500 : job.request.duration === "medium" ? 4500 : 2500;
  const afterTypingPauseMs = job.request.duration === "long" ? 1200 : job.request.duration === "medium" ? 800 : 450;
  const trailingCodeHoldMs = job.request.duration === "long" ? 1600 : job.request.duration === "medium" ? 1200 : 800;
  const timeline: RenderTimelineItem[] = [];
  let cursorMs = 0;

  job.cells.forEach((cell, cellIndex) => {
    const hasOutput = cell.type === "code" && Array.isArray(cell.outputs) && cell.outputs.length > 0;
    const narrationMs = estimateCellNarrationMs(job, cellIndex);

    if (cell.type === "code") {
      const naturalTypingMs = Math.max(900, Math.ceil((cell.content.length / cps) * 1000));
      const minimumCellMs = naturalTypingMs + (hasOutput ? afterTypingPauseMs + outputHoldMs : trailingCodeHoldMs);
      const totalMs = Math.max(minimumCellMs, narrationMs || 0);
      const narrationLeadMs = Math.min(
        job.request.duration === "long" ? 22_000 : job.request.duration === "medium" ? 16_000 : 10_000,
        Math.max(0, Math.round(totalMs * (job.request.duration === "long" ? 0.08 : job.request.duration === "medium" ? 0.07 : 0.06))),
      );
      const reservedOutputMs = hasOutput
        ? Math.max(
            outputHoldMs,
            Math.min(
              Math.round(totalMs * (job.request.duration === "long" ? 0.22 : job.request.duration === "medium" ? 0.16 : 0.12)),
              job.request.duration === "long" ? 45_000 : job.request.duration === "medium" ? 30_000 : 18_000,
            ),
          )
        : 0;
      const typingMs = hasOutput
        ? Math.max(naturalTypingMs, totalMs - afterTypingPauseMs - reservedOutputMs - narrationLeadMs)
        : Math.max(naturalTypingMs, totalMs - trailingCodeHoldMs - Math.min(narrationLeadMs, trailingCodeHoldMs));
      const codeEndMs = cursorMs + Math.min(totalMs, typingMs);
      const outputStartMs = hasOutput
        ? Math.min(cursorMs + totalMs, codeEndMs + afterTypingPauseMs)
        : cursorMs + totalMs;

      timeline.push({
        cellIndex,
        startMs: cursorMs,
        codeEndMs,
        outputStartMs: Math.max(codeEndMs, outputStartMs),
        endMs: cursorMs + totalMs,
      });
      cursorMs += totalMs;
      return;
    }

    const markdownMs = Math.max(
      job.request.duration === "long" ? 6500 : job.request.duration === "medium" ? 4000 : 2300,
      narrationMs || 0,
    );
    timeline.push({
      cellIndex,
      startMs: cursorMs,
      codeEndMs: cursorMs + markdownMs,
      outputStartMs: cursorMs + markdownMs,
      endMs: cursorMs + markdownMs,
    });
    cursorMs += markdownMs;
  });

  const audioMs = Math.max(0, (job.audioDurationSeconds || 0) * 1000);
  const totalMs = timeline.length ? timeline[timeline.length - 1].endMs : 0;
  if (audioMs > totalMs + 500 && timeline.length > 0) {
    timeline[timeline.length - 1].endMs = audioMs + 1200;
  }

  return timeline;
}

async function persistJob(job: RenderJob) {
  ensureDirs();
  const jobPath = path.join(renderJobsDir, `${job.id}.json`);
  const tempPath = `${jobPath}.${process.pid}.tmp`;
  await fsp.writeFile(tempPath, JSON.stringify(job, null, 2), "utf8");
  await fsp.rename(tempPath, jobPath);
}

async function loadPersistedJob(jobId: string): Promise<RenderJob | null> {
  if (!/^[a-f0-9-]{20,}$/i.test(jobId)) return null;

  const existing = jobs.get(jobId);
  if (existing) return existing;

  try {
    const jobPath = path.join(renderJobsDir, `${jobId}.json`);
    const raw = await fsp.readFile(jobPath, "utf8");
    const job = JSON.parse(raw) as RenderJob;
    if (!job?.id || job.id !== jobId) return null;
    jobs.set(job.id, job);
    return job;
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      console.warn(`[VideoRender] Failed to reload persisted render job ${jobId}:`, error);
    }
    return null;
  }
}

function setJob(job: RenderJob, update: Partial<RenderJob>) {
  Object.assign(job, update);
  jobs.set(job.id, job);
  void persistJob(job).catch(() => undefined);
}

async function resolveRecordedVideoPath(jobTempDir: string, pageVideoPath?: Promise<string>) {
  if (pageVideoPath) {
    return pageVideoPath;
  }

  const candidates: string[] = [];
  async function walk(dir: string) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith(".webm")) {
        candidates.push(fullPath);
      }
    }
  }

  await walk(jobTempDir);
  if (!candidates.length) {
    throw new Error("Playwright did not produce a .webm recording file.");
  }
  return candidates[0];
}

async function runRenderJob(jobId: string) {
  ensureDirs();
  const job = jobs.get(jobId);
  if (!job) return;

  const jobTempDir = path.join(tempDir, job.id);
  await fsp.rm(jobTempDir, { recursive: true, force: true });
  await fsp.mkdir(jobTempDir, { recursive: true });

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    setJob(job, { status: "running", progress: 8, message: "Preparing narration and timeline..." });

    if (job.request.voice !== "none") {
      const narration = await voiceService.generateNarrationAudio(
        {
          cells: job.cells,
          style: job.request.style,
          duration: job.request.duration,
          context: job.request.context,
          aiProvider: job.request.aiProvider,
          aiModel: job.request.aiModel,
        },
        job.request.voice as VoiceOption,
        "mp3",
      );
      setJob(job, {
        script: narration.script,
        audioPath: narration.audioPath,
        audioDurationSeconds: narration.audioDurationSeconds,
        progress: 28,
        message: "Narration generated. Building visual timeline...",
      });
    }

    const timeline = buildRenderTimeline(job);
    const totalDurationMs = timeline.length ? timeline[timeline.length - 1].endMs : 1000;
    setJob(job, { timeline, totalDurationMs, progress: 35, message: "Launching browser renderer..." });

    const viewport = getViewport(job.request.videoFormat);
    browser = await chromium.launch({
      headless: process.env.PLAYWRIGHT_HEADLESS !== "false",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      recordVideo: {
        dir: jobTempDir,
        size: viewport,
      },
    });

    const page = await context.newPage();
    const pageVideo = page.video();
    const pageVideoPath = pageVideo ? pageVideo.path() : undefined;
    let lastBrowserProgressAt = Date.now();
    let lastBrowserProgress = 0;
    let lastBrowserStatus = "created";

    page.on("console", (msg: { text(): string; type(): string }) => {
      const text = msg.text();
      if (!text.startsWith("CP_PROGRESS:")) {
        console.log(`[VideoRender:${job.id}:browser:${msg.type()}] ${text}`);
        return;
      }
      const value = Number(text.replace("CP_PROGRESS:", ""));
      if (!Number.isFinite(value)) return;
      lastBrowserProgressAt = Date.now();
      lastBrowserProgress = value;
      lastBrowserStatus = "recording";
      const mapped = Math.min(88, 35 + value * 0.53);
      setJob(job, { progress: mapped, message: "Recording lesson in browser..." });
    });
    page.on("pageerror", (error) => {
      console.warn(`[VideoRender:${job.id}:pageerror]`, error);
    });
    page.on("requestfailed", (request) => {
      const failure = request.failure();
      console.warn(`[VideoRender:${job.id}:requestfailed] ${request.url()} ${failure?.errorText || ""}`);
    });

    const renderUrl = `${getInternalRenderOrigin()}/render-mode?jobId=${encodeURIComponent(job.id)}`;
    setJob(job, { status: "recording", progress: 38, message: "Recording lesson in browser..." });

    await page.goto(renderUrl, { waitUntil: "networkidle", timeout: 90_000 });
    lastBrowserStatus = "loaded";
    const renderCompletePromise = page.waitForFunction(() => {
      const bodyText = document.body?.innerText || "";
      if ((window as any).__renderComplete === true) {
        return { state: "complete" };
      }
      const renderError = (window as any).__renderError;
      if (renderError) {
        return { state: "render-error", detail: String(renderError).slice(0, 500) };
      }
      if (bodyText.includes("Enter access code") || bodyText.includes("Restricted Access")) {
        return { state: "access-gate", detail: bodyText.slice(0, 500) };
      }
      if (bodyText.includes("Render data fetch failed") || bodyText.includes("Render job data was not ready")) {
        return { state: "render-error", detail: bodyText.slice(0, 500) };
      }
      return false;
    }, undefined, {
      timeout: Math.max(120_000, totalDurationMs + 90_000),
    });
    const watchdogPromise = new Promise<never>((_, reject) => {
      const timer = setInterval(async () => {
        try {
          const state = await page.evaluate(() => ({
            complete: Boolean((window as any).__renderComplete),
            error: (window as any).__renderError ? String((window as any).__renderError) : "",
            nowMs: Number((window as any).__renderNowMs || 0),
            progress: Number((window as any).__renderProgress || 0),
            status: String((window as any).__renderStatus || "unknown"),
          }));
          lastBrowserStatus = state.status;
          if (state.error) {
            clearInterval(timer);
            reject(new Error(`Render page error: ${state.error}`));
          }
          if (!state.complete && Date.now() - lastBrowserProgressAt > 75_000) {
            clearInterval(timer);
            reject(new Error(`Render page stalled at ${state.progress.toFixed(2)}% (${state.nowMs}ms/${totalDurationMs}ms, status=${state.status}, lastConsoleProgress=${lastBrowserProgress.toFixed(2)}%, lastConsoleStatus=${lastBrowserStatus})`));
          }
        } catch (error) {
          clearInterval(timer);
          reject(error);
        }
      }, 5_000);
      void renderCompletePromise.finally(() => clearInterval(timer)).catch(() => undefined);
    });
    const renderStateHandle = await Promise.race([renderCompletePromise, watchdogPromise]);
    const renderState = await renderStateHandle.jsonValue() as { state?: string; detail?: string };
    if (renderState?.state !== "complete") {
      throw new Error(`Render page did not complete: ${renderState?.state || "unknown"} ${renderState?.detail || ""}`.trim());
    }
    await page.waitForTimeout(500);

    await context.close();
    context = null;
    await browser.close();
    browser = null;

    const webmPath = await resolveRecordedVideoPath(jobTempDir, pageVideoPath);
    const mp4Filename = `${job.id}.mp4`;
    const mp4Path = path.join(videosDir, mp4Filename);

    setJob(job, { status: "processing", progress: 90, message: "Muxing video and narration into MP4..." });
    await convertToMp4(webmPath, mp4Path, job.audioPath);

    setJob(job, {
      status: "complete",
      progress: 100,
      message: "Video ready.",
      downloadUrl: `/uploads/videos/${mp4Filename}`,
    });
  } catch (error: any) {
    console.error("[VideoRender] Render failed:", error);
    setJob(job, {
      status: "error",
      progress: 100,
      message: "Render failed.",
      error: error?.message || String(error),
    });
  } finally {
    try {
      await context?.close();
    } catch {
      undefined;
    }
    try {
      await browser?.close();
    } catch {
      undefined;
    }
  }
}

export const videoRenderRouter = express.Router();

videoRenderRouter.post("/render", async (req: Request, res: Response) => {
  ensureDirs();

  const body = req.body as RenderRequestBody;
  if (!Array.isArray(body.cells) || body.cells.length === 0) {
    return res.status(400).json({ error: "No cells were provided for rendering." });
  }

  const protocol = req.protocol || "http";
  const host = req.get("host") || "localhost:8080";

  const job: RenderJob = {
    id: crypto.randomUUID(),
    status: "queued",
    progress: 1,
    message: "Queued for rendering...",
    createdAt: Date.now(),
    cells: body.cells,
    request: {
      videoFormat: body.videoFormat || "landscape",
      videoSpeed: Number.isFinite(body.videoSpeed) ? Number(body.videoSpeed) : 50,
      fontSize: normalizeFontSize(body.fontSize),
      voice: body.voice || "none",
      style: body.style || "educational",
      duration: body.duration || "medium",
      context: body.context?.trim() || undefined,
      aiProvider: body.aiProvider ? normalizeTeachingProvider(body.aiProvider) : undefined,
      aiModel: typeof body.aiModel === "string" && body.aiModel.trim() ? body.aiModel.trim() : undefined,
      frontendOrigin: (process.env.FRONTEND_ORIGIN || process.env.VITE_FRONTEND_ORIGIN || `${protocol}://${host}`).replace(/\/$/, ""),
    },
  };

  jobs.set(job.id, job);

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  void persistJob(job).catch((error) => {
    console.warn("[VideoRender] Failed to persist queued render job:", error);
  });

  setTimeout(() => {
    void runRenderJob(job.id);
  }, 0);

  return res.status(202).json({
    jobId: job.id,
    statusUrl: `/api/video/render/${job.id}`,
    previewUrl: `/render-mode?jobId=${encodeURIComponent(job.id)}`,
  });
});

videoRenderRouter.get("/render/:jobId", async (req: Request, res: Response) => {
  const job = await loadPersistedJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({
      error: "Render job not found.",
      detail: "The render job was not found in this backend process or its local runtime job store. This usually means the Cloud Run revision restarted or a request reached a different instance before the render finished.",
      serverBootId,
      serverStartedAt,
      pid: process.pid,
      knownJobs: jobs.size,
    });
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  return res.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    downloadUrl: job.downloadUrl,
    script: job.script?.fullScript || "",
  });
});

videoRenderRouter.get("/render/:jobId/data", async (req: Request, res: Response) => {
  const job = await loadPersistedJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({
      error: "Render job not found.",
      detail: "The render job was not found in this backend process or its local runtime job store. This usually means the Cloud Run revision restarted or a request reached a different instance before the render finished.",
      serverBootId,
      serverStartedAt,
      pid: process.pid,
      knownJobs: jobs.size,
    });
  }
  if (!job.timeline || !job.totalDurationMs) {
    return res.status(409).json({ error: "Render timeline is not ready yet." });
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  return res.json({
    jobId: job.id,
    cells: job.cells,
    timeline: job.timeline,
    totalDurationMs: job.totalDurationMs,
    audioPath: job.audioPath || null,
    videoFormat: job.request.videoFormat,
    fontSize: job.request.fontSize,
  });
});
