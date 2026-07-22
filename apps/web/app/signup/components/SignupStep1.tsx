"use client";

import { useState } from "react";
import { Spinner } from "@/components/ui/Spinner";

interface Step1State {
  name: string;
  email: string;
  password: string;
  confirm_password: string;
}

interface SignupStep1Props {
  state: Step1State;
  onChange: (patch: Partial<Step1State>) => void;
  loading: boolean;
  error: string | null;
  fieldErrors: Record<string, string[]>;
  onSubmit: (e: React.FormEvent) => void;
}

function FieldError({ errors, field }: { errors: Record<string, string[]>; field: string }) {
  if (!errors[field]?.length) return null;
  return <p className="mt-1 font-body text-xs text-red-400">{errors[field][0]}</p>;
}

const inputClass =
  "rounded-md border border-overlay-elevated bg-overlay px-3.5 py-2.5 font-body text-sm text-overlay-foreground outline-none transition-colors placeholder:text-overlay-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 w-full";

export function SignupStep1({
  state,
  onChange,
  loading,
  error,
  fieldErrors,
  onSubmit,
}: SignupStep1Props) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm,  setShowConfirm]  = useState(false);

  const EyeOpen = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  );
  const EyeOff = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );

  return (
    <div className="rounded-xl border border-overlay-elevated bg-overlay-raised p-8 shadow-xl">
      <h2 className="font-display text-2xl font-semibold text-overlay-foreground mb-1">
        Create your account
      </h2>
      <p className="font-body text-sm text-overlay-muted mb-7">Step 1 of 4</p>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="font-body text-sm text-red-400">{error}</p>
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="font-body text-xs font-medium text-overlay-foreground">Full Name</span>
          <input type="text" value={state.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Jordan Lee" className={inputClass} autoComplete="name" required />
          <FieldError errors={fieldErrors} field="name" />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="font-body text-xs font-medium text-overlay-foreground">Email</span>
          <input type="email" value={state.email}
            onChange={(e) => onChange({ email: e.target.value })}
            placeholder="you@studio.com" className={inputClass} autoComplete="username" required />
          <FieldError errors={fieldErrors} field="email" />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="font-body text-xs font-medium text-overlay-foreground">Password</span>
          <div className="relative">
            <input type={showPassword ? "text" : "password"} value={state.password}
              onChange={(e) => onChange({ password: e.target.value })}
              placeholder="Min 8 chars, 1 number"
              className={inputClass} autoComplete="new-password" required />
            <button type="button" tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-3 flex items-center text-overlay-muted hover:text-overlay-foreground transition-colors">
              {showPassword ? <EyeOff /> : <EyeOpen />}
            </button>
          </div>
          <FieldError errors={fieldErrors} field="password" />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-body text-xs font-medium text-overlay-foreground">Confirm Password</span>
          <div className="relative">
            <input type={showConfirm ? "text" : "password"} value={state.confirm_password}
              onChange={(e) => onChange({ confirm_password: e.target.value })}
              placeholder="••••••••" className={inputClass} autoComplete="new-password" required />
            <button type="button" tabIndex={-1}
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute inset-y-0 right-3 flex items-center text-overlay-muted hover:text-overlay-foreground transition-colors">
              {showConfirm ? <EyeOff /> : <EyeOpen />}
            </button>
          </div>
          <FieldError errors={fieldErrors} field="confirm_password" />
        </div>

        <button type="submit" disabled={loading}
          className="mt-2 flex items-center justify-center gap-2 rounded-md bg-accent py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed">
          {loading && <Spinner className="h-4 w-4 text-white" />}
          {loading ? "Creating account…" : "Continue →"}
        </button>
      </form>
    </div>
  );
}
