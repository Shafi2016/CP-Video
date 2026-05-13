// Voice Service - Gemma 4 for script generation, GPT-4o-mini-tts for voice synthesis
import OpenAI from "openai";
import { getOpenAIKey } from "../config";
import { generateTeachingScriptText, getTeachingProviderStatus, type TeachingProviderName } from "./ai-providers";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { resolveFFprobeExecutable, resolveFFmpegExecutable } from "../ffmpeg-utils";

// Voice options for TTS
const ELEVENLABS_VOICES = {
  rachel: "21m00Tcm4TlvDq8ikWAM",
  adam: "pNInz6obpgDQGcFmaJgB",
  antoni: "ErXwobaYiN019PkySvjV",
  bella: "EXAVITQu4vr4xnSDxMaL",
  josh: "TxGEqnHWrfWFTfGW9XjX",
  elli: "MF3mGyEYCl7XYWbV9V6O",
  haytham: "UR972wNGq3zluze0LoIp",
  marcotrox: "W71zT1VwIFFx3mMGH2uZ",
} as const;

type OpenAIVoiceOption = "alloy" | "ash" | "ballad" | "coral" | "marin" | "cedar";
type ElevenLabsVoiceOption = keyof typeof ELEVENLABS_VOICES;
export type VoiceOption = OpenAIVoiceOption | ElevenLabsVoiceOption;

export interface Cell {
  id: string;
  type: "code" | "markdown";
  content: string;
  outputs?: any[];
}

export interface ScriptGenerationRequest {
  cells: Cell[];
  context?: string; // Optional additional context about the data/purpose
  style?: "educational" | "professional" | "casual";
  duration?: "short" | "medium" | "long"; // Affects verbosity
  aiProvider?: TeachingProviderName | "auto";
  aiModel?: string;
}

export interface ScriptSegment {
  cellIndex: number;
  cellType: "code" | "markdown";
  script: string;
  estimatedDuration: number; // in seconds
}

export interface GeneratedScript {
  segments: ScriptSegment[];
  totalDuration: number;
  fullScript: string;
  provider?: string;
  model?: string;
}

export interface TTSRequest {
  text: string;
  voice?: VoiceOption;
  instructions?: string;
  format?: "mp3" | "wav" | "opus" | "aac" | "flac";
}

export interface TTSResponse {
  audioBuffer: Buffer;
  format: string;
  duration?: number;
}

function normalizeTtsText(text: string): string {
  return text.replace(/\s+/g, " ").trim() || " ";
}

const MAX_TTS_CHARS_PER_REQUEST = 4500;

function readSecretValue(names: string[]): string | null {
  for (const name of names) {
    const envValue = process.env[name]?.trim();
    if (envValue) {
      return envValue;
    }

    const filePath = process.env[`${name}_FILE`]?.trim();
    if (filePath && fs.existsSync(filePath)) {
      const fileValue = fs.readFileSync(filePath, "utf8").trim();
      if (fileValue) {
        return fileValue;
      }
    }
  }

  return null;
}

function getElevenLabsKey(): string | null {
  return readSecretValue(["ELEVENLABS_API_KEY", "XI_API_KEY"]);
}

function isElevenLabsVoice(voice: string): voice is ElevenLabsVoiceOption {
  return Object.prototype.hasOwnProperty.call(ELEVENLABS_VOICES, voice);
}

async function getAudioDurationSeconds(filePath: string): Promise<number> {
  const ffprobe = resolveFFprobeExecutable();

  return new Promise<number>((resolve, reject) => {
    const proc = spawn(
      ffprobe,
      ["-i", filePath, "-show_entries", "format=duration", "-v", "quiet", "-of", "csv=p=0"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    proc.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr.trim()}`));
        return;
      }

      const duration = parseFloat(stdout.trim());
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error(`ffprobe returned invalid duration: ${stdout.trim()}`));
        return;
      }

      resolve(duration);
    });
  });
}

function splitTextForTts(text: string, maxChars: number = MAX_TTS_CHARS_PER_REQUEST): string[] {
  const normalized = normalizeTtsText(text);
  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const sentenceMatches = normalized.match(/[^.!?]+(?:[.!?]+|$)/g);
  const units = (sentenceMatches && sentenceMatches.length ? sentenceMatches : [normalized])
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    const value = current.trim();
    if (value) {
      chunks.push(value);
    }
    current = "";
  };

  for (const unit of units) {
    if (unit.length > maxChars) {
      pushCurrent();
      const words = unit.split(/\s+/).filter(Boolean);
      let wordChunk = "";
      for (const word of words) {
        const candidate = wordChunk ? `${wordChunk} ${word}` : word;
        if (candidate.length <= maxChars) {
          wordChunk = candidate;
        } else {
          if (wordChunk) {
            chunks.push(wordChunk);
          }
          wordChunk = word;
        }
      }
      const finalWordChunk = wordChunk.trim();
      if (finalWordChunk) {
        chunks.push(finalWordChunk);
      }
      continue;
    }

    const candidate = current ? `${current} ${unit}` : unit;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      pushCurrent();
      current = unit;
    }
  }

  pushCurrent();
  return chunks.length ? chunks : [" "];
}

function stripMarkdownFences(text: string): string {
  // Models sometimes wrap the JSON in ```json ... ``` (or ``` ... ```).
  // Strip the outermost fence so the brace walker sees clean JSON.
  const trimmed = text.trim();
  const fenceMatch = /^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  if (fenceMatch) {
    return fenceMatch[1];
  }
  return text;
}

function extractJsonObjects(text: string): string[] {
  const source = stripMarkdownFences(text);
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      // Only treat quotes as string boundaries once we're already inside a
      // candidate object. Stray quotes in preamble text (e.g. "Sure, here's
      // the JSON: ...") would otherwise corrupt the string-tracking state and
      // produce candidates with trailing garbage.
      if (depth > 0) {
        inString = true;
      }
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(source.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects;
}

/**
 * Try to coerce a candidate string into something JSON.parse will accept.
 * Returns ordered variants to try (best guesses first).
 */
function buildParseVariants(candidate: string): string[] {
  const variants: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | null | undefined) => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    variants.push(trimmed);
  };

  push(candidate);
  push(stripMarkdownFences(candidate));

  // If V8 reports "Unexpected non-whitespace character after JSON at
  // position N", the candidate contains a fully valid JSON value followed by
  // trailing junk. Slice up to N and retry.
  for (const variant of [...variants]) {
    try {
      JSON.parse(variant);
    } catch (error) {
      const message = String((error as Error)?.message || "");
      const match = /position (\d+)/.exec(message);
      if (!match) continue;
      const pos = Number(match[1]);
      if (!Number.isFinite(pos) || pos <= 0 || pos > variant.length) continue;
      // Trailing-content error: slice up to the boundary.
      if (/after JSON/i.test(message)) {
        push(variant.slice(0, pos));
      }
    }
  }

  return variants;
}

function parseScriptJson(outputText: string): any {
  const candidates = extractJsonObjects(outputText);
  if (!candidates.length) {
    console.warn(
      "[VoiceService] parseScriptJson: no JSON objects found in model output. First 300 chars:",
      JSON.stringify(outputText.slice(0, 300)),
    );
    throw new Error("Failed to parse script response");
  }

  let lastParseError: unknown = null;
  let bestParsed: any = null;
  let bestScore = -1;

  for (const rawCandidate of candidates) {
    const variants = buildParseVariants(rawCandidate);
    for (const candidate of variants) {
      try {
        const parsed = JSON.parse(candidate);
        const segments = Array.isArray(parsed?.segments) ? parsed.segments : [];
        if (!segments.length) continue;

        const score = segments.reduce((sum: number, segment: any) => {
          return sum + (typeof segment?.script === "string" ? segment.script.length : 0);
        }, 0);

        if (score > bestScore) {
          bestParsed = parsed;
          bestScore = score;
        }
        break; // succeeded for this candidate; skip remaining variants
      } catch (error) {
        lastParseError = error;
      }
    }
  }

  if (bestParsed) {
    return bestParsed;
  }

  // Surface diagnostics so the next failure is debuggable.
  console.warn(
    "[VoiceService] parseScriptJson: all candidates failed to parse.",
    "candidateCount=", candidates.length,
    "candidateLengths=", candidates.map((c) => c.length).join(","),
    "firstCandidateHead=", JSON.stringify(candidates[0]?.slice(0, 200) ?? ""),
    "firstCandidateTail=", JSON.stringify(candidates[0]?.slice(-100) ?? ""),
    "rawHead=", JSON.stringify(outputText.slice(0, 200)),
    "lastError=", String((lastParseError as Error)?.message || lastParseError || ""),
  );

  throw lastParseError instanceof Error
    ? lastParseError
    : new Error("Failed to parse script response");
}

async function concatAudioFiles(
  inputs: string[],
  output: string,
  format: "mp3" | "wav"
): Promise<void> {
  if (inputs.length === 0) {
    throw new Error("concatAudioFiles: no input files provided");
  }

  const outputExt = path.extname(output).toLowerCase().replace(/^\./, "");
  const inputExt = path.extname(inputs[0] || "").toLowerCase().replace(/^\./, "");

  if (inputs.length === 1 && inputExt === outputExt && (format === "mp3" || format === "wav")) {
    await fs.promises.copyFile(inputs[0], output);
    return;
  }

  const ffmpeg = resolveFFmpegExecutable();
  const listPath = `${output}.concat.txt`;
  const listContent = inputs
    .map((file) => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
    .join("\n");
  await fs.promises.writeFile(listPath, listContent, "utf8");

  const args = [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
  ];
  if (format === "mp3") {
    args.push("-c:a", "copy");
  } else {
    args.push("-c:a", "pcm_s16le");
  }
  args.push(output);

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg concat failed (code ${code}): ${stderr.trim().slice(-500)}`));
      });
    });
  } finally {
    await fs.promises.unlink(listPath).catch(() => undefined);
  }
}

class VoiceService {
  private openai: OpenAI | null = null;
  private audioDir: string;

  constructor() {
    this.audioDir = path.join(process.cwd(), "uploads", "audio");
    this.ensureAudioDir();
  }

  private ensureAudioDir() {
    if (!fs.existsSync(this.audioDir)) {
      fs.mkdirSync(this.audioDir, { recursive: true });
    }
  }

  private getClient(): OpenAI {
    if (!this.openai) {
      const apiKey = getOpenAIKey();
      if (!apiKey) {
        throw new Error("OpenAI API key not configured");
      }
      this.openai = new OpenAI({ apiKey });
    }
    return this.openai;
  }

  getTeachingProviderStatus() {
    return getTeachingProviderStatus();
  }

  /**
   * Generate a narration script for notebook cells using Gemma 4.
   */
  async generateScript(request: ScriptGenerationRequest): Promise<GeneratedScript> {
    const styleInstructions = {
      educational: "Use a friendly, educational tone. Explain concepts clearly as if teaching a student.",
      professional: "Use a clear, professional tone suitable for presentations and demos.",
      casual: "Use a relaxed, conversational tone as if explaining to a friend.",
    };

    const verbosityGuide = {
      short: "Keep explanations concise but instructional: ~4-6 spoken lines (about 60-95 words) per cell. For cells with outputs, ALWAYS include at least one sentence interpreting the output.",
      medium: "Use real classroom detail and aim for at least a 3-minute lesson overall. For small notebooks, expand the explanation instead of making a short clip. Take time to explain each step. For cells with outputs, dedicate AT LEAST 4-5 sentences to interpreting the output: what it shows, the specific value or pattern, what the viewer should notice, and the takeaway. Do not stop the segment until the output has been explained.",
      long: "Use thorough tutor-style depth and aim for a long-form lesson overall. Explain every concept, every line of importance, every output in detail. Speak as if the viewer is seeing this for the first time and needs to truly understand each piece before moving on. Include pauses, recaps, and explicit interpretation of every output or equation.",
    };

    const style = request.style || "educational";
    const duration = request.duration || "medium";
    const customInstructionBlock = request.context
      ? `User custom instructions (highest priority): ${request.context}`
      : "No custom instructions provided. Use the default tutor framework below.";
    const defaultTutorFramework = `Default tutor framework for each cell:
1) Start by saying what this example does.
2) Explain one important line or operation.
3) Explain why it matters.
4) End with a short takeaway.`;

    // Per-cell minimum word target so the model can't under-deliver.
    // Driven by code length and whether the cell has an output to explain.
    const wordsPerCharByDuration: Record<string, number> = {
      short: 0.35,
      medium: 0.65,
      long: 1.0,
    };
    const outputBonusByDuration: Record<string, number> = {
      short: 25,
      medium: 60,
      long: 100,
    };
    const markdownTargetByDuration: Record<string, number> = {
      short: 30,
      medium: 55,
      long: 90,
    };
    const wpc = wordsPerCharByDuration[duration] ?? wordsPerCharByDuration.medium;
    const outputBonus = outputBonusByDuration[duration] ?? outputBonusByDuration.medium;
    const markdownTarget = markdownTargetByDuration[duration] ?? markdownTargetByDuration.medium;

    let perCellTargets = request.cells.map((cell) => {
      if (cell.type === "markdown") return markdownTarget;
      const codeChars = cell.content.length;
      const hasOutputs = Array.isArray(cell.outputs) && cell.outputs.length > 0;
      const base = Math.max(40, Math.round(codeChars * wpc));
      return base + (hasOutputs ? outputBonus : 0);
    });

    const minimumTotalWordsByDuration: Record<string, number> = {
      short: 180,
      medium: 430,
      long: 720,
    };
    const minimumTotalWords = minimumTotalWordsByDuration[duration] ?? minimumTotalWordsByDuration.medium;
    const rawTotalWords = perCellTargets.reduce((sum, value) => sum + value, 0);
    if (rawTotalWords > 0 && rawTotalWords < minimumTotalWords) {
      const scale = minimumTotalWords / rawTotalWords;
      perCellTargets = perCellTargets.map((target) => Math.max(target, Math.ceil(target * scale)));
    }

    // Build the prompt with cell contents
    const cellDescriptions = request.cells.map((cell, index) => {
      const outputSummary = cell.outputs?.length
        ? `\nOutputs: ${summarizeOutputs(cell.outputs)}`
        : "";
      const target = perCellTargets[index];
      return `Example ${index + 1} (${cell.type}) — minimum ${target} spoken words:
\`\`\`
${cell.content}
\`\`\`${outputSummary}`;
    }).join("\n\n");

    const totalMinWords = perCellTargets.reduce((sum, value) => sum + value, 0);

    const systemPrompt = `You are Gemma 4 acting as an expert AI instructor:
- AI expert, ML expert, Generative AI expert, and a Python/AI engineer
- Your audience is first-year college students learning programming and AI concepts

Your task is to generate a clear, engaging narration script for a code presentation video.

=== USER CUSTOM INSTRUCTIONS (HIGHEST PRIORITY — follow these strictly) ===
${customInstructionBlock}
If the user's instructions specify a teaching structure, tone, or style, apply that structure to EVERY cell in the notebook. The user's instructions override any conflicting default below.
=== END USER CUSTOM INSTRUCTIONS ===

${styleInstructions[style]}
${verbosityGuide[duration]}

Teaching guidelines:
- Explain step-by-step with simple language; define key terms when they first appear
- Focus on intuition and why each step matters; connect concepts to outcomes
- Highlight important lines of code and the role they play; avoid reading code verbatim
- Use brief, concrete examples or analogies when helpful
- Summarize outputs and visuals so a beginner understands what to notice
- Keep pacing instructional and supportive; include natural transitions between cells
- Be specific: refer to code identifiers explicitly (function and variable names). If the user asks not to mention cell numbers, do not use phrases like "Cell 1"/"Cell 2"; prefer intros like "In this example...", "Here we focus on...", and vary phrasing across examples.
- When a function is defined, briefly describe its purpose, key parameters, return value, and where it is used next.
- If a function performs tool-calling or interacts with external systems/APIs, explain why it is invoked, its inputs/outputs, and any error handling or safety checks.
- Connect related cells so the flow of data and functions is clear across the notebook.
- Ensure the final item gets thorough coverage and a concise wrap-up of what the notebook achieved.
  - IMPORTANT: If a cell has outputs (text/table/chart/equation), you MUST dedicate a substantial portion of the narration to explaining the output. State what the output shows, interpret specific values or patterns, explain what the viewer should notice, and connect it to the code that produced it. Viewers are just as interested in the output as the code itself — never skip or rush the output explanation.
  - Return exactly one segment per notebook cell in the same order.
  - If user instructions include example concept labels, apply that teaching style to every cell generically.
  - IMPORTANT: Do NOT rush. Write scripts that feel like a calm, patient human tutor explaining on screen. Each segment should be long enough to genuinely teach, not just mention.
  - For ${duration} mode: ${duration === 'long' ? 'Write detailed instructor-style scripts. Each meaningful code cell should usually be 200 to 340 words. Explain the key lines, the purpose of the step, what the output means in detail, and the takeaway.' : duration === 'medium' ? 'Write balanced instructor-style scripts. Each meaningful code cell should usually be 110 to 180 words. Explain the main step, the key line, and ALWAYS spend at least 3 sentences interpreting the output if one exists.' : 'Keep it concise but educational, usually 60 to 95 words per code cell. If an output exists, include at least one sentence interpreting it.'}

${defaultTutorFramework}

Output format: Return a JSON object with this structure:
{
  "segments": [
    {
      "cellIndex": 0,
      "script": "Your narration for this cell..."
    }
  ]
}`;

    const userPrompt = `Generate a narration script for this notebook presentation:

${cellDescriptions}

Remember to return valid JSON with the segments array.
Important constraints:
- Include exactly ${request.cells.length} segments.
- cellIndex must range from 0 to ${Math.max(0, request.cells.length - 1)} and appear in ascending order.
- Each segment should be beginner-friendly spoken narration, not code.
- HARD MINIMUM WORD COUNTS — these are floors, not targets, and must each be met:
${perCellTargets.map((target, idx) => `  - Cell ${idx} (${request.cells[idx]?.type}): at least ${target} words`).join("\n")}
- HARD MINIMUM TOTAL: the full script across all segments must be at least ${totalMinWords} words. Do not stop short of these floors.
- User custom instructions have highest priority. If the user asks for slower, deeper, instructor-style teaching, follow that even if it makes the video longer.
- Do NOT rush the narration to fit a short video. The frontend timeline will adapt to the script and audio duration.
- ${duration === 'long'
  ? 'Use patient instructor depth. The full script should usually be at least 720 spoken words. Explain key code lines, equations, outputs, and takeaways.'
  : duration === 'medium'
    ? 'Use real instructor pacing. The full script must be at least 430 spoken words so the final narration is about 3 minutes or longer. Explain the main lines, outputs, and takeaway clearly.'
    : 'Keep it concise but still educational, usually 60 to 95 words per code cell.'}
- If outputs exist, dedicate at least 3-4 sentences to interpreting and explaining those outputs (what it shows, the value or pattern, what to notice, the takeaway). Do not end the segment without explaining the output.
- If equations exist, explain the equation piece by piece: what each symbol means, what operation is happening, and why the formula matters.`;

    try {
      // Generous output cap so the model can deliver the per-cell minimums
      // without being silently truncated. ~2.2 tokens per word as a buffer.
      const maxOutputTokens = Math.max(2000, Math.ceil(totalMinWords * 2.2) + 800);

      const response = await generateTeachingScriptText({
        systemPrompt,
        userPrompt,
        maxOutputTokens,
        provider: request.aiProvider,
        model: request.aiModel,
      });

      const outputText = response.text || "";
      
      // Parse the JSON response
      const parsed = parseScriptJson(outputText);
      const rawSegments: any[] = Array.isArray(parsed?.segments) ? parsed.segments : [];

      // Normalize model output into exactly one segment per cell.
      const mergedByCell = new Map<number, string>();
      for (let i = 0; i < rawSegments.length; i++) {
        const seg = rawSegments[i] || {};
        const fallbackIdx = Math.min(i, request.cells.length - 1);
        const rawIdx = Number.isInteger(seg.cellIndex) ? seg.cellIndex : fallbackIdx;
        const cellIndex = Math.max(0, Math.min(request.cells.length - 1, rawIdx));
        const scriptText = typeof seg.script === "string" ? seg.script.trim() : "";
        if (!scriptText) continue;
        const prev = mergedByCell.get(cellIndex);
        mergedByCell.set(cellIndex, prev ? `${prev}\n${scriptText}` : scriptText);
      }

      const segments: ScriptSegment[] = request.cells.map((cell, cellIndex) => {
        const script = mergedByCell.get(cellIndex) || buildFallbackSegmentScript(cell);
        const estimatedDuration = estimateSegmentDurationSeconds(script, cell, duration);
        return {
          cellIndex,
          cellType: cell.type,
          script,
          estimatedDuration,
        };
      });

      // If user instructions ask to avoid "Cell N" phrasing, sanitize the scripts accordingly
      const ctxLower = (request.context || "").toLowerCase();
      const avoidCellPhrasing = /do not[^.]*cell|don't[^.]*cell|avoid[^.]*cell|no\s+cell\s+numbers/.test(ctxLower);
      const finalSegments: ScriptSegment[] = avoidCellPhrasing
        ? segments.map((s) => {
            // Replace common patterns like "In Cell 2", "Cell 3:", or standalone "Cell 4"
            const cleaned = s.script
              .replace(/\b[Ii]n\s+[Cc]ell\s+\d+\b/g, "In this example")
              .replace(/\b[Cc]ell\s+\d+:\s*/g, "")
              .replace(/\b[Cc]ell\s+\d+\b/g, "this example");
            return { ...s, script: cleaned };
          })
        : segments;

      const outputMentionRegex = /\b(output|result|plot|chart|graph|table|equation|value|values|error|prediction|prints?|displays?|shows?)\b/gi;
      const minOutputMentionsByDuration: Record<string, number> = {
        short: 1,
        medium: 2,
        long: 3,
      };
      const minOutputMentions = minOutputMentionsByDuration[duration] ?? 2;

      const buildOutputCoverageAppendix = (cell: Cell): string => {
        const summary = summarizeOutputs(cell.outputs || []);
        const lower = summary.toLowerCase();
        if (lower.includes("error")) {
          return " Look at the output: this raised an error, so we can read the traceback to see exactly what failed and why, then use that hint to fix the issue.";
        }
        if (lower.includes("chart") || lower.includes("plot") || lower.includes("visual")) {
          return " Look at the chart: notice the overall shape and any peaks, dips, or trends. Each axis tells us a different dimension of the data, and the pattern is what the code was meant to reveal.";
        }
        if (lower.includes("html") || lower.includes("table")) {
          return " Look at the table: skim a few rows and columns, notice the value ranges, and confirm the data lines up with what the code was meant to compute.";
        }
        return " Look at the output now on screen: read the printed values, notice what they tell us about the step we just ran, and confirm they match what we expected from the code.";
      };

      const withOutputCoverage: ScriptSegment[] = finalSegments.map((seg) => {
        const cell = request.cells[seg.cellIndex];
        const hasOutputs = cell?.type === "code" && Array.isArray(cell.outputs) && cell.outputs.length > 0;
        if (!hasOutputs) return seg;
        const mentions = (seg.script.match(outputMentionRegex) || []).length;
        if (mentions >= minOutputMentions) return seg;
        return {
          ...seg,
          script: `${seg.script}${buildOutputCoverageAppendix(cell)}`
        };
      });

      const finalizedSegments: ScriptSegment[] = withOutputCoverage.map((seg) => {
        const cell = request.cells[seg.cellIndex] || request.cells[0];
        return {
          ...seg,
          estimatedDuration: estimateSegmentDurationSeconds(seg.script, cell, duration),
        };
      });

      const totalDuration = finalizedSegments.reduce((sum, s) => sum + s.estimatedDuration, 0);
      const fullScript = finalizedSegments.map((s) => s.script).join("\n\n");

      return {
        segments: finalizedSegments,
        totalDuration,
        fullScript,
        provider: response.provider,
        model: response.model,
      };
    } catch (error: any) {
      console.error("[VoiceService] Script generation error:", error);
      throw new Error(`Script generation failed: ${error.message}`);
    }
  }

  /**
   * Generate speech audio using GPT-4o-mini-tts
   */
  async generateSpeech(request: TTSRequest): Promise<TTSResponse> {
    const text = normalizeTtsText(request.text);
    const voice = request.voice || "cedar";
    const format = request.format || "mp3";
    const instructions = request.instructions || "Clear, engaging narration with natural pacing. Slightly slower than normal for educational content.";

    try {
      if (isElevenLabsVoice(voice)) {
        return await this.generateElevenLabsSpeech(text, voice, format);
      }

      const client = this.getClient();

      // Use AbortController to timeout after 60 seconds
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      const audio = await client.audio.speech.create(
        {
          model: "gpt-4o-mini-tts",
          voice,
          input: text,
          instructions,
          response_format: format,
        },
        { signal: controller.signal as any }
      );

      clearTimeout(timeout);
      const audioBuffer = Buffer.from(await audio.arrayBuffer());

      return {
        audioBuffer,
        format,
      };
    } catch (error: any) {
      console.error("[VoiceService] TTS error:", error);
      throw new Error(`Speech generation failed: ${error.message}`);
    }
  }

  private async generateElevenLabsSpeech(
    text: string,
    voice: ElevenLabsVoiceOption,
    format: TTSRequest["format"] = "mp3"
  ): Promise<TTSResponse> {
    if (format !== "mp3") {
      throw new Error("ElevenLabs voices currently support mp3 output only");
    }

    const apiKey = getElevenLabsKey();
    if (!apiKey) {
      throw new Error("ElevenLabs API key not configured");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICES[voice]}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(errorText || `ElevenLabs request failed with status ${response.status}`);
      }

      return {
        audioBuffer: Buffer.from(await response.arrayBuffer()),
        format: "mp3",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Generate complete audio narration for a notebook
   * Returns the path to the saved audio file
   */
  async generateNarrationAudio(
    request: ScriptGenerationRequest,
    voice: VoiceOption = "cedar",
    format: "mp3" | "wav" = "mp3"
  ): Promise<{ audioPath: string; script: GeneratedScript; audioDurationSeconds: number }> {
    // Step 1: Generate the script
    console.log("[VoiceService] Generating narration script...");
    const script = await this.generateScript(request);

    // Step 2: Generate speech for the full script
    console.log("[VoiceService] Generating speech audio...");
    const narrationDuration = request.duration || "medium";
    const pacingInstruction = narrationDuration === "long"
      ? "Speak slowly and patiently like a careful coding instructor, roughly 85 to 100 words per minute. Pause after important code lines, equations, outputs, and takeaways."
      : narrationDuration === "medium"
        ? "Speak like a real classroom instructor, roughly 95 to 110 words per minute. Use natural pauses between code explanation and output interpretation."
        : "Speak clearly at a normal tutorial pace, roughly 125 to 145 words per minute, with brief pauses between steps.";
    const ttsInstruction = [
      "You are narrating an on-screen coding lesson for beginners.",
      pacingInstruction,
      "Use a warm, calm, practical, beginner-friendly delivery. Emphasize takeaways and key insights.",
      "Pause briefly at paragraph breaks so viewers can absorb what they see on screen without stalling the lesson.",
      "Keep setup, import, and short utility cells brief unless the user context explicitly asks for deep detail.",
      request.context ? `Follow this user guidance carefully: ${request.context}` : "",
    ].filter(Boolean).join(" ");
    const timestamp = Date.now();
    const segmentPaths: string[] = [];
    const alignedSegments: ScriptSegment[] = [];

    try {
      for (let i = 0; i < script.segments.length; i += 1) {
        const segment = script.segments[i];
        const segmentText = segment.script?.trim() ? segment.script : " ";
        const segmentChunks = splitTextForTts(segmentText);
        let segmentDurationSeconds = 0;

        for (let chunkIndex = 0; chunkIndex < segmentChunks.length; chunkIndex += 1) {
          const chunkText = segmentChunks[chunkIndex];
          const ttsResponse = await this.generateSpeech({
            text: chunkText,
            voice,
            format,
            instructions: ttsInstruction,
          });

          const segmentPath = path.join(
            this.audioDir,
            `narration_${timestamp}_seg_${String(i).padStart(4, "0")}_chunk_${String(chunkIndex).padStart(2, "0")}.${format}`
          );
          await fs.promises.writeFile(segmentPath, ttsResponse.audioBuffer);
          segmentPaths.push(segmentPath);

          const chunkDuration = await getAudioDurationSeconds(segmentPath).catch((error) => {
            console.warn("[VoiceService] Failed to measure narration chunk duration, falling back to proportional estimate:", error);
            return Math.max(0.2, segment.estimatedDuration / Math.max(1, segmentChunks.length));
          });
          segmentDurationSeconds += Math.max(0.2, chunkDuration || 0);
        }

        alignedSegments.push({
          ...segment,
          estimatedDuration: segmentDurationSeconds || segment.estimatedDuration,
        });
      }

      const filename = `narration_${timestamp}.${format}`;
      const audioPath = path.join(this.audioDir, filename);
      await concatAudioFiles(segmentPaths, audioPath, format);
      console.log(`[VoiceService] Audio saved: ${audioPath}`);

      await Promise.all(
        segmentPaths.map((filePath) => fs.promises.unlink(filePath).catch(() => undefined))
      );

      const audioDurationSeconds = alignedSegments.reduce(
        (sum, segment) => sum + Math.max(0, segment.estimatedDuration || 0),
        0
      );

      return {
        audioPath: `/uploads/audio/${filename}`,
        script: {
          ...script,
          segments: alignedSegments,
          totalDuration: audioDurationSeconds,
        },
        audioDurationSeconds,
      };
    } catch (error) {
      await Promise.all(
        segmentPaths.map((filePath) => fs.promises.unlink(filePath).catch(() => undefined))
      );
      throw error;
    }
  }

  /**
   * Generate speech for individual segments (for sync with video)
   */
  async generateSegmentAudio(
    segments: ScriptSegment[],
    voice: VoiceOption = "cedar",
    format: "mp3" | "wav" = "mp3"
  ): Promise<Array<{ segmentIndex: number; audioPath: string; duration: number }>> {
    const results: Array<{ segmentIndex: number; audioPath: string; duration: number }> = [];
    const timestamp = Date.now();

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      console.log(`[VoiceService] Generating audio for segment ${i + 1}/${segments.length}...`);

      try {
        const ttsResponse = await this.generateSpeech({
          text: segment.script,
          voice,
          format,
          instructions: "Clear narration with natural pacing. Add a brief pause at the end.",
        });

        const filename = `segment_${timestamp}_${i}.${format}`;
        const audioPath = path.join(this.audioDir, filename);
        await fs.promises.writeFile(audioPath, ttsResponse.audioBuffer);

        results.push({
          segmentIndex: i,
          audioPath: `/uploads/audio/${filename}`,
          duration: segment.estimatedDuration,
        });
      } catch (error) {
        console.error(`[VoiceService] Failed to generate segment ${i}:`, error);
        // Continue with other segments
      }
    }

    return results;
  }
}

// Helper function to summarize cell outputs for context
function buildFallbackSegmentScript(cell: Cell): string {
  if (cell.type === "markdown") {
    const title = cell.content.replace(/^#+\s*/, "").split("\n")[0]?.trim() || "this concept";
    return `In this section, we introduce ${title}. Focus on the key idea, why it matters, and how it connects to the next step.`;
  }

  const hasOutputs = Array.isArray(cell.outputs) && cell.outputs.length > 0;
  return hasOutputs
    ? "In this example, we run code for a clear purpose, explain the key line, and then interpret the output so you know what to learn from the result."
    : "In this example, we run code for a clear purpose, focus on the important line, and explain why this approach matters.";
}

function estimateSegmentDurationSeconds(
  script: string,
  cell: Cell,
  duration: ScriptGenerationRequest["duration"]
): number {
  const normalizedDuration = duration || "medium";
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  // Words per second tuned for a natural teaching pace that still keeps
  // short notebook exports moving.
  const wordsPerSecond = normalizedDuration === "long"
    ? 1.9
    : normalizedDuration === "medium"
      ? 2.35
      : 2.7;
  const baseSpeechSeconds = words / wordsPerSecond;

  const hasOutputs = cell.type === "code" && Array.isArray(cell.outputs) && cell.outputs.length > 0;
  // Extra pause time for output interpretation
  const outputPause = hasOutputs
    ? (normalizedDuration === "long" ? 2.0 : normalizedDuration === "medium" ? 1.1 : 0.6)
    : (normalizedDuration === "long" ? 0.9 : 0.45);

  // Minimum durations ensure each cell gets enough screen time
  const minByMode = cell.type === "markdown"
    ? (normalizedDuration === "long" ? 8 : normalizedDuration === "medium" ? 4 : 2)
    : (normalizedDuration === "long" ? 9 : normalizedDuration === "medium" ? 5 : 2.5);

  return Math.max(minByMode, Math.ceil(baseSpeechSeconds + outputPause));
}

function summarizeOutputs(outputs: any[]): string {
  const summaries: string[] = [];

  for (const output of outputs) {
    if (output.text) {
      const text = Array.isArray(output.text) ? output.text.join("") : output.text;
      summaries.push(`Text output: ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}`);
    }
    if (output.data?.["image/png"] || output.data?.["image/jpeg"]) {
      summaries.push("Visual output: Chart/Plot image");
    }
    if (output.data?.["text/html"]) {
      summaries.push("HTML output (table or visualization)");
    }
    if (output.traceback) {
      summaries.push("Error output");
    }
  }

  return summaries.join("; ") || "No output";
}

// Export singleton instance
export const voiceService = new VoiceService();
