import { useEffect, useMemo, useRef, useState } from "react";
import { PythonHighlightedCode } from "@/components/notebook/PythonHighlightedCode";

interface CellOutput {
  output_type?: string;
  text?: string | string[];
  data?: Record<string, any>;
  traceback?: string[];
  ename?: string;
  evalue?: string;
}

interface Cell {
  id: string;
  type: "code" | "markdown";
  content: string;
  outputs?: CellOutput[];
}

interface TimelineItem {
  cellIndex: number;
  startMs: number;
  codeEndMs: number;
  outputStartMs: number;
  endMs: number;
}

interface RenderData {
  cells: Cell[];
  timeline: TimelineItem[];
  totalDurationMs: number;
  audioPath: string | null;
  videoFormat: "landscape" | "shorts" | "square";
  fontSize?: number;
}

interface RenderTypography {
  codeFontSize: number;
  codeLineHeight: number;
  outputFontSize: number;
  outputLineHeight: number;
  markdownFontSize: number;
  markdownLineHeight: number;
  labelSize: number;
}

function getRenderTypography(videoFormat: RenderData["videoFormat"], fontSize?: number): RenderTypography {
  const safe = Number.isFinite(fontSize) ? Number(fontSize) : 14;
  const scale = Math.max(0.85, Math.min(2.25, safe / 14));
  const isShorts = videoFormat === "shorts";
  const isSquare = videoFormat === "square";
  return {
    codeFontSize: Math.round((isShorts ? 30 : isSquare ? 24 : 20) * scale),
    codeLineHeight: Math.round((isShorts ? 46 : isSquare ? 38 : 32) * scale),
    outputFontSize: Math.round((isShorts ? 24 : isSquare ? 19 : 17) * scale),
    outputLineHeight: Math.round((isShorts ? 36 : isSquare ? 30 : 26) * scale),
    markdownFontSize: Math.round((isShorts ? 30 : isSquare ? 24 : 20) * scale),
    markdownLineHeight: Math.round((isShorts ? 44 : isSquare ? 36 : 32) * scale),
    labelSize: Math.max(11, Math.round(12 * Math.min(scale, 1.4))),
  };
}

function normalizeText(value: any): string {
  if (!value) return "";
  if (Array.isArray(value)) return value.join("\n");
  return String(value);
}

function getOutputText(output: CellOutput): string {
  const direct = normalizeText(output.text);
  const plain = normalizeText(output.data?.["text/plain"]);
  const latex = normalizeText(output.data?.["text/latex"]);
  const error = [output.ename, output.evalue].filter(Boolean).join(": ");
  const traceback = Array.isArray(output.traceback) ? output.traceback.join("\n") : "";
  return [direct, plain, latex, error, traceback].filter(Boolean).join("\n").trim();
}

function getImageSrc(output: CellOutput): string | null {
  const png = normalizeText(output.data?.["image/png"]);
  if (png) return png.startsWith("data:") ? png : `data:image/png;base64,${png}`;

  const jpeg = normalizeText(output.data?.["image/jpeg"]);
  if (jpeg) return jpeg.startsWith("data:") ? jpeg : `data:image/jpeg;base64,${jpeg}`;

  const svg = normalizeText(output.data?.["image/svg+xml"]);
  if (svg) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  return null;
}

function getHtml(output: CellOutput): string | null {
  const html = normalizeText(output.data?.["text/html"]);
  if (!html) return null;
  if (getImageSrc(output)) return null;
  return html;
}

function progressBetween(nowMs: number, startMs: number, endMs: number) {
  if (endMs <= startMs) return 1;
  return Math.min(1, Math.max(0, (nowMs - startMs) / (endMs - startMs)));
}

function easedCodeProgress(progress: number) {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  return Math.min(1, Math.pow(progress, 0.78) * 1.04);
}

function RenderOutput({ outputs, visible, typography }: { outputs?: CellOutput[]; visible: boolean; typography: RenderTypography }) {
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (visible) {
      boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: "auto" });
    }
  }, [visible, outputs]);

  if (!visible || !outputs?.length) return null;

  return (
    <div ref={boxRef} className="mt-4 max-h-[28vh] overflow-y-auto rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 font-semibold uppercase tracking-[0.18em] text-slate-500" style={{ fontSize: `${typography.labelSize}px` }}>Output</div>
      <div className="space-y-4">
        {outputs.map((output, index) => {
          const imgSrc = getImageSrc(output);
          const html = getHtml(output);
          const text = getOutputText(output);

          if (imgSrc) {
            return (
              <div key={index} className="flex justify-center rounded-md border border-slate-200 bg-slate-50 p-3">
                <img src={imgSrc} className="max-h-[40vh] max-w-full rounded-lg object-contain" />
              </div>
            );
          }

          if (html) {
            return (
              <div
                key={index}
                className="overflow-x-auto rounded-md border border-slate-200 bg-white p-4 text-slate-950"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          }

          return (
            <pre key={index} className="whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-4 font-mono text-slate-800" style={{ fontSize: `${typography.outputFontSize}px`, lineHeight: `${typography.outputLineHeight}px` }}>
              {text || "[output]"}
            </pre>
          );
        })}
      </div>
    </div>
  );
}

function CodeCellView({ cell, item, nowMs, isPast, typography }: { cell: Cell; item: TimelineItem; nowMs: number; isPast: boolean; typography: RenderTypography }) {
  const codeBoxRef = useRef<HTMLDivElement | null>(null);
  const codeProgress = isPast ? 1 : easedCodeProgress(progressBetween(nowMs, item.startMs, item.codeEndMs));
  const visibleChars = Math.floor(cell.content.length * codeProgress);
  const visibleCode = cell.content.slice(0, visibleChars);
  const showOutput = isPast || nowMs >= item.outputStartMs;
  const hasOutput = Array.isArray(cell.outputs) && cell.outputs.length > 0;

  useEffect(() => {
    if (codeBoxRef.current) {
      codeBoxRef.current.scrollTop = codeBoxRef.current.scrollHeight;
    }
  }, [visibleCode]);

  return (
    <div className="flex h-full flex-col rounded-lg border-2 border-blue-500 bg-neutral-50 shadow-sm">
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-md bg-neutral-50">
        <div className="w-16 flex-shrink-0 relative bg-neutral-50">
          <div className="absolute left-2 top-2 z-10 text-neutral-500 flex items-center" style={{ fontSize: `${typography.labelSize}px` }}>
            <span className="font-semibold">{`In [${item.cellIndex + 1}]:`}</span>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-6 bg-neutral-50">
          <div ref={codeBoxRef} className={`min-h-[12rem] overflow-y-auto ${showOutput && hasOutput ? "max-h-[34vh]" : "max-h-[56vh] flex-1"}`}>
            <div className="font-mono text-neutral-900" style={{ fontSize: `${typography.codeFontSize}px`, lineHeight: `${typography.codeLineHeight}px` }}>
              <PythonHighlightedCode code={visibleCode} />
            </div>
          </div>
          <RenderOutput outputs={cell.outputs} visible={showOutput} typography={typography} />
        </div>
      </div>
    </div>
  );
}

function MarkdownCellView({ cell, typography }: { cell: Cell; typography: RenderTypography }) {
  return (
    <div className="flex h-full flex-col rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="grid min-h-0 flex-1 grid-cols-[88px_minmax(0,1fr)]">
        <div className="border-r border-slate-200 bg-slate-50 px-3 py-4 text-right font-mono text-slate-500" style={{ fontSize: `${typography.labelSize}px` }}>
          Markdown
        </div>
        <div className="min-h-0 p-5">
          <div className="mb-3 font-semibold uppercase tracking-[0.16em] text-slate-500" style={{ fontSize: `${typography.labelSize}px` }}>Explanation</div>
          <div className="min-h-0 overflow-y-auto whitespace-pre-wrap text-slate-800" style={{ fontSize: `${typography.markdownFontSize}px`, lineHeight: `${typography.markdownLineHeight}px` }}>{cell.content}</div>
        </div>
      </div>
    </div>
  );
}

export default function RenderModePage() {
  const [data, setData] = useState<RenderData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const jobId = new URLSearchParams(window.location.search).get("jobId");

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== "cp-preview-audio-mute") return;
      if (audioRef.current) {
        audioRef.current.muted = Boolean(event.data.muted);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!jobId) {
        setError("Missing jobId in render-mode URL.");
        return;
      }

      for (let attempt = 0; attempt < 600; attempt += 1) {
        const response = await fetch(`/api/video/render/${encodeURIComponent(jobId)}/data`);
        if (response.ok) {
          const json = await response.json();
          if (!cancelled) setData(json);
          return;
        }
        if (response.status !== 409 && response.status !== 404) {
          if (!cancelled) setError(`Render data fetch failed (HTTP ${response.status}).`);
          return;
        }
        if (cancelled) return;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (!cancelled) setError("Render job data was not ready after 10 minutes.");
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  useEffect(() => {
    if (!data) return;

    let raf = 0;
    const start = performance.now();
    const previewAudio = data.audioPath
      ? new Audio(`${data.audioPath}${data.audioPath.includes("?") ? "&" : "?"}previewTs=${Date.now()}`)
      : null;

    audioRef.current = previewAudio;

    if (previewAudio) {
      previewAudio.preload = "auto";
      previewAudio.crossOrigin = "anonymous";
      previewAudio.muted = false;

      const startPlayback = () => {
        void previewAudio.play().catch(() => undefined);
      };

      if (previewAudio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        startPlayback();
      } else {
        previewAudio.addEventListener("canplay", startPlayback, { once: true });
        previewAudio.load();
      }
    }

    const tick = () => {
      const wallElapsed = Math.max(0, Math.round(performance.now() - start));
      const audioElapsed = previewAudio && Number.isFinite(previewAudio.currentTime)
        ? Math.max(0, Math.round(previewAudio.currentTime * 1000))
        : 0;
      const audioClockActive = Boolean(
        previewAudio &&
        !previewAudio.paused &&
        !previewAudio.ended &&
        previewAudio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        audioElapsed > 0,
      );
      const elapsed = audioClockActive
        ? Math.max(audioElapsed, wallElapsed)
        : wallElapsed;
      setNowMs(elapsed);

      const progress = Math.min(100, (elapsed / Math.max(1, data.totalDurationMs)) * 100);
      console.log(`CP_PROGRESS:${progress.toFixed(2)}`);

      if (elapsed >= data.totalDurationMs + 800) {
        (window as any).__renderComplete = true;
        console.log("CP_RENDER_COMPLETE");
        return;
      }

      raf = requestAnimationFrame(tick);
    };

    (window as any).__renderComplete = false;
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (previewAudio) {
        previewAudio.pause();
        previewAudio.src = "";
      }
      if (audioRef.current === previewAudio) {
        audioRef.current = null;
      }
    };
  }, [data]);

  const activeIndex = useMemo(() => {
    if (!data) return -1;
    const current = data.timeline.findIndex((item) => nowMs >= item.startMs && nowMs < item.endMs);
    return current >= 0 ? current : data.timeline.length - 1;
  }, [data, nowMs]);
  const activeItem = useMemo(() => {
    if (!data || activeIndex < 0) return null;
    return data.timeline[activeIndex] ?? null;
  }, [data, activeIndex]);
  const activeCell = useMemo(() => {
    if (!data || !activeItem) return null;
    return data.cells[activeItem.cellIndex] ?? null;
  }, [data, activeItem]);

  const typography = useMemo(() => {
    if (!data) return null;
    return getRenderTypography(data.videoFormat, data.fontSize);
  }, [data]);

  if (error) {
    return <div className="flex h-screen items-center justify-center bg-slate-950 p-10 text-4xl text-red-300">{error}</div>;
  }

  if (!data || !typography) {
    return <div className="flex h-screen items-center justify-center bg-slate-50 p-10 text-3xl text-slate-600">Preparing render...</div>;
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#f7f7f8] text-slate-900">
      <div className="mx-auto flex h-full max-w-[1840px] flex-col gap-4 px-8 py-6">
        <main className="flex min-h-0 flex-1 flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3 text-sm uppercase tracking-[0.16em] text-slate-500">
            <div>{activeItem ? `Step ${activeIndex + 1} of ${data.timeline.length}` : "Preparing step"}</div>
            <div>{Math.min(100, Math.round((nowMs / Math.max(1, data.totalDurationMs)) * 100))}%</div>
          </div>
          <div className="min-h-0 flex-1 bg-white">
            {activeCell && activeItem ? (
              activeCell.type === "code" ? (
                <CodeCellView cell={activeCell} item={activeItem} nowMs={nowMs} isPast={nowMs >= activeItem.endMs} typography={typography} />
              ) : (
                <MarkdownCellView cell={activeCell} typography={typography} />
              )
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
