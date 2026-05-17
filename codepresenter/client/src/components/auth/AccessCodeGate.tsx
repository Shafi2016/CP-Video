import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { clearAccessCode, saveAccessCode } from "@/lib/access-code";

interface AccessCodeGateProps {
  children: React.ReactNode;
}

export function AccessCodeGate({ children }: AccessCodeGateProps) {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  const isRenderRoute = pathname === "/render/export" || pathname.startsWith("/render-mode");
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isRenderRoute) {
      setChecking(false);
      return;
    }

    let cancelled = false;

    fetch("/api/access/check", { cache: "no-store", credentials: "include" })
      .then((response) => {
        if (!cancelled) setAuthorized(response.ok);
      })
      .catch(() => {
        if (!cancelled) setAuthorized(false);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isRenderRoute]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/access/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code }),
      });

      if (!response.ok) {
        clearAccessCode();
        throw new Error("Invalid access code");
      }

      saveAccessCode(code);
      setAuthorized(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to verify access code");
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-300 flex items-center justify-center">
        Loading...
      </div>
    );
  }

  if (isRenderRoute) {
    return <>{children}</>;
  }

  if (authorized) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-gray-900 to-emerald-950 text-white flex items-center justify-center">
      <form onSubmit={submit} className="w-full max-w-sm mx-4 rounded-xl border border-white/10 bg-white/5 p-7 shadow-2xl">
        <div className="mb-6">
          <div className="inline-flex items-center justify-center rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-sm font-semibold text-emerald-300 mb-4">
            [CP] Presenter
          </div>
          <h1 className="text-2xl font-bold">Enter access code</h1>
          <p className="mt-2 text-sm text-slate-400">This demo is restricted for invited reviewers.</p>
        </div>

        <label className="text-sm text-slate-300" htmlFor="access-code">
          Access code
        </label>
        <input
          id="access-code"
          type="password"
          autoComplete="one-time-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm outline-none focus:border-emerald-400/60"
          required
        />

        {error && (
          <div className="mt-3 text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <Button type="submit" className="mt-5 w-full bg-emerald-600 hover:bg-emerald-500" disabled={submitting}>
          {submitting ? "Checking..." : "Continue"}
        </Button>
      </form>
    </div>
  );
}
