"use client";

import type { TypingUser } from "./useTypingPresence";

function typingLabel(users: TypingUser[]) {
  if (users.length === 1) return `${users[0].name} is typing`;
  if (users.length === 2) {
    return `${users[0].name} and ${users[1].name} are typing`;
  }

  const additionalCount = users.length - 2;
  return `${users[0].name}, ${users[1].name}, and ${additionalCount} ${
    additionalCount === 1 ? "other" : "others"
  } are typing`;
}

export function TypingIndicator({ users }: { users: TypingUser[] }) {
  const visible = users.length > 0;

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className={`flex h-5 items-center gap-1.5 px-1 font-body text-[11px] text-foreground-muted transition-opacity duration-150 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <span>{visible ? typingLabel(users) : " "}</span>
      {visible && (
        <span className="inline-flex items-center gap-0.5" aria-hidden="true">
          <span className="h-1 w-1 animate-bounce rounded-full bg-foreground-muted [animation-delay:-0.3s]" />
          <span className="h-1 w-1 animate-bounce rounded-full bg-foreground-muted [animation-delay:-0.15s]" />
          <span className="h-1 w-1 animate-bounce rounded-full bg-foreground-muted" />
        </span>
      )}
    </div>
  );
}