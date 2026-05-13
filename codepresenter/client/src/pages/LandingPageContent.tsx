import { useLocation } from "wouter";
import { ArrowRight, BookOpen, Brain, FileUp, PlayCircle, Video, Zap } from "lucide-react";

const steps = [
  {
    icon: FileUp,
    title: "Upload a notebook",
    body: "Start from an existing .ipynb lesson, demo, tutorial, or research walkthrough.",
  },
  {
    icon: PlayCircle,
    title: "Execute every cell",
    body: "Run Python code through the Jupyter bridge so explanations are grounded in real outputs.",
  },
  {
    icon: Brain,
    title: "Teach with Gemma 4",
    body: "Generate per-cell narration that explains the code, result, and learning goal.",
  },
  {
    icon: Video,
    title: "Export a lesson video",
    body: "Capture the notebook presentation with narration for classrooms, Kaggle demos, and async learning.",
  },
];

const metrics = [
  ["Gemma 4", "teaching brain"],
  ["Jupyter", "real execution"],
  ["MP4", "video export"],
];

export default function LandingPageContent() {
  const [, setLocation] = useLocation();

  return (
    <main className="min-h-screen bg-[#f7f5ef] text-[#161a1d]">
      <nav className="border-b border-black/10 bg-[#fdfbf4]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <button className="flex items-center gap-3" onClick={() => setLocation("/")}>
            <img src="/logo.png" alt="CodePresenter" className="h-9 w-9 rounded-md object-cover" />
            <span className="text-lg font-semibold tracking-tight">CodePresenter</span>
          </button>
          <div className="flex items-center gap-3">
            <button className="hidden rounded-md px-3 py-2 text-sm font-medium text-black/70 hover:bg-black/5 sm:inline-flex" onClick={() => setLocation("/pricing")}>
              Pricing
            </button>
            <button className="rounded-md border border-black/15 bg-white px-4 py-2 text-sm font-semibold shadow-sm hover:bg-black/[0.03]" onClick={() => setLocation("/login")}>
              Sign in
            </button>
            <button className="rounded-md bg-[#146c5f] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#0f5b50]" onClick={() => setLocation("/code")}>
              Open app
            </button>
          </div>
        </div>
      </nav>

      <section className="mx-auto grid max-w-7xl gap-10 px-5 py-14 lg:grid-cols-[1.02fr_.98fr] lg:items-center lg:py-20">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#146c5f]/20 bg-[#e8f3ef] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#146c5f]">
            <Zap className="h-3.5 w-3.5" />
            Powered by Gemma 4
          </div>
          <h1 className="max-w-4xl text-5xl font-semibold leading-[1.02] tracking-tight text-[#111315] md:text-7xl">
            Turn Python notebooks into narrated teaching videos.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-black/68">
            CodePresenter executes notebook cells, explains the code and outputs with Gemma 4, and exports a polished lesson video. Built for educators, Kaggle authors, and anyone teaching from real Python work.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button className="inline-flex items-center justify-center gap-2 rounded-md bg-[#146c5f] px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#0f5b50]" onClick={() => setLocation("/code")}>
              Try a notebook
              <ArrowRight className="h-4 w-4" />
            </button>
            <button className="inline-flex items-center justify-center gap-2 rounded-md border border-black/15 bg-white px-5 py-3 text-sm font-semibold shadow-sm hover:bg-black/[0.03]" onClick={() => setLocation("/code/notebooks")}>
              Browse notebooks
              <BookOpen className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-10 grid max-w-xl grid-cols-3 divide-x divide-black/10 rounded-md border border-black/10 bg-white">
            {metrics.map(([value, label]) => (
              <div key={value} className="px-4 py-4">
                <div className="text-lg font-semibold">{value}</div>
                <div className="mt-1 text-xs uppercase tracking-[0.12em] text-black/50">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-black/10 bg-[#111315] p-4 shadow-2xl shadow-black/20">
          <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#f87171]" />
              <span className="h-3 w-3 rounded-full bg-[#fbbf24]" />
              <span className="h-3 w-3 rounded-full bg-[#34d399]" />
            </div>
            <span className="rounded border border-[#54d6bd]/30 bg-[#54d6bd]/10 px-2 py-1 text-xs font-semibold text-[#54d6bd]">Gemma 4 active</span>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
            <div className="rounded-md bg-[#171b1f] p-4 font-mono text-sm text-slate-200">
              <div className="mb-3 text-xs uppercase tracking-[0.14em] text-slate-500">notebook cell</div>
              <pre className="whitespace-pre-wrap leading-7">{`import pandas as pd
import matplotlib.pyplot as plt

df = pd.read_csv("climate.csv")
monthly = df.groupby("month")["temp"].mean()
monthly.plot(kind="line", title="Average temperature")`}</pre>
            </div>
            <div className="rounded-md bg-[#f8f5ec] p-4 text-[#15181a]">
              <div className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[#146c5f]">generated narration</div>
              <p className="text-sm leading-7">
                This cell loads climate data, groups temperatures by month, and creates a line chart so learners can see seasonal patterns rather than reading raw rows.
              </p>
              <div className="mt-5 h-28 rounded-md border border-black/10 bg-white p-3">
                <div className="h-full rounded bg-[linear-gradient(180deg,#dff3eb,#f8fff9)]">
                  <div className="flex h-full items-end gap-2 px-4 pb-4">
                    {[35, 48, 64, 78, 87, 80, 67, 52].map((height, index) => (
                      <span key={index} className="w-full rounded-sm bg-[#146c5f]" style={{ height: `${height}%` }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-black/10 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-14">
          <div className="mb-9 max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight">A focused workflow for notebook education</h2>
            <p className="mt-3 text-black/60">The public Kaggle build is intentionally Python-first, with every feature serving the notebook-to-video story.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <div key={step.title} className="rounded-md border border-black/10 bg-[#fbfaf6] p-5">
                  <Icon className="h-6 w-6 text-[#146c5f]" />
                  <h3 className="mt-4 font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-black/60">{step.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-14">
        <div className="rounded-lg bg-[#146c5f] px-6 py-8 text-white md:flex md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Ready for the Gemma 4 Good Hackathon demo.</h2>
            <p className="mt-2 max-w-2xl text-white/78">Show a real notebook, run it, let Gemma 4 teach it, then export the video judges can understand in minutes.</p>
          </div>
          <button className="mt-6 inline-flex items-center gap-2 rounded-md bg-white px-5 py-3 text-sm font-semibold text-[#146c5f] md:mt-0" onClick={() => setLocation("/code")}>
            Launch CodePresenter
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </section>
    </main>
  );
}
