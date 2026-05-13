import { useState, useRef, useCallback, useEffect } from "react";
import { Cell } from "@/types";
import { Video, Square, Download, Loader2, Play, AlertCircle, CheckCircle2, Mic, MicOff, Volume2, VolumeX, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { domToCanvas } from "modern-screenshot";

interface VideoRecorderProps {
  cells: Cell[];
  presentationSpeed?: number;
  onClose?: () => void;
  onRunAll?: (options?: { skipPresentation?: boolean }) => Promise<Cell[]>; // Run all cells before recording and return updated cells
  fontSize?: number; // Font size in px from View menu
}

interface TeachingProviderStatus {
  activeProvider: string;
  model: string;
  label: string;
  configured: boolean;
}

// Timing constants matching CodeCell.tsx
const PAUSE_BEFORE_EXEC = 500;
const PAUSE_AFTER_CELL = 1500;
const PAUSE_AFTER_MARKDOWN = 2500;

// Fixed instructor typing delay (ms per character) — used only when there
// is no narration audio. With narration, typing pace is derived from each
// cell's narration segment so the visual stays in lock-step with the audio.
const INSTRUCTOR_TYPING_DELAY_MS: Record<NarrationDuration, number> = {
  short: 95,
  medium: 130,
  long: 170,
};

// Human-readable typing pace bounds (ms per character). Used to clamp the
// pace derived from each narration segment so the on-screen typing never
// looks instant nor painfully slow.
const MIN_CHAR_DELAY_MS = 70;
const MAX_CHAR_DELAY_MS = 180;

function estimateOutputExplainHoldMs(cell: Cell, duration: NarrationDuration): number {
  if (cell.type !== "code") return 0;

  const outputs = cell.outputs || [];
  const outputText = outputs
    .map((out: any) => extractOutputText(out))
    .filter(Boolean)
    .join("\n");

  const lineCount = outputText
    ? outputText.split(/\r?\n/).filter(line => line.trim()).length
    : 0;

  const hasImage = outputs.some((out: any) => !!extractOutputImageData(out));

  const base =
    duration === "long" ? 9000 :
    duration === "medium" ? 5500 :
    2500;

  const perLine =
    duration === "long" ? 900 :
    duration === "medium" ? 500 :
    250;

  const imageBonus = hasImage
    ? duration === "long" ? 5000 : duration === "medium" ? 3000 : 1500
    : 0;

  const maxHold =
    duration === "long" ? 26000 :
    duration === "medium" ? 15000 :
    7000;

  return Math.min(maxHold, base + Math.min(lineCount, 12) * perLine + imageBonus);
}

type RecordingStatus = "idle" | "running" | "preparing" | "recording" | "processing" | "complete" | "error" | "generating_voice";

type VoiceOption = "none" | "cedar" | "marin" | "alloy" | "ash" | "ballad" | "coral" | "rachel" | "adam" | "antoni" | "bella" | "josh" | "elli" | "haytham" | "marcotrox";
type NarrationStyle = "educational" | "professional" | "casual";
type NarrationDuration = "short" | "medium" | "long";
type VideoFormat = "landscape" | "shorts";

const INSTRUCTOR_PACING_MS: Record<NarrationDuration, {
  beforeExec: number;
  outputBase: number;
  outputPerLine: number;
  outputMax: number;
  markdown: number;
}> = {
  short: {
    beforeExec: 900,
    outputBase: 3000,
    outputPerLine: 350,
    outputMax: 7000,
    markdown: 3000,
  },
  medium: {
    beforeExec: 1500,
    outputBase: 6500,
    outputPerLine: 700,
    outputMax: 15000,
    markdown: 5500,
  },
  long: {
    beforeExec: 2400,
    outputBase: 10000,
    outputPerLine: 1100,
    outputMax: 26000,
    markdown: 9000,
  },
};

function getInstructorTypingDelayMs(detail: NarrationDuration): number {
  return INSTRUCTOR_TYPING_DELAY_MS[detail] ?? INSTRUCTOR_TYPING_DELAY_MS.medium;
}

const clampNumber = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function getInstructorPacing(detail: NarrationDuration) {
  return INSTRUCTOR_PACING_MS[detail] ?? INSTRUCTOR_PACING_MS.medium;
}

const VOICE_OPTIONS: Array<{ value: Exclude<VoiceOption, "none"> | "none"; label: string }> = [
  { value: "none", label: "No AI voice (silent video)" },
  { value: "cedar", label: "Cedar (OpenAI, best quality)" },
  { value: "marin", label: "Marin (OpenAI, confident)" },
  { value: "alloy", label: "Alloy (OpenAI, neutral)" },
  { value: "coral", label: "Coral (OpenAI, warm)" },
  { value: "ash", label: "Ash (OpenAI, soft)" },
  { value: "ballad", label: "Ballad (OpenAI, expressive)" },
  { value: "rachel", label: "Rachel (ElevenLabs)" },
  { value: "adam", label: "Adam (ElevenLabs)" },
  { value: "antoni", label: "Antoni (ElevenLabs)" },
  { value: "bella", label: "Bella (ElevenLabs)" },
  { value: "josh", label: "Josh (ElevenLabs)" },
  { value: "elli", label: "Elli (ElevenLabs)" },
  { value: "haytham", label: "Haytham (ElevenLabs)" },
  { value: "marcotrox", label: "Marcotrox (ElevenLabs)" },
];

interface VoiceSegment {
  cellIndex: number;
  script: string;
  audioPath?: string;
  estimatedDuration: number;
}

type OutputImageData = { dataUrl: string; kind: string };

const normalizeOutputValue = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value.join("") : (value || "");

// For text outputs only.
// Some notebook runners give output chunks as an array without newline separators.
// Joining with "" can create ugly output like: 0Train shape: ...Test shape: ...
const normalizeTextOutputValue = (value: string | string[] | undefined): string => {
  if (!value) return "";

  if (Array.isArray(value)) {
    const joined = value.join("");

    // If chunks already contain newlines, keep original behavior.
    if (joined.includes("\n")) return joined;

    // Otherwise separate chunks line by line.
    return value.join("\n");
  }

  return String(value);
};

interface PlainTextTable {
  headers: string[];
  rows: string[][];
  before: string[];
  after: string[];
}

interface CachedOutputData {
  outputImages: OutputImageData[];
  outputText: string;
  rawOutputLines: string[];
  nonEmptyOutputLines: string[];
  plainTextTable: PlainTextTable | null;
}

const splitPlainTableLine = (line: string): string[] =>
  line.trim().split(/\s{2,}/).filter(Boolean);

const estimateNarrationSpeechUnits = (script: string): number => {
  const normalized = script.replace(/\s+/g, " ").trim();
  if (!normalized) return 1;

  const words = normalized.split(" ").filter(Boolean).length;
  const sentenceBreaks = (normalized.match(/[.!?]+/g) || []).length;
  const clauseBreaks = (normalized.match(/[,:;]+/g) || []).length;
  const lineBreaks = (script.match(/\n+/g) || []).length;

  return Math.max(1, words + sentenceBreaks * 5 + clauseBreaks * 2 + lineBreaks * 3);
};

function parsePlainTextTable(lines: string[]): PlainTextTable | null {
  const firstTableLineIndex = lines.findIndex(line => {
    const parts = splitPlainTableLine(line);
    return parts.length >= 4;
  });

  if (firstTableLineIndex < 0) return null;

  let endIndex = firstTableLineIndex;

  while (endIndex < lines.length) {
    const parts = splitPlainTableLine(lines[endIndex]);

    if (parts.length < 4) break;
    endIndex++;
  }

  const tableLines = lines
    .slice(firstTableLineIndex, endIndex)
    .filter(line => line.trim().length > 0);

  if (tableLines.length < 2) return null;

  let headers = splitPlainTableLine(tableLines[0]);

  let rows = tableLines
    .slice(1)
    .map(splitPlainTableLine)
    .filter(parts => parts.length >= 3);

  if (!rows.length) return null;

  const maxCols = Math.max(headers.length, ...rows.map(row => row.length));

  // Pandas printed tables often have an index column in rows but not in header.
  if (rows.some(row => row.length === headers.length + 1)) {
    headers = ["", ...headers];
  }

  while (headers.length < maxCols) headers.push("");

  rows = rows.map(row => {
    const fixed = [...row];
    while (fixed.length < maxCols) fixed.push("");
    return fixed.slice(0, maxCols);
  });

  return {
    headers: headers.slice(0, maxCols),
    rows,
    before: lines.slice(0, firstTableLineIndex).filter(line => line.trim().length > 0),
    after: lines.slice(endIndex).filter(line => line.trim().length > 0),
  };
}

function extractOutputImageData(output: any): OutputImageData | null {
  const png = output?.data?.["image/png"] as string | undefined;
  if (png) {
    return { dataUrl: `data:image/png;base64,${png}`, kind: "png" };
  }

  const jpeg = output?.data?.["image/jpeg"] as string | undefined;
  if (jpeg) {
    return { dataUrl: `data:image/jpeg;base64,${jpeg}`, kind: "jpeg" };
  }

  const svgRaw = normalizeOutputValue(output?.data?.["image/svg+xml"] as string | string[] | undefined);
  if (svgRaw) {
    if (svgRaw.startsWith("data:image/svg+xml")) {
      return { dataUrl: svgRaw, kind: "svg" };
    }
    return {
      dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgRaw)}`,
      kind: "svg",
    };
  }

  const htmlRaw = normalizeOutputValue(output?.data?.["text/html"] as string | string[] | undefined);
  if (htmlRaw) {
    const imageMatch = htmlRaw.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imageMatch && imageMatch[1] && imageMatch[1].startsWith("data:image/")) {
      return { dataUrl: imageMatch[1], kind: "htmlimg" };
    }

    const svgMatch = htmlRaw.match(/<svg[\s\S]*?<\/svg>/i);
    if (svgMatch && svgMatch[0]) {
      return {
        dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMatch[0])}`,
        kind: "htmlsvg",
      };
    }

    if (htmlRaw.includes("<table") && (htmlRaw.includes("dataframe") || htmlRaw.includes("table"))) {
      return { dataUrl: htmlRaw, kind: "htmltable" };
    }
  }

  return null;
}

function extractOutputText(output: any): string {
  const chunks: string[] = [];

  const directText = output?.text;
  if (directText) {
    chunks.push(normalizeTextOutputValue(directText));
  }

  const plain = normalizeTextOutputValue(output?.data?.["text/plain"] as string | string[] | undefined);
  if (plain) {
    chunks.push(plain);
  }

  const latex = normalizeTextOutputValue(output?.data?.["text/latex"] as string | string[] | undefined);
  if (latex) {
    chunks.push(latex);
  }

  if (!chunks.length) {
    const htmlRaw = normalizeOutputValue(output?.data?.["text/html"] as string | string[] | undefined);
    if (htmlRaw && !extractOutputImageData(output)) {
      const stripped = htmlRaw
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim();
      if (stripped) {
        chunks.push(stripped);
      }
    }
  }

  if (output?.traceback) {
    chunks.push(output.traceback.join("\n"));
  }

  return chunks.join("\n").trim();
}

function getCellOutputHoldMs(cell: Cell, detail: NarrationDuration): number {
  if (cell.type !== "code") return 0;

  const outputs = cell.outputs || [];
  if (!outputs.length) {
    return detail === "long" ? 3500 : detail === "medium" ? 2200 : 1200;
  }

  const pacing = getInstructorPacing(detail);

  const outputText = outputs
    .map((out: any) => extractOutputText(out))
    .filter(Boolean)
    .join("\n");

  const lineCount = outputText
    ? outputText.split(/\r?\n/).filter(line => line.trim().length > 0).length
    : 0;

  const hasImageOutput = outputs.some((out: any) => !!extractOutputImageData(out));

  const imageBonus = hasImageOutput
    ? detail === "long"
      ? 5000
      : detail === "medium"
        ? 3500
        : 1800
    : 0;

  const outputHold = pacing.outputBase +
    Math.min(lineCount, 12) * pacing.outputPerLine +
    imageBonus;

  return Math.min(pacing.outputMax, outputHold);
}

export default function VideoRecorder({ cells, presentationSpeed = 50, onClose, onRunAll, fontSize = 14 }: VideoRecorderProps) {
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [currentCellIndex, setCurrentCellIndex] = useState(-1);
  const [displayedCode, setDisplayedCode] = useState("");
  const [showOutput, setShowOutput] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);

  const [videoFormat, setVideoFormat] = useState<VideoFormat>("landscape");

  const [enableVoice, setEnableVoice] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<VoiceOption>("cedar");
  const [narrationStyle, setNarrationStyle] = useState<NarrationStyle>("educational");
  const [narrationDuration, setNarrationDuration] = useState<NarrationDuration>("medium");
  const [voiceSegments, setVoiceSegments] = useState<VoiceSegment[]>([]);
  const [generatedScript, setGeneratedScript] = useState<string>("");
  const [voiceProgress, setVoiceProgress] = useState(0);
  const [narrationInstructions, setNarrationInstructions] = useState<string>("");
  const [renderStatusMessage, setRenderStatusMessage] = useState<string>("");
  const [renderPreviewUrl, setRenderPreviewUrl] = useState<string | null>(null);
  const [hqPreviewMuted, setHqPreviewMuted] = useState(false);
  const [teachingProvider, setTeachingProvider] = useState<TeachingProviderStatus | null>(null);

  const hasVoiceNarration = enableVoice && selectedVoice !== "none";

  useEffect(() => {
    let cancelled = false;
    fetch("/api/voice/provider", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!cancelled && data) setTeachingProvider(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Fullscreen toggle state
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Mute toggle — uses ref (not state) to avoid React re-renders during recording
  // React re-renders disrupt MediaRecorder frame capture in exported videos
  const isMutedRef = useRef(false);
  const muteButtonRef = useRef<HTMLButtonElement>(null);

  // Check if cells have outputs (user should run cells first)
  const hasOutputs = cells.some(c => c.type === "code" && c.outputs && c.outputs.length > 0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number>();
  const startTimeRef = useRef<number>(0);
  const totalDurationRef = useRef<number>(0);
  const lastDataRequestRef = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioEndedAtRef = useRef<number | null>(null); // Track when audio ended for auto-stop timing
  const gainNodeRef = useRef<GainNode | null>(null); // GainNode for speaker mute control (same Web Audio graph)
  const lastRenderedFrameRef = useRef<{ cellIndex: number; code: string; showOutput: boolean; cell: Cell | null }>({
    cellIndex: -1,
    code: "",
    showOutput: false,
    cell: null,
  });

  // Keep latest cells while idle; recording flow snapshots cells explicitly.
  const cellsRef = useRef(cells);
  useEffect(() => {
    if (status === "idle") {
      cellsRef.current = cells;
    }
  }, [cells, status]);

  // Cache for image outputs so we don't reload them every frame
  const imageCacheRef = useRef<Map<string, { img: HTMLImageElement; loaded: boolean; error?: any }>>(new Map());
  const outputDataCacheRef = useRef<Map<string, CachedOutputData>>(new Map());

  const getCachedOutputData = useCallback((cell: Cell | null): CachedOutputData => {
    if (!cell || cell.type !== "code") {
      return {
        outputImages: [],
        outputText: "",
        rawOutputLines: [],
        nonEmptyOutputLines: [],
        plainTextTable: null,
      };
    }

    const cacheKey = cell.id || `cell-${cell.execution_count ?? "unknown"}`;
    const existing = outputDataCacheRef.current.get(cacheKey);
    if (existing) return existing;

    const outputs = cell.outputs || [];
    const outputImages = outputs
      .map((out: any) => extractOutputImageData(out))
      .filter(Boolean) as OutputImageData[];
    const outputText = outputs
      .map((out: any) => extractOutputText(out))
      .filter(Boolean)
      .join("\n");
    const rawOutputLines = outputText
      ? outputText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
      : [];
    const nonEmptyOutputLines = rawOutputLines.filter(line => line.trim().length > 0);
    const plainTextTable = parsePlainTextTable(rawOutputLines);

    const nextValue: CachedOutputData = {
      outputImages,
      outputText,
      rawOutputLines,
      nonEmptyOutputLines,
      plainTextTable,
    };
    outputDataCacheRef.current.set(cacheKey, nextValue);
    return nextValue;
  }, []);

  // Calculate total duration
  const calculateTotalDuration = useCallback(() => {
    const typingDelay = getInstructorTypingDelayMs(narrationDuration);
    const pacing = getInstructorPacing(narrationDuration);

    let total = 0;

    for (const cell of cells) {
      if (cell.type === "code") {
        const typeDuration = cell.content.length * typingDelay;
        const outputHold = getCellOutputHoldMs(cell, narrationDuration);
        total += typeDuration + pacing.beforeExec + outputHold;
      } else {
        total += pacing.markdown;
      }
    }

    return total;
  }, [cells, narrationDuration]);

  // Draw frame to canvas
  const drawFrame = useCallback((
    ctx: CanvasRenderingContext2D,
    cellIndex: number,
    code: string,
    showOut: boolean,
    cell: Cell | null,
    outputProgress = 1
  ) => {
    const canvas = ctx.canvas;
    const width = canvas.width;
    const height = canvas.height;

    const isShorts = height > width;
    const fontScale = fontSize / 14; // Scale relative to default 14px
    const headerTitleSize = isShorts ? 34 : 28;
    const headerMetaSize = isShorts ? 20 : 16;
    const codeFontSize = Math.round((isShorts ? 34 : 22) * fontScale);
    const codeLineHeight = Math.round((isShorts ? 52 : 34) * fontScale);
    const outputFontSize = Math.round((isShorts ? 24 : 15) * fontScale);
    const outputLineHeight = Math.round((isShorts ? 36 : 24) * fontScale);
    const outputLabelSize = isShorts ? 18 : 14;

    // Background - clean white for better contrast
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Header - Light warm gray
    ctx.fillStyle = "#f0eeeb";
    ctx.fillRect(0, 0, width, 80);

    // CP Logo badge - orange rounded rect with white "CP" text
    const logoSize = isShorts ? 44 : 36;
    const logoX = 24;
    const logoY = 40 - logoSize / 2;
    const logoRadius = 8;
    ctx.fillStyle = "#c96442"; // Coral/orange
    ctx.beginPath();
    ctx.roundRect(logoX, logoY, logoSize, logoSize, logoRadius);
    ctx.fill();
    // "CP" text inside the badge
    const cpFontSize = isShorts ? 22 : 18;
    ctx.font = `bold ${cpFontSize}px 'Inter', system-ui, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("CP", logoX + logoSize / 2, logoY + logoSize / 2);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";

    // Title text after logo
    const titleX = logoX + logoSize + 12;
    ctx.font = `bold ${headerTitleSize}px 'Inter', system-ui, sans-serif`;
    ctx.fillStyle = "#c96442"; // Anthropic coral
    ctx.fillText("CodePresenter", titleX, 52);

    ctx.font = `${headerMetaSize}px 'Inter', system-ui, sans-serif`;
    ctx.fillStyle = "#6b6560"; // Warm gray text
    ctx.fillText(`Cell ${cellIndex + 1} of ${cells.length}`, width - 180, 52);

    if (cellIndex < 0 || !cell) {
      // If no active cell yet, just render the empty code/output frame without intro text
      // This avoids a long intro slate at the start of the video
      cell = cells[0] || null as any;
      if (!cell) return;
    }

    // Code area
    const codeAreaY = 120;
    const bottomMargin = 40;
    const gapBetween = 30;
    const availableBelow = Math.max(0, height - codeAreaY - bottomMargin);

    const outputs = cell.type === "code" ? (cell.outputs || []) : [];
    const cachedOutputData = getCachedOutputData(cell);
    const outputImages = cachedOutputData.outputImages;
    const outputHasImage = outputImages.length > 0;
    const outputText = showOut && outputs.length ? cachedOutputData.outputText : "";

    // ---------- Responsive output measurement + layout ----------
    // The old logic made output height depend mostly on line count.
    // That fails for dataframe/text-table output because a few very wide lines
    // need more space and smaller font, not character-wrapping.
    const outputBoxWidth = width - 80;
    const outputInnerX = 60;
    const outputInnerW = Math.max(1, outputBoxWidth - 40);

    const rawOutputLines = showOut ? cachedOutputData.rawOutputLines : [];

    const nonEmptyOutputLines = showOut ? cachedOutputData.nonEmptyOutputLines : [];

    // Detect plain-text dataframe/table output such as print(df.head()).
    // These should not be character-wrapped because wrapping destroys columns.
    const tableLikeLineCount = nonEmptyOutputLines.filter(
      line => line.trim().split(/\s{2,}/).length >= 3
    ).length;

    const looksLikePlainTable = tableLikeLineCount >= 2;

    ctx.font = `${outputFontSize}px 'Fira Code', monospace`;
    const longestRawLineWidth = rawOutputLines.reduce(
      (max, line) => Math.max(max, ctx.measureText(line).width),
      1
    );

    // Shrink table text if needed so dataframe columns stay aligned.
    let effectiveOutputFontSize = outputFontSize;
    if (looksLikePlainTable && longestRawLineWidth > outputInnerW) {
      const minReadableFont = isShorts ? 16 : 10;
      effectiveOutputFontSize = Math.max(
        minReadableFont,
        Math.floor(outputFontSize * (outputInnerW / longestRawLineWidth))
      );
    }

    effectiveOutputFontSize = Math.min(outputFontSize, effectiveOutputFontSize);
    const effectiveOutputLineHeight = Math.round(
      effectiveOutputFontSize * (isShorts ? 1.45 : 1.55)
    );

    ctx.font = `${effectiveOutputFontSize}px 'Fira Code', monospace`;

    const wrapLineToWidth = (line: string): string[] => {
      if (!line) return [""];
      const out: string[] = [];
      let rest = line;
      while (rest.length > 0) {
        let lo = 1;
        let hi = rest.length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          const w = ctx.measureText(rest.slice(0, mid)).width;
          if (w <= outputInnerW) lo = mid;
          else hi = mid - 1;
        }
        const take = Math.max(1, lo);
        out.push(rest.slice(0, take));
        rest = rest.slice(take);
      }
      return out;
    };
    // For dataframe-like plain text, preserve rows/columns.
    // For normal text, wrap naturally.
    const renderedOutputLines: string[] = looksLikePlainTable
      ? rawOutputLines
      : rawOutputLines.flatMap(wrapLineToWidth);

    const plainTextTable = parsePlainTextTable(rawOutputLines);
    const hasPlainTextTable = !!plainTextTable;

    const outputNeedsLargeArea =
      outputHasImage ||
      renderedOutputLines.length > 8 ||
      (longestRawLineWidth > outputInnerW * 1.4 && !hasPlainTextTable);

    let outputHeight = 0;
    if (showOut) {
      // Give output prominent space — reduce code min height so output is clearly visible
      const codeLineCount = Math.max(1, code.split("\n").length);
      const codeNeededHeight =
        (isShorts ? 56 : 40) + codeLineCount * codeLineHeight + (isShorts ? 88 : 60);
      const minCodeHeight = outputHasImage
        ? (isShorts ? 220 : 92)
        : (isShorts ? 240 : 110);
      const maxCodeWhenOutput = Math.floor(availableBelow * (isShorts ? 0.45 : 0.40));
      const codeTargetHeight = Math.min(
        Math.max(minCodeHeight, codeNeededHeight),
        maxCodeWhenOutput
      );
      const maxOutputHeight = Math.max(80, availableBelow - codeTargetHeight - gapBetween);
      const hardCap = outputHasImage
        ? Math.floor(height * 0.86)
        : Math.floor(height * (isShorts ? 0.78 : 0.70));
      if (outputHasImage) {
        outputHeight = Math.min(maxOutputHeight, hardCap);
      } else {
        const desiredLines = Math.max(1, renderedOutputLines.length);

        const tableDesiredHeight = hasPlainTextTable
          ? 78 +
            (Math.min(plainTextTable.rows.length, 6) + 1) * (isShorts ? 44 : 34) +
            Math.min(plainTextTable.after.length, 3) * (isShorts ? 34 : 26)
          : 0;

        const textDesiredHeight = 70 + desiredLines * effectiveOutputLineHeight + 24;

        const desired = hasPlainTextTable
          ? tableDesiredHeight
          : textDesiredHeight;

        const minOutputHeight = hasPlainTextTable
          ? Math.min(maxOutputHeight, isShorts ? 300 : 230)
          : outputNeedsLargeArea
            ? Math.min(maxOutputHeight, Math.floor(availableBelow * (isShorts ? 0.50 : 0.42)))
            : Math.min(maxOutputHeight, isShorts ? 200 : 150);

        outputHeight = Math.min(
          maxOutputHeight,
          Math.min(hardCap, Math.max(minOutputHeight, desired))
        );
      }
    }

    const clampedOutputProgress = clampNumber(outputProgress, 0, 1);
    const getRevealWindow = (totalItems: number, viewportItems: number) => {
      const safeTotal = Math.max(0, totalItems);
      const safeViewport = Math.max(1, viewportItems);

      if (safeTotal === 0) {
        return { start: 0, end: 0, revealedCount: 0 };
      }

      const revealedCount = Math.max(
        1,
        Math.min(safeTotal, Math.ceil(safeTotal * clampedOutputProgress))
      );
      const end = revealedCount;
      const start = Math.max(0, end - safeViewport);

      return { start, end, revealedCount };
    };

    const codeAreaMinHeight = showOut && outputHasImage
      ? (isShorts ? 220 : 92)
      : (isShorts ? 240 : 110);
    const codeAreaHeight = showOut
      ? Math.max(codeAreaMinHeight, availableBelow - gapBetween - outputHeight)
      : availableBelow;

    // Code box background - light gray similar to Colab/Jupyter
    ctx.fillStyle = "#f6f8fa";
    ctx.beginPath();
    ctx.roundRect(40, codeAreaY, width - 80, codeAreaHeight, 12);
    ctx.fill();

    // Code box border - subtle cool gray
    ctx.strokeStyle = "#e1e5ea";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Accent bar - Anthropic coral gradient
    const gradient = ctx.createLinearGradient(40, codeAreaY, 40, codeAreaY + codeAreaHeight);
    gradient.addColorStop(0, "#c96442");
    gradient.addColorStop(1, "#b85a3a");
    ctx.fillStyle = gradient;
    ctx.fillRect(40, codeAreaY, 4, codeAreaHeight);

    // Code text with syntax highlighting (larger for readability)
    ctx.font = `${codeFontSize}px 'Fira Code', 'Monaco', 'Consolas', monospace`;
    const allLines = code.split('\n');
    const lineHeight = codeLineHeight;
    const codePadTop = isShorts ? 56 : 40;
    const codePadBottom = isShorts ? 88 : 60;
    let y = codeAreaY + codePadTop;
    const linesPerPage = Math.max(1, Math.floor((codeAreaHeight - codePadBottom) / lineHeight));
    const startLine = Math.max(0, allLines.length - linesPerPage);
    const visibleLines = allLines.slice(startLine);

    for (const line of visibleLines) {
      if (y > codeAreaY + codeAreaHeight - 20) break;

      // Simple syntax highlighting
      let x = 70;
      const tokens = tokenizeLine(line);

      for (const token of tokens) {
        ctx.fillStyle = token.color;
        ctx.fillText(token.text, x, y);
        x += ctx.measureText(token.text).width;
      }

      y += lineHeight;
    }

    // Cursor (blinking effect based on time) - Anthropic coral
    if (code.length < (cell.content?.length || 0)) {
      const cursorVisible = Math.floor(Date.now() / 500) % 2 === 0;
      if (cursorVisible) {
        const cursorHeight = isShorts ? 34 : 24;
        const lastLine = visibleLines[visibleLines.length - 1] || "";
        const cursorX = 70 + ctx.measureText(lastLine).width + 2;
        const cursorY = codeAreaY + codePadTop + (visibleLines.length - 1) * lineHeight - cursorHeight;
        ctx.fillStyle = "#c96442";
        ctx.fillRect(cursorX, cursorY, 2, cursorHeight);
      }
    }

    // Output area - always show when showOut is true
    if (showOut) {
      const outputY = codeAreaY + codeAreaHeight + gapBetween;

      // Output box - Light background
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.roundRect(40, outputY, width - 80, outputHeight, 12);
      ctx.fill();

      ctx.strokeStyle = "#c96442"; // Coral border for output
      ctx.lineWidth = 2;
      ctx.stroke();

      // Output label - Anthropic coral
      ctx.font = `bold ${outputLabelSize}px 'Inter', system-ui, sans-serif`;
      ctx.fillStyle = "#c96442";
      ctx.fillText("OUTPUT", 60, outputY + 30);

      // First: draw image outputs if present (png/jpeg)
      let drewImage = false;
      for (let i = 0; i < outputs.length; i++) {
        const out = outputs[i];
        const imageData = extractOutputImageData(out);
        if (!imageData) continue;

        const key = `${cell.id}-${i}-${imageData.kind}`;
        let cache = imageCacheRef.current.get(key);
        if (!cache) {
          const img = new Image();
          cache = { img, loaded: false };
          imageCacheRef.current.set(key, cache);
          
          img.onload = () => {
            const c = imageCacheRef.current.get(key);
            if (c) c.loaded = true;
          };
          img.onerror = (e) => {
            const c = imageCacheRef.current.get(key);
            if (c) c.error = e;
          };
          
          if (imageData.kind === "htmltable") {
            const container = document.createElement("div");
            container.style.cssText = [
              "position:fixed",
              "left:-20000px",
              "top:0",
              "background:#ffffff",
              "padding:22px",
              "pointer-events:none",
              "color:#111827",
              "font-family:Inter,Arial,sans-serif",
              "font-size:18px",
              "line-height:1.45",
              "max-width:none",
              "width:max-content",
            ].join(";");
            container.innerHTML = `
              <style>
                .cpx-table-capture table { border-collapse: collapse; width: max-content; max-width: none; color: #111827; }
                .cpx-table-capture th, .cpx-table-capture td { border: 1px solid #d1d5db; padding: 8px 12px; white-space: nowrap; text-align: right; }
                .cpx-table-capture th { background: #f3f4f6; font-weight: 800; color: #374151; }
                .cpx-table-capture tbody tr:nth-child(even) { background: #f9fafb; }
              </style>
              <div class="cpx-table-capture">${imageData.dataUrl}</div>
            `;
            document.body.appendChild(container);
            
            // Give it a tiny bit of time for styles to apply if needed
            setTimeout(() => {
              domToCanvas(container, {
                scale: 2
              }).then((renderedCanvas) => {
                img.src = renderedCanvas.toDataURL("image/png");
              }).catch(e => {
                console.error("domToCanvas failed", e);
                const c = imageCacheRef.current.get(key);
                if (c) c.error = e;
              }).finally(() => {
                if (container.parentNode) container.parentNode.removeChild(container);
              });
            }, 50);
          } else {
            img.src = imageData.dataUrl;
          }
        }

        if (cache.loaded) {
          // Compute fit inside output area (with padding)
          const padX = 20;
          const padY = 20;
          const availW = width - 80 - padX * 2; // box width minus padding
          const availH = outputHeight - 60 - padY * 2; // space below label minus padding

          // Use intrinsic size when available; fall back for SVGs or unknown dims
          let iw = (cache.img.naturalWidth || (cache.img as any).width || 0);
          let ih = (cache.img.naturalHeight || (cache.img as any).height || 0);
          if (iw <= 0 || ih <= 0) {
            // Fallback: assume 16:9 if dimensions are missing
            const ratio = 16 / 9;
            iw = availW;
            ih = Math.min(availH, Math.floor(availW / ratio));
          }

          const isHtmlTable = imageData.kind === "htmltable";
          const scale = Math.max(
            isHtmlTable ? (isShorts ? 0.68 : 0.78) : 0.01,
            isHtmlTable ? Math.min(availW / iw, 1.35) : Math.min(availW / iw, availH / ih)
          );
          const drawW = Math.max(1, Math.floor(iw * scale));
          const scaledH = Math.max(1, Math.floor(ih * scale));
          const drawX = 40 + 20 + Math.max(0, Math.floor((availW - drawW) / 2));
          const drawY = outputY + 60 + padY;

          if (isHtmlTable && (scaledH > availH || drawW > availW)) {
            const clampedProgress = Math.max(0, Math.min(1, outputProgress));
            const maxSourceScrollX = Math.max(0, iw - availW / scale);
            const maxSourceScroll = Math.max(0, ih - availH / scale);
            const sourceX = Math.floor(maxSourceScrollX * clampedProgress);
            const sourceY = Math.floor(maxSourceScroll * clampedProgress);
            const sourceW = Math.min(iw - sourceX, Math.ceil(availW / scale));
            const sourceH = Math.min(ih - sourceY, Math.ceil(availH / scale));

            ctx.save();
            ctx.beginPath();
            ctx.rect(40 + 20, drawY, availW, availH);
            ctx.clip();
            ctx.drawImage(
              cache.img,
              sourceX,
              sourceY,
              sourceW,
              sourceH,
              40 + 20,
              drawY,
              Math.ceil(sourceW * scale),
              Math.ceil(sourceH * scale)
            );
            ctx.restore();

            ctx.fillStyle = "rgba(201,100,66,0.14)";
            ctx.fillRect(
              40 + 20,
              outputY + outputHeight - 18,
              Math.max(10, availW * Math.max(0.04, clampedProgress)),
              4
            );
          } else {
            const drawH = Math.min(availH, scaledH);
            const centeredY = drawY + Math.max(0, Math.floor((availH - drawH) / 2));
            ctx.drawImage(cache.img, drawX, centeredY, drawW, drawH);
          }
          drewImage = true;
          break; // draw first image only
        }
      }
      // If no image drawn, render text/plain or text/tracebacks
      if (!drewImage) {
        ctx.save();

        ctx.beginPath();
        ctx.rect(
          outputInnerX,
          outputY + 48,
          outputInnerW,
          Math.max(1, outputHeight - 64)
        );
        ctx.clip();

        const drawEllipsizedText = (
          text: string,
          x: number,
          y: number,
          maxW: number
        ) => {
          if (ctx.measureText(text).width <= maxW) {
            ctx.fillText(text, x, y);
            return;
          }

          let trimmed = text;
          while (trimmed.length > 1 && ctx.measureText(trimmed + "...").width > maxW) {
            trimmed = trimmed.slice(0, -1);
          }

          ctx.fillText(trimmed + "...", x, y);
        };

        // Special renderer for plain-text pandas/dataframe output.
        // This is the important part: do not draw dataframe as one raw terminal line.
        if (plainTextTable) {
          const table = plainTextTable;

          const maxCols = Math.min(table.headers.length, isShorts ? 6 : 9);
          const tableFontSize = Math.max(
            isShorts ? 16 : 12,
            Math.min(effectiveOutputFontSize, isShorts ? 22 : 15)
          );

          const rowH = Math.round(tableFontSize * 2.2);
          const tableX = outputInnerX;
          let tableY = outputY + 56;
          const tableW = outputInnerW;
          const colW = tableW / maxCols;

          ctx.font = `bold ${tableFontSize}px 'Fira Code', monospace`;
          ctx.textBaseline = "middle";

          // Header background
          ctx.fillStyle = "#f6f8fa";
          ctx.fillRect(tableX, tableY, tableW, rowH);

          ctx.strokeStyle = "#d8dee4";
          ctx.lineWidth = 1;
          ctx.strokeRect(tableX, tableY, tableW, rowH);

          ctx.fillStyle = "#374151";

          for (let c = 0; c < maxCols; c++) {
            const x = tableX + c * colW;
            ctx.strokeStyle = "#d8dee4";
            ctx.strokeRect(x, tableY, colW, rowH);

            drawEllipsizedText(
              table.headers[c] || "",
              x + 8,
              tableY + rowH / 2,
              colW - 16
            );
          }

          tableY += rowH;

          const remainingHForRows = outputY + outputHeight - tableY - 70;
          const rowsFit = Math.max(1, Math.floor(remainingHForRows / rowH));
          const totalTableUnits = table.rows.length + table.after.length;
          const revealedTableUnits = totalTableUnits > 0
            ? Math.max(1, Math.min(totalTableUnits, Math.ceil(totalTableUnits * clampedOutputProgress)))
            : 0;
          const revealedRowCount = Math.min(table.rows.length, revealedTableUnits);
          const rowEnd = Math.max(0, revealedRowCount);
          const rowStart = Math.max(0, rowEnd - rowsFit);
          const rowsToDraw = table.rows.slice(rowStart, rowEnd);

          ctx.font = `${tableFontSize}px 'Fira Code', monospace`;

          rowsToDraw.forEach((row, r) => {
            const y = tableY + r * rowH;

            ctx.fillStyle = r % 2 === 0 ? "#ffffff" : "#f9fafb";
            ctx.fillRect(tableX, y, tableW, rowH);

            for (let c = 0; c < maxCols; c++) {
              const x = tableX + c * colW;

              ctx.strokeStyle = "#e5e7eb";
              ctx.strokeRect(x, y, colW, rowH);

              ctx.fillStyle = "#2d2a26";
              drawEllipsizedText(
                row[c] || "",
                x + 8,
                y + rowH / 2,
                colW - 16
              );
            }
          });

          // Draw non-table lines after the table, e.g. Train shape / Test shape.
          const revealedNotesCount = Math.max(
            0,
            Math.min(table.after.length, revealedTableUnits - table.rows.length)
          );
          const notes = table.after.slice(0, revealedNotesCount).slice(-3);
          if (notes.length) {
            ctx.textBaseline = "alphabetic";
            ctx.font = `${Math.max(12, tableFontSize - 1)}px 'Fira Code', monospace`;
            ctx.fillStyle = "#374151";

            let noteY = outputY + outputHeight - notes.length * (tableFontSize + 10) - 14;

            for (const note of notes) {
              drawEllipsizedText(note, outputInnerX, noteY, outputInnerW);
              noteY += tableFontSize + 10;
            }
          }
        } else {
          // Normal text fallback
          ctx.font = `${effectiveOutputFontSize}px 'Fira Code', monospace`;
          ctx.fillStyle = "#2d2a26";
          ctx.textBaseline = "alphabetic";

          const maxLinesFit = Math.max(
            1,
            Math.floor((outputHeight - 76) / effectiveOutputLineHeight)
          );

          const { start, end } = getRevealWindow(renderedOutputLines.length, maxLinesFit);
          const visible = renderedOutputLines.slice(start, end);

          if (visible.length) {
            let outputLineY = outputY + 62;

            for (const line of visible) {
              drawEllipsizedText(line, outputInnerX, outputLineY, outputInnerW);
              outputLineY += effectiveOutputLineHeight;

              if (outputLineY > outputY + outputHeight - 16) break;
            }
          }
        }

        ctx.restore();
      }
    }
  }, [cells, fontSize, getCachedOutputData]);

  // Simple tokenizer for syntax highlighting
  const tokenizeLine = (line: string): Array<{ text: string, color: string }> => {
    const tokens: Array<{ text: string, color: string }> = [];
    const keywords = ['import', 'from', 'def', 'class', 'for', 'while', 'if', 'else', 'elif',
      'return', 'and', 'or', 'not', 'in', 'is', 'None', 'True', 'False', 'as',
      'try', 'except', 'finally', 'with', 'lambda', 'yield', 'async', 'await'];

    // Simple tokenization
    let remaining = line;

    while (remaining.length > 0) {
      // Check for comment - Gray (like Claude)
      if (remaining.startsWith('#')) {
        tokens.push({ text: remaining, color: "#8b8685" });
        break;
      }

      // Check for string - Green (like Claude)
      const stringMatch = remaining.match(/^(['"])(?:[^\\]|\\.)*?\1/);
      if (stringMatch) {
        tokens.push({ text: stringMatch[0], color: "#448c27" });
        remaining = remaining.slice(stringMatch[0].length);
        continue;
      }

      // Check for keyword - Brown/tan (like Claude's if/elif/else)
      let foundKeyword = false;
      for (const kw of keywords) {
        if (remaining.startsWith(kw) && (remaining.length === kw.length || !/\w/.test(remaining[kw.length]))) {
          tokens.push({ text: kw, color: "#9a6a3a" });
          remaining = remaining.slice(kw.length);
          foundKeyword = true;
          break;
        }
      }
      if (foundKeyword) continue;

      // Check for number - Blue/purple (like Claude)
      const numMatch = remaining.match(/^\d+(\.\d+)?/);
      if (numMatch) {
        tokens.push({ text: numMatch[0], color: "#7c5ac2" });
        remaining = remaining.slice(numMatch[0].length);
        continue;
      }

      // Check for function call - Dark brown
      const funcMatch = remaining.match(/^(\w+)(?=\()/);
      if (funcMatch) {
        tokens.push({ text: funcMatch[1], color: "#5c5855" });
        remaining = remaining.slice(funcMatch[1].length);
        continue;
      }

      // Default: take one character - Dark text
      tokens.push({ text: remaining[0], color: "#2d2a26" });
      remaining = remaining.slice(1);
    }

    return tokens;
  };

  // Generate voice narration
  const generateVoiceNarration = useCallback(async (): Promise<{ audioUrl: string; script: string; segments: Array<{ cellIndex: number; estimatedDuration: number }>; audioDurationSeconds?: number } | null> => {
    if (selectedVoice === "none") {
      return null;
    }
    try {
      setStatus("generating_voice");
      setVoiceProgress(0);
      console.log("[VideoRecorder] Generating voice narration...");

      const response = await fetch("/api/voice/generate-narration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cells: cellsRef.current.map(c => ({
            id: c.id,
            type: c.type,
            content: c.content,
            outputs: c.outputs,
          })),
          style: narrationStyle,
          duration: narrationDuration,
          voice: selectedVoice,
          format: "mp3",
          context: narrationInstructions.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Voice generation failed");
      }

      const data = await response.json();
      setVoiceProgress(100);
      setGeneratedScript(data.script);
      setVoiceSegments(data.segments || []);

      console.log(`[VideoRecorder] Voice generated: ${data.audioPath}`);
      return {
        audioUrl: data.audioPath,
        script: data.script,
        segments: data.segments || [],
        audioDurationSeconds: typeof data.audioDurationSeconds === "number" ? data.audioDurationSeconds : undefined,
      };
    } catch (error: any) {
      console.error("[VideoRecorder] Voice generation error:", error);
      throw error;
    }
  }, [narrationStyle, selectedVoice, narrationInstructions, narrationDuration]);

  const startHqRender = useCallback(async () => {
    try {
      setStatus("running");
      setErrorMessage(null);
      setVideoUrl(null);
      setRenderPreviewUrl(null);
      setHqPreviewMuted(false);
      setProgress(1);
      setGeneratedScript("");
      setVoiceSegments([]);
      setRecordingTime(0);
      setCurrentCellIndex(-1);
      setDisplayedCode("");
      setShowOutput(false);
      setRenderStatusMessage("Running notebook cells before export...");

      if (onRunAll) {
        const updatedCells = await onRunAll({ skipPresentation: true });
        if (updatedCells && Array.isArray(updatedCells)) {
          cellsRef.current = updatedCells;
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }

      const renderCells = (cellsRef.current && cellsRef.current.length ? cellsRef.current : cells) ?? [];
      if (!renderCells.length) {
        throw new Error("No notebook cells available to export.");
      }

      setStatus("preparing");
      setProgress(5);
      setRenderStatusMessage("Sending lesson to server-side renderer...");

      const renderResponse = await fetch("/api/video/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cells: renderCells.map((cell) => ({
            id: cell.id,
            type: cell.type,
            content: cell.content,
            outputs: cell.outputs,
          })),
          videoFormat,
          videoSpeed: Number.isFinite(presentationSpeed) ? presentationSpeed : 50,
          fontSize,
          voice: hasVoiceNarration ? selectedVoice : "none",
          style: narrationStyle,
          duration: narrationDuration,
          context: narrationInstructions.trim() || undefined,
        }),
      });

      if (!renderResponse.ok) {
        const errorText = await renderResponse.text();
        throw new Error(`Video render request failed: ${errorText}`);
      }

      const { jobId, previewUrl } = await renderResponse.json();
      if (!jobId) {
        throw new Error("The render server did not return a jobId.");
      }
      if (typeof previewUrl === "string" && previewUrl.trim()) {
        setRenderPreviewUrl(`${previewUrl}${previewUrl.includes("?") ? "&" : "?"}ts=${Date.now()}`);
      }

      const pollStartedAt = Date.now();
      let complete = false;
      while (!complete) {
        await new Promise((resolve) => setTimeout(resolve, 1200));

        const statusResponse = await fetch(`/api/video/render/${encodeURIComponent(jobId)}`, {
          cache: "no-store",
        });
        if (!statusResponse.ok) {
          const errorText = await statusResponse.text();
          throw new Error(`Could not read render status: ${errorText}`);
        }

        const renderJob = await statusResponse.json();
        setProgress(Number(renderJob.progress || 0));
        setRenderStatusMessage(renderJob.message || "Rendering video...");
        setRecordingTime(Date.now() - pollStartedAt);

        if ((Date.now() - pollStartedAt) > 90_000 && Number(renderJob.progress || 0) <= 8) {
          setRenderStatusMessage("Still starting renderer... if this stays here, check server console for Playwright startup errors.");
        }

        if (renderJob.script) {
          setGeneratedScript(renderJob.script);
        }

        if (renderJob.status === "running") setStatus("generating_voice");
        if (renderJob.status === "recording") setStatus("recording");
        if (renderJob.status === "processing") setStatus("processing");

        if (renderJob.status === "complete") {
          setVideoUrl(renderJob.downloadUrl);
          setStatus("complete");
          setProgress(100);
          setRenderStatusMessage("Video ready.");
          complete = true;
        }

        if (renderJob.status === "error") {
          throw new Error(renderJob.error || renderJob.message || "Video render failed.");
        }
      }
    } catch (error) {
      console.error("[VideoRecorder] HQ render failed:", error);
      setErrorMessage(error instanceof Error ? error.message : "Failed to render video");
      setRenderStatusMessage("");
      setRenderPreviewUrl(null);
      setHqPreviewMuted(false);
      setStatus("error");
    }
  }, [cells, fontSize, hasVoiceNarration, narrationDuration, narrationInstructions, narrationStyle, onRunAll, presentationSpeed, selectedVoice, videoFormat]);

  // Main recording logic - runs all cells first, then records
  const startRecording = useCallback(async () => {
    try {
      setErrorMessage(null);
      setProgress(0);
      setVideoUrl(null);
      setRecordingTime(0);
      setCurrentCellIndex(-1);
      setDisplayedCode("");
      setShowOutput(false);

      chunksRef.current = [];
      imageCacheRef.current.clear();
      outputDataCacheRef.current.clear();
      audioEndedAtRef.current = null;
      lastRenderedFrameRef.current = { cellIndex: -1, code: "", showOutput: false, cell: null };

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current = null;
      }
      if (gainNodeRef.current) {
        try { gainNodeRef.current.disconnect(); } catch { }
        gainNodeRef.current = null;
      }
      if (audioContextRef.current) {
        await audioContextRef.current.close().catch(() => undefined);
        audioContextRef.current = null;
      }
      audioDestinationRef.current = null;

      if (onRunAll) {
        setStatus("running");
        console.log("[VideoRecorder] Running all cells...");
        const updatedCells = await onRunAll({ skipPresentation: true });
        if (updatedCells && Array.isArray(updatedCells)) {
          cellsRef.current = updatedCells;
        }
        console.log("[VideoRecorder] All cells executed, starting recording...");
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        });
      }

      const recordingCells = (cellsRef.current && cellsRef.current.length ? cellsRef.current : cells) ?? [];
      if (!recordingCells.length) {
        throw new Error("No notebook cells available to record.");
      }

      let audioDurationMs = 0;
      let narrationSegments: Array<{ cellIndex: number; estimatedDuration: number }> = [];

      if (hasVoiceNarration) {
        try {
          const voiceResult = await generateVoiceNarration();
          if (voiceResult) {
            narrationSegments = Array.isArray(voiceResult.segments) ? voiceResult.segments : [];
            const authoritativeAudioDurationMs = typeof voiceResult.audioDurationSeconds === "number" && Number.isFinite(voiceResult.audioDurationSeconds)
              ? Math.max(0, Math.round(voiceResult.audioDurationSeconds * 1000))
              : 0;

            const audioContext = new AudioContext();
            audioContextRef.current = audioContext;

            const destination = audioContext.createMediaStreamDestination();
            audioDestinationRef.current = destination;

            const cacheBustedAudioUrl = `${voiceResult.audioUrl}${voiceResult.audioUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;
            const audio = new Audio(cacheBustedAudioUrl);
            audio.crossOrigin = "anonymous";
            audio.preload = "auto";
            audioRef.current = audio;

            await new Promise<void>((resolve, reject) => {
              const cleanup = () => {
                audio.oncanplay = null;
                audio.onloadedmetadata = null;
                audio.onerror = null;
              };

              const ready = () => {
                cleanup();
                resolve();
              };

              const fail = () => {
                cleanup();
                reject(new Error("Failed to load audio"));
              };

              if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
                resolve();
                return;
              }

              audio.oncanplay = ready;
              audio.onloadedmetadata = ready;
              audio.onerror = fail;
              audio.load();
            });

            const browserAudioDurationMs = Number.isFinite(audio.duration)
              ? Math.max(0, Math.round(audio.duration * 1000))
              : 0;

            audioDurationMs = authoritativeAudioDurationMs > 0
              ? authoritativeAudioDurationMs
              : browserAudioDurationMs;

            console.log(
              `[VideoRecorder] Narration duration resolved: authoritative=${authoritativeAudioDurationMs}ms, browser=${browserAudioDurationMs}ms, chosen=${audioDurationMs}ms`
            );

            const source = audioContext.createMediaElementSource(audio);
            const gainNode = audioContext.createGain();
            gainNode.gain.value = isMutedRef.current ? 0 : 1;
            source.connect(destination);
            source.connect(gainNode);
            gainNode.connect(audioContext.destination);
            gainNodeRef.current = gainNode;
          }
        } catch (voiceError) {
          throw new Error(
            voiceError instanceof Error
              ? `Voice narration failed: ${voiceError.message}`
              : "Voice narration failed"
          );
        }
      }

      setStatus("preparing");

      const canvas = canvasRef.current;
      if (!canvas) {
        throw new Error("Video canvas is not ready.");
      }

      const resolution = videoFormat === "shorts"
        ? { width: 1080, height: 1920 }
        : { width: 1920, height: 1080 };
      canvas.width = resolution.width;
      canvas.height = resolution.height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("2D canvas context is not available.");
      }

      const videoStream = canvas.captureStream(30);
      let stream: MediaStream = videoStream;

      if (audioDestinationRef.current) {
        stream = new MediaStream([
          ...videoStream.getVideoTracks(),
          ...audioDestinationRef.current.stream.getAudioTracks(),
        ]);
      }

      const requestVideoFrame = () => {
        const track = videoStream.getVideoTracks()[0] as any;
        if (typeof track?.requestFrame === "function") {
          try { track.requestFrame(); } catch { }
        }
      };

      const previewTypingDelay = getInstructorTypingDelayMs(narrationDuration);
      const pacing = getInstructorPacing(narrationDuration);

      const pauseBeforeExec = pacing.beforeExec;
      const pauseAfterMarkdown = pacing.markdown;

      const baseTotalDuration = recordingCells.reduce((sum, cell) => {
        if (cell.type === "code") {
          return sum +
            cell.content.length * previewTypingDelay +
            pauseBeforeExec +
            getCellOutputHoldMs(cell, narrationDuration);
        }

        return sum + pauseAfterMarkdown;
      }, 0);

      console.log(
        `[VideoRecorder] Instructor pacing: detail=${narrationDuration}, typingDelay=${previewTypingDelay}ms/char, visualDuration=${baseTotalDuration}ms, audioDuration=${audioDurationMs}ms`
      );

      const mimeTypes = [
        "video/webm;codecs=vp8",
        "video/webm;codecs=vp9",
        "video/webm",
      ];

      let selectedMimeType = "";
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          break;
        }
      }

      if (!selectedMimeType) {
        throw new Error("No supported video format found in browser");
      }

      console.log(`[VideoRecorder] Using codec: ${selectedMimeType}`);

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: selectedMimeType,
        videoBitsPerSecond: 5000000,
      });

      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        console.log(`[VideoRecorder] Recording stopped. Chunks: ${chunksRef.current.length}`);
        setStatus("processing");

        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
        }
        if (gainNodeRef.current) {
          try { gainNodeRef.current.disconnect(); } catch { }
          gainNodeRef.current = null;
        }
        if (audioContextRef.current) {
          audioContextRef.current.close().catch(() => undefined);
          audioContextRef.current = null;
        }
        audioDestinationRef.current = null;

        if (!chunksRef.current.length) {
          console.warn("[VideoRecorder] No chunks captured. The codec may be unsupported or stopped too early.");
          setErrorMessage("No video data captured. Try recording again or switch browser.");
          setStatus("error");
          return;
        }

        const containerType = selectedMimeType.startsWith("video/webm") ? "video/webm" : selectedMimeType;
        const blob = new Blob(chunksRef.current, { type: containerType });
        const url = URL.createObjectURL(blob);
        setVideoUrl(url);
        setProgress(100);
        setStatus("complete");
      };

      mediaRecorder.onerror = (e) => {
        console.error("[VideoRecorder] MediaRecorder error:", e);
        setErrorMessage("Recording failed: " + ((e as any).error?.message || "Unknown error"));
        setStatus("error");
      };

      const imageKeysToAwait: string[] = [];
      for (const cell of recordingCells) {
        if (cell.type !== "code") continue;
        const outputs = cell.outputs || [];
        for (let i = 0; i < outputs.length; i++) {
          const imageData = extractOutputImageData(outputs[i]);
          if (!imageData || imageData.kind === "htmltable") continue;
          const key = `${cell.id}-${i}-${imageData.kind}`;
          let cache = imageCacheRef.current.get(key);
          if (!cache) {
            const img = new Image();
            cache = { img, loaded: false };
            imageCacheRef.current.set(key, cache);
            img.onload = () => {
              const current = imageCacheRef.current.get(key);
              if (current) current.loaded = true;
            };
            img.onerror = (err) => {
              const current = imageCacheRef.current.get(key);
              if (current) current.error = err;
            };
            img.src = imageData.dataUrl;
          }
          imageKeysToAwait.push(key);
        }
      }

      const awaitStart = Date.now();
      while (Date.now() - awaitStart < 1200) {
        const allReady = imageKeysToAwait.every((key) => imageCacheRef.current.get(key)?.loaded);
        if (allReady || imageKeysToAwait.length === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 80));
      }

      let perCellDurationsMs: number[] | null = null;
      if (hasVoiceNarration && narrationSegments.length > 0) {
        try {
          const cellCount = recordingCells.length;
          const perCell: number[] = new Array(cellCount).fill(0);
          const perCellSpeechUnits: number[] = new Array(cellCount).fill(0);

          narrationSegments.forEach((seg: any, idx: number) => {
            const ci = typeof seg.cellIndex === "number" ? seg.cellIndex : idx;
            const estDurMs = Math.max(0, Math.floor((seg.estimatedDuration || 0) * 1000));
            if (ci >= 0 && ci < cellCount) {
              perCell[ci] += estDurMs;
              perCellSpeechUnits[ci] += estimateNarrationSpeechUnits(typeof seg.script === "string" ? seg.script : "");
            }
          });

          const totalEstimated = perCell.reduce((sum, value) => sum + value, 0);
          const totalSpeechUnits = perCellSpeechUnits.reduce((sum, value) => sum + value, 0);
          if (audioDurationMs > 0 && (totalSpeechUnits > 0 || totalEstimated > 0)) {
            const scaleSource = totalSpeechUnits > 0 ? totalSpeechUnits : totalEstimated;
            const scale = audioDurationMs / scaleSource;
            for (let i = 0; i < cellCount; i++) {
              const weightedValue = totalSpeechUnits > 0
                ? perCellSpeechUnits[i]
                : perCell[i];
              perCell[i] = Math.max(0, Math.round(weightedValue * scale));
            }
            console.log(
              `[VideoRecorder] Scaled per-cell durations (audio: ${audioDurationMs}ms, estimated: ${totalEstimated}ms, speechUnits: ${totalSpeechUnits}, scale: ${scale.toFixed(2)}):`,
              perCell
            );
          }

          if (perCell.some((value) => value > 0)) {
            perCellDurationsMs = perCell;
            console.log("[VideoRecorder] Per-cell narration durations (ms):", perCellDurationsMs);
          }
        } catch (e) {
          console.warn("[VideoRecorder] Failed to derive per-cell durations from narration segments:", e);
        }
      }

      interface TimelineItem {
        cell: Cell;
        cellIndex: number;
        startTime: number;
        typeDuration: number;
        totalDuration: number;
      }

      const timeline: TimelineItem[] = [];
      let currentTime = 0;

      const typingDelay = getInstructorTypingDelayMs(narrationDuration);

      const beforeOutputPause =
        narrationDuration === "long"
          ? 1600
          : narrationDuration === "medium"
            ? 1000
            : 500;

      const markdownHold =
        narrationDuration === "long"
          ? 9000
          : narrationDuration === "medium"
            ? 5500
            : 3000;

      const minCodeTypingMs =
        narrationDuration === "long"
          ? 2200
          : narrationDuration === "medium"
            ? 1400
            : 700;

      for (let i = 0; i < recordingCells.length; i++) {
        const cell = recordingCells[i];

        const segDurMs = perCellDurationsMs
          ? Math.max(0, Math.floor(perCellDurationsMs[i] || 0))
          : 0;

        if (cell.type === "code") {
          const charCount = Math.max(1, cell.content.length);
          const naturalOutputHold = estimateOutputExplainHoldMs(cell, narrationDuration);
          const hasRenderableOutput = Array.isArray(cell.outputs) && cell.outputs.length > 0;

          let typeDuration: number;
          let totalDuration: number;

          if (segDurMs > 0) {
            const outputWindow = hasRenderableOutput
              ? Math.max(
                  900,
                  Math.min(naturalOutputHold, Math.floor(segDurMs * 0.18))
                )
              : Math.max(300, Math.min(700, Math.floor(segDurMs * 0.08)));
            const usableForTyping = Math.max(
              800,
              segDurMs - beforeOutputPause - outputWindow
            );

            const idealDelay = usableForTyping / charCount;
            const cappedDelay = Math.max(
              MIN_CHAR_DELAY_MS,
              Math.min(MAX_CHAR_DELAY_MS, idealDelay)
            );

            const minimumNarratedTyping = Math.floor(segDurMs * (hasRenderableOutput ? 0.72 : 0.84));
            typeDuration = Math.min(
              usableForTyping,
              Math.max(
                Math.max(minCodeTypingMs, charCount * cappedDelay),
                minimumNarratedTyping
              )
            );

            if (typeDuration > usableForTyping) {
              // Narration is shorter than what comfortable typing requires:
              // extend the cell just enough to finish typing + show the output
              // briefly. Trailing audio silence is bounded by this overrun.
              totalDuration = typeDuration + beforeOutputPause + Math.max(
                1500,
                Math.floor(outputWindow * 0.6)
              );
            } else {
              totalDuration = segDurMs;
            }
          } else {
            // No narration: use the fixed instructor pace.
            typeDuration = Math.max(minCodeTypingMs, charCount * typingDelay);
            totalDuration = typeDuration + beforeOutputPause + naturalOutputHold;
          }

          timeline.push({
            cell,
            cellIndex: i,
            startTime: currentTime,
            typeDuration,
            totalDuration,
          });

          currentTime += totalDuration;
        } else {
          const totalDuration = segDurMs > 0 ? segDurMs : markdownHold;

          timeline.push({
            cell,
            cellIndex: i,
            startTime: currentTime,
            typeDuration: 0,
            totalDuration,
          });

          currentTime += totalDuration;
        }
      }

      // End at whichever finishes last (visual timeline or audio), plus a
      // small tail. With per-cell typing now derived from each segment, the
      // visual timeline tracks the audio closely — no minutes-long silence.
      totalDurationRef.current = Math.max(
        currentTime,
        audioDurationMs > 0 ? audioDurationMs : 0
      ) + 400;

      console.log(
        `[VideoRecorder] Timeline fixed: typingDelay=${typingDelay}ms/char, visual=${currentTime}ms, audio=${audioDurationMs}ms, export=${totalDurationRef.current}ms`
      );

      let lastElapsed = 0;
      let lastUIUpdateTime = 0;

      const animate = () => {
        const now = Date.now();
        const wallClockElapsed = now - startTimeRef.current;
        let elapsed = wallClockElapsed;
        const audio = audioRef.current;

        if (audio && !isNaN(audio.currentTime)) {
          const audioElapsedMs = Math.max(0, Math.floor(audio.currentTime * 1000));
          if (hasVoiceNarration && (audioElapsedMs > 0 || !audio.paused)) {
            elapsed = audioElapsedMs;
          }
          const hasDur = !isNaN(audio.duration) && isFinite(audio.duration) && audio.duration > 0;
          if (hasDur && (audio.ended || (audio.duration - audio.currentTime) <= 0.05)) {
            if (audioEndedAtRef.current === null) {
              audioEndedAtRef.current = now;
              console.log("[VideoRecorder] Audio ended, starting auto-stop countdown");
            }
          }
        }

        if (elapsed < lastElapsed) elapsed = lastElapsed;
        lastElapsed = elapsed;

        const mr = mediaRecorderRef.current;
        if (mr && mr.state === "recording" && now - lastDataRequestRef.current > 800) {
          try { mr.requestData(); } catch { }
          lastDataRequestRef.current = now;
        }

        let activeCellIndex = -1;
        let activeCode = "";
        let activeShowOutput = false;
        let activeOutputProgress = 1;
        let activeCell: Cell | null = null;

        for (const item of timeline) {
          const currentCell = item.cell;
          if (!currentCell) continue;

          if (elapsed >= item.startTime && elapsed < item.startTime + item.totalDuration) {
            activeCellIndex = item.cellIndex;
            activeCell = currentCell;
            const cellElapsed = elapsed - item.startTime;

            if (currentCell.type === "code") {
              const denom = item.typeDuration > 0 ? item.typeDuration : 1;
              const typeProgress = Math.min(1, cellElapsed / denom);
              const charsToShow = Math.floor(currentCell.content.length * typeProgress);
              activeCode = currentCell.content.slice(0, charsToShow);
              activeShowOutput = cellElapsed >= item.typeDuration + beforeOutputPause;

              if (activeShowOutput) {
                const outputElapsed = cellElapsed - item.typeDuration - beforeOutputPause;
                const outputDuration = Math.max(
                  1,
                  item.totalDuration - item.typeDuration - beforeOutputPause
                );

                activeOutputProgress = Math.max(
                  0,
                  Math.min(1, outputElapsed / outputDuration)
                );
              } else {
                activeOutputProgress = 0;
              }
            } else {
              activeCode = currentCell.content;
              activeShowOutput = false;
              activeOutputProgress = Math.max(0, Math.min(1, cellElapsed / Math.max(1, item.totalDuration)));
            }
            break;
          } else if (elapsed >= item.startTime + item.totalDuration) {
            activeCellIndex = item.cellIndex;
            activeCell = currentCell;
            activeCode = currentCell.content;
            activeShowOutput = currentCell.type === "code";
            activeOutputProgress = 1;
          }
        }

        if (!activeCell && lastRenderedFrameRef.current.cell) {
          activeCellIndex = lastRenderedFrameRef.current.cellIndex;
          activeCode = lastRenderedFrameRef.current.code;
          activeShowOutput = lastRenderedFrameRef.current.showOutput;
          activeCell = lastRenderedFrameRef.current.cell;
          activeOutputProgress = 1;
        }

        lastRenderedFrameRef.current = {
          cellIndex: activeCellIndex,
          code: activeCode,
          showOutput: activeShowOutput,
          cell: activeCell,
        };

        if (now - lastUIUpdateTime > 250) {
          lastUIUpdateTime = now;
          const progressPct = totalDurationRef.current > 0
            ? Math.min(100, (elapsed / totalDurationRef.current) * 100)
            : 100;
          setProgress(progressPct);
          setRecordingTime(elapsed);
          setCurrentCellIndex(activeCellIndex);
          setDisplayedCode(activeCode);
          setShowOutput(activeShowOutput);
        }

        drawFrame(ctx, activeCellIndex, activeCode, activeShowOutput, activeCell, activeOutputProgress);
        requestVideoFrame();

        // Stop only by the final visual/export timeline.
        // Audio may finish early, but it must not cut off the typing animation.
        const shouldStop = elapsed >= totalDurationRef.current;

        if (!shouldStop) {
          animationFrameRef.current = requestAnimationFrame(animate);
        } else {
          setStatus("processing");
          if (mr && mr.state !== "inactive") {
            try { mr.requestData(); } catch { }
            setTimeout(() => {
              if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
                mediaRecorderRef.current.stop();
              }
            }, 120);
          }
        }
      };

      const firstCell = recordingCells[0] || null;
      lastRenderedFrameRef.current = { cellIndex: 0, code: "", showOutput: false, cell: firstCell };
      drawFrame(ctx, 0, "", false, firstCell);
      requestVideoFrame();

      mediaRecorder.start(100);
      setStatus("recording");
      startTimeRef.current = Date.now();
      lastDataRequestRef.current = Date.now();

      if (audioContextRef.current?.state === "suspended") {
        await audioContextRef.current.resume().catch(() => undefined);
      }
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch((e) => console.warn("[VideoRecorder] Audio playback:", e));
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    } catch (error) {
      console.error("[VideoRecorder] Error:", error);
      setErrorMessage(error instanceof Error ? error.message : "Recording failed");
      setStatus("error");
    }
  }, [cells, calculateTotalDuration, drawFrame, onRunAll, hasVoiceNarration, generateVoiceNarration, videoFormat, narrationDuration, narrationInstructions]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    // Stop audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    // Disconnect gain node (speaker mute control)
    if (gainNodeRef.current) {
      try { gainNodeRef.current.disconnect(); } catch { }
      gainNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => { });
    }
    setStatus("processing");
  }, []);

  // Download video
  const downloadVideo = useCallback(() => {
    if (!videoUrl) return;

    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = `codepresenter-export-${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [videoUrl]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
      // Cleanup audio resources
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (gainNodeRef.current) {
        try { gainNodeRef.current.disconnect(); } catch { }
        gainNodeRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => { });
        audioContextRef.current = null;
      }
    };
  }, [videoUrl]);

  // Mute toggle handler — bypasses React render cycle entirely
  // Controls audio directly and updates button visual via DOM manipulation
  const toggleMute = useCallback(() => {
    isMutedRef.current = !isMutedRef.current;
    const muted = isMutedRef.current;

    // Control speaker volume via Web Audio GainNode — no separate element to interfere
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = muted ? 0 : 1;
    }

    // Update button visual directly via DOM — no React re-render
    const btn = muteButtonRef.current;
    if (btn) {
      btn.className = `flex items-center gap-1.5 backdrop-blur-sm px-3 py-1.5 rounded-full border transition-colors ${
        muted
          ? 'bg-neutral-700/50 border-neutral-600 text-neutral-400 hover:text-white'
          : 'bg-purple-500/20 border-purple-500/50 text-purple-400 hover:text-purple-300'
      }`;
      btn.title = muted ? 'Unmute voiceover' : 'Mute voiceover';
      // Update icon + text inside button
      const iconSpan = btn.querySelector('[data-mute-icon]') as HTMLElement;
      const textSpan = btn.querySelector('[data-mute-text]') as HTMLElement;
      if (textSpan) textSpan.textContent = muted ? 'Muted' : 'Audio';
      if (iconSpan) {
        iconSpan.innerHTML = muted
          ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>'
          : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
      }
    }
  }, []);

  const toggleHqPreviewMute = useCallback(() => {
    const nextMuted = !hqPreviewMuted;
    setHqPreviewMuted(nextMuted);
    previewFrameRef.current?.contentWindow?.postMessage({
      type: "cp-preview-audio-mute",
      muted: nextMuted,
    }, window.location.origin);
  }, [hqPreviewMuted]);

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const estimatedDuration = calculateTotalDuration();
  const resolutionLabel = videoFormat === "shorts" ? "1080×1920" : "1920×1080";
  const isHqPreviewActive = Boolean(renderPreviewUrl && status !== "idle" && status !== "error" && status !== "complete");

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={`bg-neutral-900 rounded-2xl shadow-2xl w-full flex flex-col border border-neutral-700 transition-all duration-300 ${isFullscreen ? 'max-w-full h-full max-h-full' : 'max-w-4xl max-h-[85vh]'}`}>
        {/* Header - Fixed */}
        <div className="bg-neutral-800 px-6 py-3 flex items-center justify-between border-b border-neutral-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Video className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white">Video Export Studio</h2>
            {teachingProvider && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  teachingProvider.configured
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-300"
                }`}
                title={`Teaching model: ${teachingProvider.model}`}
              >
                Powered by {teachingProvider.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="text-neutral-400 hover:text-white transition-colors p-1 rounded hover:bg-neutral-700"
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
            <button
              onClick={onClose}
              className="text-neutral-400 hover:text-white transition-colors"
              disabled={status === "recording"}
            >
              <Square className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content - Scrollable */}
        <div className={`p-4 overflow-y-auto flex-1 min-h-0 ${isHqPreviewActive ? 'flex flex-col' : 'space-y-4'}`}>
          {/* Preview Canvas - Adjusts based on fullscreen mode */}
          <div className={`relative bg-neutral-950 rounded-xl overflow-hidden border border-neutral-700 transition-all duration-300 ${isFullscreen || isHqPreviewActive ? 'flex-1 min-h-[420px]' : ''}`} style={isFullscreen ? {} : isHqPreviewActive ? { minHeight: 'min(72vh, 760px)' } : { height: '280px' }}>
            {renderPreviewUrl && status !== "idle" && status !== "error" && status !== "complete" ? (
              <iframe
                ref={previewFrameRef}
                src={renderPreviewUrl}
                className="w-full h-full bg-black"
                title="HQ render preview"
                allow="autoplay"
                onLoad={() => {
                  previewFrameRef.current?.contentWindow?.postMessage({
                    type: "cp-preview-audio-mute",
                    muted: hqPreviewMuted,
                  }, window.location.origin);
                }}
              />
            ) : (
              <canvas
                ref={canvasRef}
                className="w-full h-full object-contain"
                style={{ imageRendering: "crisp-edges" }}
              />
            )}

            {/* Overlay for idle state */}
            {status === "idle" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950/90">
                <Video className="w-16 h-16 text-indigo-400 mb-4" />
                <p className="text-xl font-semibold text-white mb-2">Ready to Record</p>
                <p className="text-neutral-400 text-sm">
                  {cells.length} cells • Estimated duration: {formatTime(estimatedDuration)}
                </p>
              </div>
            )}

            {/* Overlay for running state */}
            {status === "running" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950/90">
                <Loader2 className="w-16 h-16 text-amber-400 mb-4 animate-spin" />
                <p className="text-xl font-semibold text-white mb-2">Running All Cells...</p>
                <p className="text-neutral-400 text-sm">Executing code to capture outputs</p>
              </div>
            )}

            {/* Overlay for voice generation state */}
            {status === "generating_voice" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950/90">
                <Volume2 className="w-16 h-16 text-purple-400 mb-4 animate-pulse" />
                <p className="text-xl font-semibold text-white mb-2">Generating Voice Narration...</p>
                <p className="text-neutral-400 text-sm">Creating AI-powered script and audio</p>
                {voiceProgress > 0 && (
                  <div className="w-48 mt-4">
                    <Progress value={voiceProgress} className="h-2" />
                  </div>
                )}
              </div>
            )}

            {/* Recording indicator with mute control */}
            {status === "recording" && (
              <div className="absolute top-4 left-4 flex items-center gap-3">
                <div className="flex items-center gap-2 bg-red-500/20 backdrop-blur-sm px-3 py-1.5 rounded-full border border-red-500/50">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-red-400 text-sm font-medium">REC {formatTime(recordingTime)}</span>
                </div>
                {hasVoiceNarration && isHqPreviewActive && (
                  <button
                    onClick={toggleHqPreviewMute}
                    className={`flex items-center gap-1.5 backdrop-blur-sm px-3 py-1.5 rounded-full border transition-colors ${hqPreviewMuted ? 'bg-neutral-700/50 border-neutral-600 text-neutral-300 hover:text-white' : 'bg-purple-500/20 border-purple-500/50 text-purple-400 hover:text-purple-300'}`}
                    title={hqPreviewMuted ? "Unmute preview voiceover" : "Mute preview voiceover"}
                  >
                    {hqPreviewMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    <span className="text-xs font-medium">{hqPreviewMuted ? "Muted" : "Audio"}</span>
                  </button>
                )}
                {hasVoiceNarration && !isHqPreviewActive && audioRef.current && (
                  <button
                    ref={muteButtonRef}
                    onClick={toggleMute}
                    className="flex items-center gap-1.5 backdrop-blur-sm px-3 py-1.5 rounded-full border transition-colors bg-purple-500/20 border-purple-500/50 text-purple-400 hover:text-purple-300"
                    title="Mute voiceover"
                  >
                    <span data-mute-icon><Volume2 className="w-4 h-4" /></span>
                    <span data-mute-text className="text-xs font-medium">Audio</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Video Settings Panel - only show in idle state */}
          {status === "idle" && (
            <div className="bg-neutral-800/50 rounded-xl p-4 border border-neutral-700">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-neutral-400 mb-1 block">Video format</label>
                  <select
                    value={videoFormat}
                    onChange={(e) => setVideoFormat(e.target.value as VideoFormat)}
                    className="w-full bg-neutral-700 text-white text-sm rounded-lg px-3 py-2 border border-neutral-600 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="landscape">Landscape (16:9)</option>
                    <option value="shorts">Shorts (9:16)</option>
                  </select>
                </div>
              </div>
              <p className="text-xs text-neutral-500 mt-3">
                Typing pace follows the chosen detail level and is paced to the
                AI narration so code, output, and explanation stay in sync.
                Estimated duration: {formatTime(estimatedDuration)}
              </p>
              {teachingProvider && (
                <p className="text-xs text-neutral-500 mt-2">
                  Teaching script provider: {teachingProvider.label}
                  {!teachingProvider.configured ? " (not configured)" : ""}
                </p>
              )}
            </div>
          )}

          {status === "idle" && (
            <div className="bg-neutral-800/50 rounded-xl p-4 border border-neutral-700">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {enableVoice ? (
                    <Mic className="w-5 h-5 text-purple-400" />
                  ) : (
                    <MicOff className="w-5 h-5 text-neutral-500" />
                  )}
                  <span className="text-white font-medium">AI Voice Narration</span>
                </div>
                <button
                  onClick={() => setEnableVoice(!enableVoice)}
                  className={`relative w-12 h-6 rounded-full transition-colors ${enableVoice ? "bg-purple-600" : "bg-neutral-600"
                    }`}
                >
                  <div
                    className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${enableVoice ? "translate-x-7" : "translate-x-1"
                      }`}
                  />
                </button>
              </div>

              {enableVoice && (
                <div className="space-y-3 pt-2 border-t border-neutral-700">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-neutral-400 mb-1 block">Voice</label>
                      <select
                        value={selectedVoice}
                        onChange={(e) => setSelectedVoice(e.target.value as VoiceOption)}
                        className="w-full bg-neutral-700 text-white text-sm rounded-lg px-3 py-2 border border-neutral-600 focus:border-purple-500 focus:outline-none"
                      >
                        {VOICE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-neutral-400 mb-1 block">Style</label>
                      <select
                        value={narrationStyle}
                        onChange={(e) => setNarrationStyle(e.target.value as NarrationStyle)}
                        className="w-full bg-neutral-700 text-white text-sm rounded-lg px-3 py-2 border border-neutral-600 focus:border-purple-500 focus:outline-none"
                      >
                        <option value="educational">Educational</option>
                        <option value="professional">Professional</option>
                        <option value="casual">Casual</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-neutral-400 mb-1 block">Detail level</label>
                      <select
                        value={narrationDuration}
                        onChange={(e) => setNarrationDuration(e.target.value as NarrationDuration)}
                        className="w-full bg-neutral-700 text-white text-sm rounded-lg px-3 py-2 border border-neutral-600 focus:border-purple-500 focus:outline-none"
                      >
                        <option value="short">Short</option>
                        <option value="medium">Medium</option>
                        <option value="long">Long (more detailed)</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-neutral-400 mb-1 block">Custom instructions (Recommended)</label>
                    <textarea
                      value={narrationInstructions}
                      onChange={(e) => setNarrationInstructions(e.target.value)}
                      placeholder="E.g., Emphasize the tool-calling function, name functions explicitly, compare outputs, slow down on the final cell, etc."
                      className="w-full bg-neutral-700 text-white text-sm rounded-lg px-3 py-2 border border-neutral-600 focus:border-purple-500 focus:outline-none min-h-[72px]"
                    />
                  </div>

                </div>
              )}
            </div>
          )}

          {/* Generated Script Preview */}
          {generatedScript && status === "complete" && (
            <div className="bg-neutral-800/50 rounded-xl p-4 border border-neutral-700">
              <div className="flex items-center gap-2 mb-2">
                <Volume2 className="w-4 h-4 text-purple-400" />
                <span className="text-white font-medium text-sm">Generated Narration Script</span>
              </div>
              <p className="text-neutral-400 text-xs max-h-24 overflow-y-auto">
                {generatedScript}
              </p>
            </div>
          )}

          {/* Progress */}
          {(status === "running" || status === "preparing" || status === "recording" || status === "processing" || status === "generating_voice") && (
            isHqPreviewActive ? null : (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-400">
                    {renderStatusMessage ||
                      (status === "running" ? "Executing code cells..." :
                        status === "generating_voice" ? "Generating AI narration..." :
                          status === "recording" ? "Recording lesson in browser..." :
                            "Processing video...")}
                  </span>
                  <span className="text-neutral-400">{progress.toFixed(1)}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )
          )}

          {/* Error message */}
          {status === "error" && errorMessage && (
            <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <p className="text-red-400">{errorMessage}</p>
            </div>
          )}

          {/* Success message */}
          {status === "complete" && (
            <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
              <p className="text-green-400">Video exported successfully! Click download to save.</p>
            </div>
          )}

          {/* Video preview */}
          {status === "complete" && videoUrl && (
            <div className="rounded-xl overflow-hidden border border-neutral-700">
              <video
                src={videoUrl}
                controls
                className="w-full"
                style={{ maxHeight: "200px" }}
              />
            </div>
          )}
        </div>

        {/* Footer - Fixed with Actions */}
        <div className="px-4 py-3 bg-neutral-800 border-t border-neutral-700 flex-shrink-0">
          <div className="flex gap-3 justify-between items-center">
            <div className="text-xs text-neutral-500">
              {resolutionLabel} • 30 FPS • MP4
            </div>
            <div className="flex gap-3">
              {status === "idle" && (
                <Button onClick={startHqRender} className="bg-indigo-600 hover:bg-indigo-700">
                  <Play className="w-4 h-4 mr-2" />
                  Export Video (HQ)
                </Button>
              )}

              {status === "running" && (
                <Button disabled className="bg-amber-600">
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Running Cells...
                </Button>
              )}

              {status === "preparing" && (
                <Button disabled>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Preparing...
                </Button>
              )}

              {status === "recording" && (
                <Button disabled className="bg-indigo-600">
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Recording in browser...
                </Button>
              )}

              {status === "processing" && (
                <Button disabled>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </Button>
              )}

              {status === "complete" && (
                <>
                  <Button onClick={() => { setStatus("idle"); setRenderStatusMessage(""); setRenderPreviewUrl(null); setHqPreviewMuted(false); }} variant="outline">
                    Record Again
                  </Button>
                  <Button onClick={downloadVideo} className="bg-green-600 hover:bg-green-700">
                    <Download className="w-4 h-4 mr-2" />
                    Download Video
                  </Button>
                </>
              )}

              {status === "error" && (
                <Button onClick={() => { setStatus("idle"); setRenderStatusMessage(""); setRenderPreviewUrl(null); setHqPreviewMuted(false); }} variant="outline">
                  Try Again
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
