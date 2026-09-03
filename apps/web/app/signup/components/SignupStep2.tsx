"use client";

import { Spinner } from "@/components/ui/Spinner";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

interface MasterItem { id: string; name: string; image_url?: string | null }

interface Step2State {
  city_id: string;
  sector_id: string;
  experience_level: string;
}

interface SignupStep2Props {
  state: Step2State;
  onChange: (patch: Partial<Step2State>) => void;
  cities: MasterItem[];
  sectors: MasterItem[];
  experienceLevels: { id: string; slug: string; label: string; image_url: string | null }[];
  loading: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
}

export function SignupStep2({
  state,
  onChange,
  cities,
  sectors,
  experienceLevels,
  loading,
  error,
  onSubmit,
}: SignupStep2Props) {
  return (
    <div className="p-8">
      <h2 className="font-display text-2xl font-semibold text-foreground mb-1">
        Complete your profile
      </h2>
      <p className="font-body text-sm text-foreground-muted mb-7">Step 2 of 4</p>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="font-body text-sm text-red-500 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="font-body text-xs font-medium text-foreground">
            City <span className="text-red-400">*</span>
          </span>
          {/* "Other" is a real row in the cities master data — selecting it must not
              create a dedicated community; those members belong to General. */}
          <SearchableSelect
            options={cities.map((c) => ({ value: c.id, label: c.name, imageUrl: c.image_url }))}
            value={state.city_id}
            onChange={(v) => onChange({ city_id: v })}
            placeholder="Select a city"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-body text-xs font-medium text-foreground">
            Industry Sector <span className="text-red-400">*</span>
          </span>
          <SearchableSelect
            options={sectors.map((s) => ({ value: s.id, label: s.name, imageUrl: s.image_url }))}
            value={state.sector_id}
            onChange={(v) => onChange({ sector_id: v })}
            placeholder="Select a sector"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-body text-xs font-medium text-foreground">
            Experience Level <span className="text-red-400">*</span>
          </span>
          <SearchableSelect
            options={experienceLevels.map((l) => ({ value: l.slug, label: l.label, imageUrl: l.image_url }))}
            value={state.experience_level}
            onChange={(v) => onChange({ experience_level: v })}
            placeholder="Select your level"
          />
        </div>

        <button type="submit" disabled={loading}
          className="mt-2 flex items-center justify-center gap-2 rounded-md bg-accent py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed">
          {loading && <Spinner className="h-4 w-4 text-white" />}
          {loading ? "Saving…" : "Continue →"}
        </button>
      </form>
    </div>
  );
}
