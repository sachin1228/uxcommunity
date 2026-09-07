"use client";
import { Button } from "@/components/ui/shadcn/button";
import { Label } from "@/components/ui/shadcn/label";
import { Input } from "@/components/ui/shadcn/input";


import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";

interface ApplicationModalProps {
  open: boolean;
  onClose: () => void;
}

type Step = "form" | "success";

const initialForm = {
  name: "",
  email: "",
  linkedin_url: "",
  portfolio_url: "",
};

export function ApplicationModal({ open, onClose }: ApplicationModalProps) {
  const [step, setStep] = useState<Step>("form");
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function handleClose() {
    onClose();
    // Reset after animation
    setTimeout(() => {
      setStep("form");
      setForm(initialForm);
      setError(null);
      setFieldErrors({});
    }, 300);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: [] }));
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});

    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.issues) {
          setFieldErrors(data.issues);
        } else {
          setError(data.error ?? "Something went wrong. Please try again.");
        }
        return;
      }

      setStep("success");
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "field w-full";

  const fieldError = (key: string) =>
    fieldErrors[key]?.length ? (
      <p className="mt-1 font-body text-xs text-red-400">
        {fieldErrors[key][0]}
      </p>
    ) : null;

  return (
    <Modal open={open} onClose={handleClose} title="Apply to uxcommunity" maxWidth="max-w-md">
      {step === "success" ? (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
            <span className="text-2xl">🎉</span>
          </div>
          <h3 className="font-display text-lg font-semibold text-foreground">
            Application submitted!
          </h3>
          <p className="font-body text-sm text-muted-foreground leading-relaxed">
            Thanks for applying! We review every application manually and will reach out with an invitation if you're approved.
          </p>
          <Button variant="outline"
            onClick={handleClose}
            className=""
          >
            Close
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3">
              <p className="font-body text-sm text-red-400">{error}</p>
            </div>
          )}

          <Label className="flex flex-col gap-1.5">
            <span className="font-body text-xs font-medium text-foreground">
              Full Name
            </span>
            <Input
              type="text"
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="Jordan Lee"
              className={inputClass}
              autoComplete="name"
              required
            />
            {fieldError("name")}
          </Label>

          <Label className="flex flex-col gap-1.5">
            <span className="font-body text-xs font-medium text-foreground">
              Email Address
            </span>
            <Input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="you@studio.com"
              className={inputClass}
              autoComplete="email"
              required
            />
            {fieldError("email")}
          </Label>

          <Label className="flex flex-col gap-1.5">
            <span className="font-body text-xs font-medium text-foreground">
              LinkedIn Profile URL
            </span>
            <Input
              type="url"
              name="linkedin_url"
              value={form.linkedin_url}
              onChange={handleChange}
              placeholder="https://linkedin.com/in/yourprofile"
              className={inputClass}
              required
            />
            {fieldError("linkedin_url")}
          </Label>

          <Label className="flex flex-col gap-1.5">
            <span className="font-body text-xs font-medium text-foreground">
              Portfolio URL
            </span>
            <Input
              type="url"
              name="portfolio_url"
              value={form.portfolio_url}
              onChange={handleChange}
              placeholder="https://yourportfolio.com"
              className={inputClass}
              required
            />
            {fieldError("portfolio_url")}
          </Label>

          <Button variant="default"
            type="submit"
            disabled={loading}
            className="mt-2 w-full"
          >
            {loading && <Spinner className="h-4 w-4 text-white" />}
            {loading ? "Submitting…" : "Submit Application"}
          </Button>

          <p className="text-center font-body text-xs text-muted-foreground">
            Join a curated community of designers — we review every application and send invitations to those who are approved.
          </p>
        </form>
      )}
    </Modal>
  );
}
