"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Play, Square, RefreshCw, Users, Gauge, ChevronDown, ChevronRight, Eye, EyeOff } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab    = "test" | "seed";
type Status = "idle" | "running" | "done" | "error";

const SCENARIOS = [
  { value: "smoke",           label: "Smoke",            desc: "1 VU × 1 iter — quick sanity check" },
  { value: "load",            label: "Load",             desc: "Ramp to 50 VUs, 5 min hold" },
  { value: "stress",          label: "Stress",           desc: "Spike to 200 VUs" },
  { value: "soak",            label: "Soak",             desc: "20 VUs × 30 min" },
  { value: "chat_load",       label: "Chat Load",        desc: "Steady 20 VUs + spike to 100 VUs" },
  { value: "chat_concurrent", label: "Chat Concurrent",  desc: "Every VU is a unique user chatting live" },
  { value: "chat_flood",      label: "Chat Flood 🔥",    desc: "Pure message flood — thousands of messages, nothing deleted" },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function colorLine(line: string): string {
  if (line.startsWith("✅") || /passed|✓|PASS/.test(line)) return "text-green-400";
  if (line.startsWith("❌") || /FAIL|error|ERROR|failed/.test(line)) return "text-red-400";
  if (line.startsWith("▶"))                                           return "text-blue-400 font-semibold";
  if (/warn|WARN/.test(line))                                         return "text-yellow-400";
  if (/^\s+✓/.test(line))                                             return "text-green-500";
  if (/^\s+✗/.test(line))                                             return "text-red-500";
  if (/^\s+█|scenarios|iterations|http_req/.test(line))               return "text-cyan-400";
  return "text-gray-300";
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LoadTestPage() {
  const [tab, setTab] = useState<Tab>("test");

  // ── Run-test state ────────────────────────────────────────────────────────
  const [scenario,       setScenario]       = useState("smoke");
  const [baseUrl,        setBaseUrl]        = useState("https://drafthub-web.vercel.app");
  const [communityId,    setCommunityId]    = useState("");
  const [concurrentVus,  setConcurrentVus]  = useState(50);
  const [floodVus,       setFloodVus]       = useState(500);
  const [floodDuration,  setFloodDuration]  = useState("3m");
  const [testUserEmail,  setTestUserEmail]  = useState("k6user001@k6test.invalid");
  const [testUserPass,   setTestUserPass]   = useState("K6testPass123!");
  const [adminEmail,     setAdminEmail]     = useState("");
  const [adminPass,      setAdminPass]      = useState("");

  // ── Seed state ────────────────────────────────────────────────────────────
  const [supabaseUrl,  setSupabaseUrl]  = useState("");
  const [seedCommunityId, setSeedCommunityId] = useState("");
  const [userCount,    setUserCount]    = useState(500);

  // ── Shared log state ──────────────────────────────────────────────────────
  const [status, setStatus] = useState<Status>("idle");
  const [lines,  setLines]  = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const logRef   = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  function handleScroll() {
    if (!logRef.current) return;
    const el = logRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStatus("done");
  }, []);

  const run = useCallback(async (body: object) => {
    setLines([]);
    setStatus("running");
    setAutoScroll(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/admin/load-test", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
        signal:  ctrl.signal,
      });

      if (!res.ok || !res.body) {
        setLines(["ERROR: " + res.statusText]);
        setStatus("error");
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n");
        buf = parts.pop() ?? "";
        setLines((prev) => [...prev, ...parts.filter((l) => l.length > 0)]);
      }
      if (buf.trim()) setLines((prev) => [...prev, buf.trim()]);

      setStatus("done");
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") return;
      setLines((prev) => [...prev, "ERROR: " + String(err)]);
      setStatus("error");
    }
  }, []);

  const runTest = () => run({
    type:          "test",
    scenario,
    baseUrl,
    communityId,
    concurrentVus,
    floodVus,
    floodDuration,
    testUserEmail,
    testUserPass,
    adminEmail,
    adminPass,
  });

  const runSeed = () => run({
    type:        "seed",
    supabaseUrl,
    communityId: seedCommunityId,
    userCount,
  });

  const isRunning = status === "running";
  const usesSeededUsers = scenario === "chat_flood" || scenario === "chat_concurrent";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div>
        <h1 className="font-display text-xl font-semibold text-foreground">Load Test Runner</h1>
        <p className="font-body text-xs text-foreground-muted mt-0.5">
          Fire k6 stress tests against any environment and watch the output live.
        </p>
      </div>

      <div className="flex gap-5 items-start">
        {/* ── Left panel: config ──────────────────────────────────────────── */}
        <div className="w-80 shrink-0 flex flex-col gap-3">

          {/* Tabs */}
          <div className="flex gap-1 rounded-lg bg-surface-raised p-1">
            {(["test", "seed"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-body text-xs transition-colors ${
                  tab === t
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                {t === "test" ? <Gauge size={13} /> : <Users size={13} />}
                {t === "test" ? "Run Test" : "Seed Users"}
              </button>
            ))}
          </div>

          {/* ── Run Test form ──────────────────────────────────────────────── */}
          {tab === "test" && (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
              {/* Scenario picker */}
              <div className="flex flex-col gap-1">
                <label className="font-body text-[11px] font-medium text-foreground-muted uppercase tracking-wide">
                  Scenario
                </label>
                <div className="relative">
                  <select
                    value={scenario}
                    onChange={(e) => setScenario(e.target.value)}
                    className="w-full appearance-none rounded-lg border border-border bg-surface-raised px-3 py-2 font-body text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent pr-7"
                  >
                    {SCENARIOS.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-2.5 text-foreground-muted" />
                </div>
                <p className="font-body text-[11px] text-foreground-muted">
                  {SCENARIOS.find((s) => s.value === scenario)?.desc}
                </p>
              </div>

              {/* BASE_URL */}
              <Field
                label="Base URL"
                value={baseUrl}
                onChange={setBaseUrl}
                placeholder="https://your-app.vercel.app"
              />

              {/* Community ID */}
              <Field
                label="Community ID"
                value={communityId}
                onChange={setCommunityId}
                placeholder="UUID of the test community"
              />

              {/* Concurrent VUs — only shown for chat_concurrent */}
              {scenario === "chat_concurrent" && (
                <div className="flex flex-col gap-1">
                  <label className="font-body text-[11px] font-medium text-foreground-muted uppercase tracking-wide">
                    Concurrent VUs
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={concurrentVus}
                    onChange={(e) => setConcurrentVus(Number(e.target.value))}
                    className="rounded-lg border border-border bg-surface-raised px-3 py-2 font-body text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              )}

              {/* Flood params — only shown for chat_flood */}
              {scenario === "chat_flood" && (
                <>
                  <div className="flex flex-col gap-1">
                    <label className="font-body text-[11px] font-medium text-foreground-muted uppercase tracking-wide">
                      Flood VUs
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={floodVus}
                      onChange={(e) => setFloodVus(Number(e.target.value))}
                      className="rounded-lg border border-border bg-surface-raised px-3 py-2 font-body text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <p className="font-body text-[11px] text-foreground-muted">
                      500 VUs × 2s sleep ≈ 250 msg/s · ~45k msgs in 3 min
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-body text-[11px] font-medium text-foreground-muted uppercase tracking-wide">
                      Duration
                    </label>
                    <input
                      type="text"
                      value={floodDuration}
                      onChange={(e) => setFloodDuration(e.target.value)}
                      placeholder="e.g. 3m, 10m, 1h"
                      className="rounded-lg border border-border bg-surface-raised px-3 py-2 font-body text-xs text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </>
              )}

              {/* Credentials — divider */}
              <div className="border-t border-border pt-3 flex flex-col gap-3">
                <p className="font-body text-[11px] text-foreground-muted uppercase tracking-wide font-medium">
                  Credentials
                </p>

                {usesSeededUsers ? (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 font-body text-[11px] text-amber-400 leading-relaxed">
                    This scenario uses pre-signed sessions from the Seed Users tab.
                    The email and password fields are not used. Seed at least{" "}
                    {scenario === "chat_flood" ? floodVus : concurrentVus} users before running it.
                  </div>
                ) : (
                  <>
                    <Field
                      label="Test User Email"
                      value={testUserEmail}
                      onChange={setTestUserEmail}
                      placeholder="k6user001@k6test.invalid"
                    />
                    <PasswordField
                      label="Test User Password"
                      value={testUserPass}
                      onChange={setTestUserPass}
                      placeholder="K6testPass123!"
                    />
                    <Field
                      label="Admin Email"
                      value={adminEmail}
                      onChange={setAdminEmail}
                      placeholder="admin@yourdomain.com"
                    />
                    <PasswordField
                      label="Admin Password"
                      value={adminPass}
                      onChange={setAdminPass}
                      placeholder="••••••••"
                    />
                  </>
                )}
              </div>

              <RunButton running={isRunning} onClick={runTest} onStop={stop} label="Run Test" />
            </div>
          )}

          {/* ── Seed Users form ────────────────────────────────────────────── */}
          {tab === "seed" && (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 font-body text-[11px] text-amber-400 leading-relaxed">
                <strong>Server-side secrets</strong> (SUPABASE_SERVICE_ROLE_KEY and
                SESSION_SECRET) are read from environment variables — no need to enter them here.
              </div>

              <Field
                label="Supabase URL"
                value={supabaseUrl}
                onChange={setSupabaseUrl}
                placeholder="https://xxx.supabase.co"
              />

              <Field
                label="Community ID"
                value={seedCommunityId}
                onChange={setSeedCommunityId}
                placeholder="UUID to join all users to"
              />

              <div className="flex flex-col gap-1">
                <label className="font-body text-[11px] font-medium text-foreground-muted uppercase tracking-wide">
                  User Count
                </label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={userCount}
                  onChange={(e) => setUserCount(Number(e.target.value))}
                  className="rounded-lg border border-border bg-surface-raised px-3 py-2 font-body text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <RunButton running={isRunning} onClick={runSeed} onStop={stop} label="Seed Users" />
            </div>
          )}

          {/* Status badge */}
          {status !== "idle" && (
            <StatusBadge status={status} lineCount={lines.length} />
          )}
        </div>

        {/* ── Right panel: live log ───────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-body text-xs text-foreground-muted">
              Output {lines.length > 0 && `· ${lines.length} lines`}
            </span>
            <div className="flex items-center gap-2">
              {!autoScroll && lines.length > 0 && (
                <button
                  onClick={() => {
                    setAutoScroll(true);
                    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
                  }}
                  className="font-body text-[11px] text-accent hover:underline flex items-center gap-1"
                >
                  <ChevronRight size={11} className="rotate-90" />
                  Jump to bottom
                </button>
              )}
              {lines.length > 0 && (
                <button
                  onClick={() => setLines([])}
                  className="font-body text-[11px] text-foreground-muted hover:text-foreground flex items-center gap-1"
                >
                  <RefreshCw size={11} />
                  Clear
                </button>
              )}
            </div>
          </div>

          <div
            ref={logRef}
            onScroll={handleScroll}
            className="h-[calc(100vh-220px)] min-h-[400px] overflow-y-auto rounded-xl border border-border bg-gray-950 p-4 font-mono text-[11.5px] leading-relaxed"
          >
            {lines.length === 0 ? (
              <span className="text-gray-600">
                {isRunning ? "Waiting for output…" : "Run a test to see output here."}
              </span>
            ) : (
              lines.map((line, i) => (
                <div key={i} className={colorLine(line)}>
                  {line || "\u00A0"}
                </div>
              ))
            )}
            {isRunning && (
              <span className="inline-flex items-center gap-1.5 text-gray-500 mt-1">
                <span className="animate-pulse">▌</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Field({
  label, value, onChange, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="font-body text-[11px] font-medium text-foreground-muted uppercase tracking-wide">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-lg border border-border bg-surface-raised px-3 py-2 font-body text-xs text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  );
}

function PasswordField({
  label, value, onChange, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <label className="font-body text-[11px] font-medium text-foreground-muted uppercase tracking-wide">
        {label}
      </label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 pr-8 font-body text-xs text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2.5 top-2 text-foreground-muted hover:text-foreground"
          tabIndex={-1}
        >
          {show ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
      </div>
    </div>
  );
}

function RunButton({
  running, onClick, onStop, label,
}: {
  running: boolean; onClick: () => void; onStop: () => void; label: string;
}) {
  return running ? (
    <button
      onClick={onStop}
      className="flex items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 font-body text-xs font-medium text-red-400 transition hover:bg-red-500/20"
    >
      <Square size={12} />
      Stop
    </button>
  ) : (
    <button
      onClick={onClick}
      className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-body text-xs font-medium text-white transition hover:bg-accent/90 disabled:opacity-50"
    >
      <Play size={12} />
      {label}
    </button>
  );
}

function StatusBadge({ status, lineCount }: { status: Status; lineCount: number }) {
  const map: Record<Status, { label: string; cls: string }> = {
    idle:    { label: "Idle",     cls: "text-gray-400 bg-gray-400/10 border-gray-400/20" },
    running: { label: "Running…", cls: "text-blue-400 bg-blue-400/10 border-blue-400/20" },
    done:    { label: "Done",     cls: "text-green-400 bg-green-400/10 border-green-400/20" },
    error:   { label: "Error",    cls: "text-red-400 bg-red-400/10 border-red-400/20" },
  };
  const { label, cls } = map[status];
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${cls}`}>
      {status === "running" && <Spinner size={12} />}
      <span className="font-body text-xs font-medium">{label}</span>
      {lineCount > 0 && (
        <span className="ml-auto font-body text-[11px] opacity-70">{lineCount} lines</span>
      )}
    </div>
  );
}
