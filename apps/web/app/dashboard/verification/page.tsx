import { VerificationForm } from "@/components/verification/VerificationForm";

export const metadata = { title: "Verify your account" };

export default function VerificationPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 md:px-6 md:py-12">
      <p className="font-mono text-[10px] uppercase tracking-wider text-foreground-subtle">
        Account verification
      </p>
      <h1 className="mt-1 font-display text-2xl font-semibold text-foreground">
        Verify yourself
      </h1>
      <p className="mt-2 font-body text-sm leading-relaxed text-foreground-muted">
        Your account stays read-only until an admin reviews your profile. Share your
        LinkedIn, portfolio, and a few samples of your work.
      </p>

      <div className="mt-6">
        <VerificationForm />
      </div>
    </div>
  );
}
