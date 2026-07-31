/**
 * Sends and receives typing presence for a single chat room.
 * Channel: community-typing:${communityId}  (Supabase Broadcast)
 * Event: typing  Payload: { user_id, name, typing: boolean, ts }
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

interface TypingEntry {
  user_id: string;
  name: string;
  ts: number;
}

const TYPING_EXPIRY_MS = 3500;
const TYPING_DEBOUNCE_MS = 1000;

export function useTypingPresence(communityId: string) {
  const { user } = useAuth();
  const [typists, setTypists] = useState<TypingEntry[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const expireTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const channel = supabase
      .channel(`community-typing:${communityId}`, {
        config: { broadcast: { ack: false, self: false } },
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const { user_id, name, typing: isTyping, ts } = payload as {
          user_id: string;
          name: string;
          typing: boolean;
          ts: number;
        };
        if (user_id === user?.id) return;

        setTypists((prev) => {
          if (isTyping) {
            return [...prev.filter((e) => e.user_id !== user_id), { user_id, name, ts }];
          }
          return prev.filter((e) => e.user_id !== user_id);
        });

        clearTimeout(expireTimers.current[user_id]);
        if (isTyping) {
          expireTimers.current[user_id] = setTimeout(() => {
            setTypists((prev) => prev.filter((e) => e.user_id !== user_id));
          }, TYPING_EXPIRY_MS);
        }
      })
      .subscribe();

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      Object.values(expireTimers.current).forEach(clearTimeout);
    };
  }, [communityId, user?.id]);

  const sendTyping = useCallback(
    (isTyping: boolean) => {
      if (!channelRef.current || !user) return;
      channelRef.current.send({
        type: 'broadcast',
        event: 'typing',
        payload: { user_id: user.id, name: user.name, typing: isTyping, ts: Date.now() },
      });
    },
    [user]
  );

  /** Call on every keystroke. Debounces stop-typing automatically. */
  const onInputChange = useCallback(
    (text: string) => {
      const hasText = text.length > 0;

      if (hasText && !isTypingRef.current) {
        isTypingRef.current = true;
        sendTyping(true);
      }

      // Reset the stop timer on every keystroke
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      stopTimerRef.current = setTimeout(() => {
        isTypingRef.current = false;
        sendTyping(false);
      }, TYPING_DEBOUNCE_MS);

      if (!hasText) {
        isTypingRef.current = false;
        sendTyping(false);
      }
    },
    [sendTyping]
  );

  const stopTyping = useCallback(() => {
    if (isTypingRef.current) {
      isTypingRef.current = false;
      sendTyping(false);
    }
  }, [sendTyping]);

  const typingLabel = (() => {
    const active = typists.filter((e) => Date.now() - e.ts < TYPING_EXPIRY_MS);
    if (active.length === 0) return null;
    if (active.length === 1) return `${active[0].name} is typing…`;
    if (active.length === 2) return `${active[0].name} & ${active[1].name} are typing…`;
    return 'Several people are typing…';
  })();

  return { typingLabel, onInputChange, stopTyping };
}
