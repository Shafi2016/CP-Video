import { useEffect, useMemo, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { Cell, CellOutput } from "@/types";

declare global {
    interface Window {
        __exportReady?: boolean;
        __exportDurationMs?: number;
        __setExportTime?: (timeMs: number) => void;
        __renderedTimeMs?: number;
    }
}

interface JobData {
    notebook: {
        cells: Cell[];
    };
    presentationSpeed: number;
}

// Exactly match the app's timing constants
const PAUSE_BEFORE_EXEC = 500; // Parity with CodeCell.tsx line 216
const PAUSE_AFTER_CELL = 1500;
const PAUSE_AFTER_MARKDOWN = 2500;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const getRevealWindow = (totalItems: number, viewportItems: number, progress: number) => {
    const safeTotal = Math.max(0, totalItems);
    const safeViewport = Math.max(1, viewportItems);

    if (safeTotal === 0) {
        return { start: 0, end: 0 };
    }

    const revealedCount = Math.max(1, Math.min(safeTotal, Math.ceil(safeTotal * clamp(progress, 0, 1))));
    const end = revealedCount;
    const start = Math.max(0, end - safeViewport);

    return { start, end };
};

function escapeHtml(input: string): string {
    return input
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function renderLatex(tex: string, displayMode: boolean): string {
    try {
        return katex.renderToString(tex.trim(), { displayMode, throwOnError: false, trust: true });
    } catch {
        return `<code>${escapeHtml(tex)}</code>`;
    }
}

function renderInlineMath(input: string): string {
    const inlineMathPattern = /(\$[^$\n]+?\$|\\\([^$\n]+?\\\))/g;
    let output = "";
    let cursor = 0;
    let match: RegExpExecArray | null = null;

    while ((match = inlineMathPattern.exec(input)) !== null) {
        output += escapeHtml(input.slice(cursor, match.index));
        const token = match[0];
        if (token.startsWith("$") && token.endsWith("$")) {
            output += renderLatex(token.slice(1, -1), false);
        } else if (token.startsWith("\\(") && token.endsWith("\\)")) {
            output += renderLatex(token.slice(2, -2), false);
        } else {
            output += escapeHtml(token);
        }
        cursor = match.index + match[0].length;
    }

    output += escapeHtml(input.slice(cursor));
    return output;
}

function renderTextBlock(text: string): string {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (!lines.length) return "";

    const areListLines = lines.every((line) => /^[-*+]\s+/.test(line));
    if (areListLines) {
        const items = lines
            .map((line) => line.replace(/^[-*+]\s+/, ""))
            .map((line) => `<li>${renderInlineMath(line)}</li>`)
            .join("");
        return `<ul class="cpx-md-list">${items}</ul>`;
    }

    return lines
        .map((line) => {
            const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
            if (headingMatch) {
                const level = Math.min(3, headingMatch[1].length);
                return `<h${level} class="cpx-md-h${level}">${renderInlineMath(headingMatch[2])}</h${level}>`;
            }
            return `<p class="cpx-md-p">${renderInlineMath(line)}</p>`;
        })
        .join("");
}

function getMarkdownLikeBlocks(source: string): string[] {
    const blockMathPattern = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\])/g;
    const blocks: string[] = [];
    let cursor = 0;
    let match: RegExpExecArray | null = null;

    while ((match = blockMathPattern.exec(source)) !== null) {
        const before = source.slice(cursor, match.index);
        const renderedBefore = renderTextBlock(before);
        if (renderedBefore) blocks.push(renderedBefore);
        const token = match[0];
        const body = token.startsWith("$$")
            ? token.slice(2, -2)
            : token.startsWith("\\[") && token.endsWith("\\]")
                ? token.slice(2, -2)
                : token;
        blocks.push(`<div class="cpx-md-eq">${renderLatex(body, true)}</div>`);
        cursor = match.index + match[0].length;
    }

    const trailing = source.slice(cursor);
    const renderedTrailing = renderTextBlock(trailing);
    if (renderedTrailing) blocks.push(renderedTrailing);

    if (!blocks.length) {
        return [`<p class="cpx-md-p">${escapeHtml(source)}</p>`];
    }

    return blocks;
}

function renderMarkdownLikeWithMath(source: string, progress = 1): string {
    const blocks = getMarkdownLikeBlocks(source);
    if (!blocks.length) return "";

    const revealedCount = Math.max(1, Math.min(blocks.length, Math.ceil(blocks.length * clamp(progress, 0, 1))));
    return blocks.slice(0, revealedCount).join("");
}

function getOutputText(value: unknown): string {
    if (Array.isArray(value)) {
        return value.map((part) => String(part)).join("");
    }
    if (typeof value === "string") {
        return value;
    }
    return "";
}

function normalizeHtmlForRender(html: string): string {
    return html.replace(/src="([^"]*)"/g, (_match, src) => {
        const fixedSrc = String(src).replace(/\\/g, "/");
        return `src="${fixedSrc}"`;
    });
}

function renderOutputNode(output: CellOutput, key: string, revealProgress = 1) {
    const clampedProgress = clamp(revealProgress, 0, 1);
    if (clampedProgress <= 0) return null;

    if (output.output_type === "error" && output.traceback?.length) {
        const tracebackLines = output.traceback.join("\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
        const { start, end } = getRevealWindow(tracebackLines.length, 10, clampedProgress);
        return (
            <pre key={key} className="text-2xl font-mono text-red-700 leading-tight whitespace-pre-wrap">
                {tracebackLines.slice(start, end).join("\n")}
            </pre>
        );
    }

    if (output.output_type === "stream" && output.text?.length) {
        const streamLines = output.text.join("").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
        const { start, end } = getRevealWindow(streamLines.length, 10, clampedProgress);
        return (
            <pre key={key} className="text-2xl font-mono text-neutral-800 leading-tight whitespace-pre-wrap">
                {streamLines.slice(start, end).join("\n")}
            </pre>
        );
    }

    const html = getOutputText(output.data?.["text/html"] ?? output.html);
    if (html) {
        return <div key={key} className="cpx-output-html" dangerouslySetInnerHTML={{ __html: normalizeHtmlForRender(html) }} />;
    }

    const imagePng = getOutputText(output.data?.["image/png"]);
    if (imagePng) {
        return (
            <img
                key={key}
                src={`data:image/png;base64,${imagePng}`}
                alt="Cell output"
                className="max-w-full h-auto rounded-xl border border-neutral-200"
            />
        );
    }

    const latexText = getOutputText(output.data?.["text/latex"]);
    if (latexText) {
        return (
            <div
                key={key}
                className="cpx-output-rich cpx-output-latex"
                dangerouslySetInnerHTML={{ __html: `<div class="cpx-md-eq">${renderLatex(latexText, true)}</div>` }}
            />
        );
    }

    const markdownText = getOutputText(output.data?.["text/markdown"]);
    if (markdownText) {
        const renderedMarkdown = renderMarkdownLikeWithMath(markdownText, clampedProgress);
        if (!renderedMarkdown) return null;
        return (
            <div
                key={key}
                className="cpx-output-rich"
                dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
            />
        );
    }

    const plainText = getOutputText(output.data?.["text/plain"]);
    const streamText = getOutputText(output.text);
    const fallbackText = plainText || streamText;
    if (fallbackText) {
        const fallbackLines = fallbackText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
        const { start, end } = getRevealWindow(fallbackLines.length, 10, clampedProgress);
        return (
            <pre key={key} className="text-2xl font-mono text-neutral-800 leading-tight whitespace-pre-wrap">
                {fallbackLines.slice(start, end).join("\n")}
            </pre>
        );
    }

    return null;
}

export default function RenderExport() {
    const [currentTimeMs, setCurrentTimeMs] = useState(0);
    const [renderRequestSeq, setRenderRequestSeq] = useState(0);
    const [jobData, setJobData] = useState<JobData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchJob = async () => {
            try {
                const params = new URLSearchParams(window.location.search);
                const jobId = params.get("jobId");
                if (!jobId) {
                    setError("No jobId provided. Please trigger export from the main app.");
                    setLoading(false);
                    return;
                }

                console.log(`[renderer] Fetching job: ${jobId}`);
                const res = await fetch(`/api/video/job/${jobId}`, { cache: "no-store" });
                if (!res.ok) throw new Error(`Failed to fetch job data: ${res.status}`);
                const data = await res.json();
                console.log("[renderer] Job data received:", data);
                setJobData(data);
                setLoading(false);
            } catch (err) {
                console.error("[renderer] Error fetching job:", err);
                setError(err instanceof Error ? err.message : "Unknown error");
                setLoading(false);
            }
        };
        void fetchJob();
    }, []);

    const timeline = useMemo(() => {
        if (!jobData) return { items: [], totalDuration: 0 };

        // EXACT PARITY with CodeCell.tsx line 204
        const typingDelay = Math.max(10, Math.min(200, 210 - jobData.presentationSpeed * 2));
        console.log(`[renderer] Calculated Typing Delay: ${typingDelay}ms (Speed: ${jobData.presentationSpeed})`);

        let currentT = 0;
        const items = jobData.notebook.cells.map((cell) => {
            const start = currentT;
            let duration = 0;
            let typeDuration = 0;

            if (cell.type === "code") {
                typeDuration = cell.content.length * typingDelay;
                duration = typeDuration + PAUSE_BEFORE_EXEC + PAUSE_AFTER_CELL;
            } else {
                duration = PAUSE_AFTER_MARKDOWN;
            }

            const end = start + duration;
            currentT = end;
            return { ...cell, start, end, duration, typingDelay, typeDuration };
        });

        return { items, totalDuration: currentT };
    }, [jobData]);

    // Expose global control for Selenium
    useEffect(() => {
        if (!loading && !error && timeline.totalDuration > 0) {
            console.log("[renderer] Timeline ready. Total duration:", timeline.totalDuration);
            window.__exportReady = true;
            window.__exportDurationMs = timeline.totalDuration;
            window.__setExportTime = (timeMs: number) => {
                window.__renderedTimeMs = -1;
                setCurrentTimeMs(timeMs);
                setRenderRequestSeq((prev) => prev + 1);
            };
        } else if (!loading && !error) {
            console.warn("[renderer] Timeline not ready: duration is 0 or no job cells.");
        }

        return () => {
            window.__exportReady = false;
            window.__exportDurationMs = 0;
            window.__setExportTime = undefined;
        };
    }, [loading, error, timeline]);

    // Signal to export script that React has committed the requested frame.
    useEffect(() => {
        let cancelled = false;

        const waitForAnimationFrame = () => new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
        });

        const settleFrame = async () => {
            await waitForAnimationFrame();
            await waitForAnimationFrame();

            const scrollRoot = document.scrollingElement ?? document.documentElement ?? document.body;
            if (scrollRoot) {
                const maxScrollTop = Math.max(0, scrollRoot.scrollHeight - window.innerHeight);
                scrollRoot.scrollTop = maxScrollTop;
            }

            await waitForAnimationFrame();

            if (!cancelled) {
                window.__renderedTimeMs = currentTimeMs;
            }
        };

        window.__renderedTimeMs = -1;
        void settleFrame();

        return () => {
            cancelled = true;
        };
    }, [currentTimeMs, renderRequestSeq]);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-neutral-900 text-white font-sans">
                <div className="text-center space-y-4">
                    <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                    <p className="text-2xl font-bold tracking-tight">Initializing Export Studio...</p>
                    <p className="text-neutral-500">Preparing high-fidelity render pipeline</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-neutral-900 text-white font-sans p-20">
                <div className="bg-red-500/10 border-2 border-red-500 rounded-3xl p-12 max-w-2xl text-center">
                    <h2 className="text-4xl font-black mb-4 uppercase tracking-tighter">Export Interrupted</h2>
                    <p className="text-xl text-red-200 font-medium">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white p-24 min-h-screen font-sans text-neutral-900 w-[1920px] overflow-hidden">
            <style>{`
                .cpx-markdown, .cpx-output-rich { color: inherit; }
                .cpx-markdown .katex, .cpx-markdown .katex-display, .cpx-output-rich .katex, .cpx-output-rich .katex-display { color: inherit; }
                .cpx-md-h1 { font-size: 3rem; line-height: 1.1; font-weight: 900; margin: 0 0 0.7rem; letter-spacing: -0.02em; }
                .cpx-md-h2 { font-size: 2.3rem; line-height: 1.12; font-weight: 850; margin: 0.2rem 0 0.65rem; letter-spacing: -0.015em; }
                .cpx-md-h3 { font-size: 1.8rem; line-height: 1.2; font-weight: 800; margin: 0.2rem 0 0.5rem; }
                .cpx-md-p { font-size: 1.9rem; line-height: 1.5; font-weight: 600; margin: 0 0 0.6rem; }
                .cpx-md-list { margin: 0.35rem 0 0.9rem 1.35rem; font-size: 1.75rem; line-height: 1.45; font-weight: 600; }
                .cpx-md-list li { margin: 0 0 0.35rem; }
                .cpx-md-eq { margin: 0.75rem 0 1rem; }
                .cpx-md-eq .katex-display { margin: 0; }
                .cpx-output-html :where(p, h1, h2, h3, h4, h5, h6, li, span, div, code, pre) { max-width: 100%; }
                .cpx-output-latex .katex-display { font-size: 1.12em; }
            `}</style>
            <div className="max-w-5xl mx-auto space-y-20">
                <header className="border-b-8 border-indigo-600 pb-10 mb-16 flex justify-between items-end">
                    <div>
                        <h1 className="text-6xl font-black tracking-tighter leading-none mb-2">CodePresenter Studio</h1>
                        <p className="text-2xl text-neutral-500 font-bold italic tracking-tight">Professional Video Export Pipeline</p>
                    </div>
                    <div className="text-right border-l-2 border-neutral-100 pl-10">
                        <p className="text-xs font-black text-indigo-500 uppercase tracking-[0.3em] mb-2">Technical Specs</p>
                        <p className="text-2xl font-black">1080P - 60 FPS - {jobData?.presentationSpeed}% SPEED</p>
                    </div>
                </header>

                {timeline.items.map((item) => {
                    const isVisible = currentTimeMs >= item.start;
                    if (!isVisible) return null;

                    if (item.type === "code") {
                        const cellElapsed = currentTimeMs - item.start;
                        const typeProgress = Math.min(1, cellElapsed / item.typeDuration);
                        const charsToShow = Math.floor(item.content.length * typeProgress);
                        const displayedContent = item.content.slice(0, charsToShow);

                        // Output appears exactly after PAUSE_BEFORE_EXEC starts AFTER typing ends
                        const showOutput = cellElapsed >= item.typeDuration + PAUSE_BEFORE_EXEC;
                        const isTyping = typeProgress < 1;
                        const outputProgress = showOutput
                            ? clamp((cellElapsed - item.typeDuration - PAUSE_BEFORE_EXEC) / Math.max(1, item.duration - item.typeDuration - PAUSE_BEFORE_EXEC), 0, 1)
                            : 0;
                        const visibleOutputNodes = (item.outputs || [])
                            .map((out, outputIndex, outputs) => {
                                const perOutputProgress = clamp(outputProgress * outputs.length - outputIndex, 0, 1);
                                return renderOutputNode(out, `${item.id}-${outputIndex}`, perOutputProgress);
                            })
                            .filter(Boolean);

                        return (
                            <div key={item.id} className="space-y-10">
                                <div className="bg-neutral-950 text-white rounded-[2.5rem] p-12 font-mono text-3xl shadow-[0_40px_100px_-20px_rgba(0,0,0,0.5)] border border-neutral-800 relative overflow-hidden ring-1 ring-white/10">
                                    <div className="absolute top-0 left-0 w-2 h-full bg-gradient-to-b from-indigo-500 to-purple-600"></div>
                                    <pre className="whitespace-pre-wrap leading-relaxed">
                                        <span className="text-indigo-300 drop-shadow-[0_0_15px_rgba(129,140,248,0.3)]">
                                            {displayedContent}
                                        </span>
                                        {isTyping && (
                                            <span className="w-4 h-10 bg-indigo-500 inline-block animate-pulse ml-2 align-middle shadow-[0_0_20px_rgba(99,102,241,0.8)]"></span>
                                        )}
                                    </pre>
                                </div>
                                {showOutput && item.outputs && item.outputs.length > 0 && (
                                    <div className="bg-neutral-50 rounded-3xl p-10 border-2 border-neutral-100 shadow-inner group">
                                        <div className="flex items-center mb-6">
                                            <div className="flex gap-2 mr-4">
                                                <div className="w-3 h-3 rounded-full bg-red-400"></div>
                                                <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                                                <div className="w-3 h-3 rounded-full bg-green-400"></div>
                                            </div>
                                            <p className="text-sm uppercase tracking-[0.2em] text-neutral-400 font-black">Runtime Output</p>
                                        </div>
                                        <div className="space-y-6 text-neutral-800">
                                            {visibleOutputNodes}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    }

                    const markdownProgress = clamp((currentTimeMs - item.start) / Math.max(1, item.duration), 0, 1);

                    return (
                        <div key={item.id} className="bg-gradient-to-br from-indigo-600 to-indigo-800 p-16 rounded-[3rem] shadow-2xl relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32 blur-3xl"></div>
                            <div className="absolute bottom-0 left-0 w-48 h-48 bg-black/10 rounded-full -ml-24 -mb-24 blur-2xl"></div>

                            <div className="relative">
                                <span className="inline-block bg-white/20 backdrop-blur-md text-white px-8 py-3 rounded-full text-base font-black uppercase tracking-[0.2em] mb-8 ring-1 ring-white/30">
                                    Perspective
                                </span>
                                <div
                                    className="cpx-markdown text-white leading-tight"
                                    dangerouslySetInnerHTML={{ __html: renderMarkdownLikeWithMath(item.content, markdownProgress) }}
                                />
                            </div>
                        </div>
                    );
                })}

                <footer className="pt-32 pb-20 text-center">
                    <div className="inline-flex flex-col items-center opacity-30">
                        <div className="h-px w-24 bg-neutral-900 mb-6"></div>
                        <p className="text-xs font-black tracking-[0.5em] uppercase text-neutral-900 mb-2">Automated Studio Export</p>
                        <p className="text-lg font-black tracking-[0.8em] uppercase text-neutral-900">CodePresenter</p>
                    </div>
                </footer>
            </div>
        </div>
    );
}
