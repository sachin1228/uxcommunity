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
      className="flex items-center gap-2.5 px-5 py-3 animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      {/* Dots pill */}
      <div className="flex items-center gap-1 bg-surface-raised rounded-full px-3 py-2 shrink-0">
        <span className="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-accent" />
      </div>

      {/* Label */}
      <span className="font-body text-[12px] text-foreground-muted shrink-0">
        {typingLabel(users)}
      </span>

      {/* Stacked avatars — only shown when multiple people are typing */}
      {multiple && (
        <div className="flex items-center">
          {users.slice(0, 6).map((u, i) => (
            <div
              key={u.id}
              className="rounded-full ring-2 ring-background"
              style={{ marginLeft: i === 0 ? 0 : -8, zIndex: i }}
            >
              <ChatAvatar name={u.name} url={null} size={6} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
