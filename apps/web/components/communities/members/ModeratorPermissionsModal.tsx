"use client";

import { useMemo, useState } from "react";
import { ShieldCheckmarkRegular } from "@fluentui/react-icons";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/ui/Modal";
import {
  MODERATOR_DEFAULT_PERMISSIONS,
  MODERATOR_PERMISSION_OPTIONS,
  type CommunityPermission,
  type CommunityPermissions,
  type CommunityPermissionGroup,
} from "@/lib/communities/permissions";

interface ModeratorPermissionsModalProps {
  open: boolean;
  onClose: () => void;
  /** The member being promoted or edited. */
  member: { user_id: string; name: string } | null;
  /** Current effective permissions when editing an existing moderator. */
  initialPermissions?: CommunityPermissions;
  mode: "promote" | "edit";
  saving: boolean;
  error: string | null;
  onSave: (permissions: CommunityPermissions) => void;
}

const GROUP_ORDER: CommunityPermissionGroup[] = ["Content moderation", "Administration"];

/**
 * The owner's picker for what a moderator may do. Used both when promoting a
 * member (starts from the moderator defaults) and when editing an existing
 * moderator (starts from their current grants). The parent performs the PATCH
 * so a failed save can surface here without losing the owner's toggles, and
 * mounts the modal per open so the starting point lands fresh each time.
 */
export function ModeratorPermissionsModal({
  open,
  onClose,
  member,
  initialPermissions,
  mode,
  saving,
  error,
  onSave,
}: ModeratorPermissionsModalProps) {
  const [permissions, setPermissions] = useState<CommunityPermissions>(() =>
    mode === "edit" && initialPermissions
      ? { ...initialPermissions }
      : { ...MODERATOR_DEFAULT_PERMISSIONS },
  );

  // In edit mode an unchanged set saves nothing, so the button rests disabled.
  const dirty = useMemo(() => {
    if (mode !== "edit" || !initialPermissions) return true;
    return (Object.keys(permissions) as CommunityPermission[]).some(
      (key) => permissions[key] !== initialPermissions[key],
    );
  }, [permissions, initialPermissions, mode]);

  const firstName = member?.name.split(" ")[0] ?? "This member";

  return (
    <Modal
      open={open}
      onClose={saving ? () => undefined : onClose}
      title={mode === "promote" ? `Make ${firstName} a moderator` : "Moderator permissions"}
      maxWidth="max-w-lg"
    >
      <p className="-mt-3 mb-5 font-body text-xs leading-relaxed text-foreground-muted">
        {mode === "promote"
          ? `Moderators help you run the community. Content moderation starts on and administration off — adjust anything before you promote. You can change this later from ${firstName}'s menu.`
          : `Choose what ${firstName} can do in this community. Owners always keep full control.`}
      </p>

      {error && (
        <div className="mb-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 font-body text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-5">
        {GROUP_ORDER.map((group) => (
          <div key={group}>
            <p className="mb-2 flex items-center gap-1.5 font-body text-[10px] font-semibold uppercase tracking-widest text-foreground-muted">
              {group === "Content moderation" && (
                <ShieldCheckmarkRegular fontSize={13} className="text-accent/70" />
              )}
              {group}
            </p>
            {/* `divide-border` only — Tailwind v3 drops opacity modifiers on CSS-var colours. */}
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {MODERATOR_PERMISSION_OPTIONS.filter((option) => option.group === group).map(
                ({ key, label, description }) => {
                  const checked = permissions[key];
                  return (
                    <div key={key} className="flex items-center justify-between gap-6 px-4 py-3.5">
                      <div className="min-w-0">
                        <p className="font-body text-sm font-medium text-foreground">{label}</p>
                        <p className="mt-0.5 font-body text-[11px] leading-relaxed text-foreground-muted">
                          {description}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={checked}
                        aria-label={label}
                        disabled={saving}
                        onClick={() =>
                          setPermissions((prev) => ({ ...prev, [key]: !prev[key] }))
                        }
                        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 disabled:opacity-50 ${
                          checked ? "border-transparent bg-accent" : "border-border bg-surface-raised"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full transition-all duration-200 ${
                            checked ? "translate-x-5 bg-accent-foreground" : "translate-x-0 bg-foreground"
                          }`}
                        />
                      </button>
                    </div>
                  );
                },
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="modal-btn modal-btn-secondary flex-1"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(permissions)}
          disabled={saving || !dirty}
          className="modal-btn modal-btn-primary flex-1"
        >
          {saving && <Spinner className="h-3.5 w-3.5 text-accent-foreground" />}
          {mode === "promote" ? "Make moderator" : "Save permissions"}
        </button>
      </div>
    </Modal>
  );
}
