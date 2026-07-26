"use client";

import type { TypingUser } from "./useTypingPresence";
import { ChatAvatar } from "./ChatAvatar";

function typingLabel(users: TypingUser[]) {
  if (users.length === 1) return `${users[0].name} is typing...`;
  if (users.length === 2) return `${users[0].name} and ${users[1].name} are typing...`;
  return `${users[0].name} and ${users.length - 1} others are typing...`;
}

export function TypingIndicator({ users }: { users: TypingUser[] }) {
  if (users.length === 0) return null;

  const multiple = users.length > 1;

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="flex items-center gap-2 px-4 py-1 animate-in fade-in slide-in-from-bottom-1 duration-200"
    >
      {/* Dots pill */}
      <div className="flex items-center gap-0.5 bg-surface-raised rounded-full px-2 py-1 shrink-0">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
      </div>

      {/* Label */}
      <span className="font-body text-[11px] text-foreground-muted shrink-0">
        {typingLabel(users)}
      </span>

      {/* Stacked avatars — only shown when multiple people are typing */}
      {multiple && (
        <div className="flex items-center">
          {users.slice(0, 6).map((u, i) => (
            <div
              key={u.id}
              className="rounded-full ring-1 ring-background"
              style={{ marginLeft: i === 0 ? 0 : -6, zIndex: i }}
            >
              <ChatAvatar name={u.name} url={null} size={4} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
