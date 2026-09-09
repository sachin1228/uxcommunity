"use client";

import { useEffect, useRef } from "react";

/** Fired (on window) whenever a feed video starts playing so the others pause. */
const ACTIVATE_EVENT = "feedvideo:activate";

/**
 * Muted autoplay-in-view video for feed cards (Twitter-style):
 *
 *  - enters the viewport  → plays (muted, so autoplay policies allow it)
 *  - leaves the viewport  → pauses
 *  - comes back           → resumes automatically
 *  - tab hidden           → pauses; resumes again when visible + in view
 *  - another feed video starts → this one pauses (only one plays at a time)
 *
 * `active` lets a carousel exclude off-slide videos: the IntersectionObserver
 * does not re-evaluate reliably when an ancestor switches slides via CSS
 * transform, so the carousel passes `active={index === currentIndex}` and the
 * video plays only while both in view AND on the visible slide.
 *
 * The one exception: if the viewer explicitly paused the video (or it ended),
 * scrolling away and back keeps it paused — auto-resume only applies while the
 * viewer let it play. Hitting play clears that, restoring auto-resume.
 */
export function FeedVideo({
  src,
  ariaLabel,
  className,
  active = true,
  poster,
}: {
  src: string;
  ariaLabel?: string;
  className?: string;
  active?: boolean;
  /** First-frame image shown until the first video frame decodes. */
  poster?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const userPausedRef = useRef(false);
  const programmaticRef = useRef(false);
  const inViewRef = useRef(false);
  const activeRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof IntersectionObserver === "undefined") return;

    // Autoplay policies only allow muted playback without a gesture.
    video.muted = true;

    const activate = () => {
      window.dispatchEvent(new CustomEvent<HTMLVideoElement>(ACTIVATE_EVENT, { detail: video }));
    };

    // Another feed video started — pause this one (not counted as user pause).
    const onActivate = (event: Event) => {
      const starter = (event as CustomEvent<HTMLVideoElement>).detail;
      if (starter && starter !== video && !video.paused) {
        programmaticRef.current = true;
        video.pause();
      }
    };
    window.addEventListener(ACTIVATE_EVENT, onActivate);

    const shouldPlay = () => inViewRef.current && activeRef.current && !userPausedRef.current && !document.hidden;

    const sync = () => {
      if (shouldPlay()) {
        if (video.paused) video.play().then(activate).catch(() => {});
      } else if (!video.paused) {
        programmaticRef.current = true;
        video.pause();
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          inViewRef.current = entry.isIntersecting;
        }
        sync();
      },
      { threshold: 0.5 },
    );
    observer.observe(video);

    // Background tabs pause; coming back resumes (if still allowed to play).
    const onVisibility = () => sync();
    document.addEventListener("visibilitychange", onVisibility);

    // Distinguish our programmatic pauses from the viewer pressing pause.
    const onPause = () => {
      if (programmaticRef.current) {
        programmaticRef.current = false;
        return;
      }
      userPausedRef.current = true;
    };
    const onPlay = () => {
      userPausedRef.current = false;
    };
    // A finished video replays from the top the next time it scrolls in.
    const onEnded = () => {
      userPausedRef.current = false;
      video.currentTime = 0;
    };
    video.addEventListener("pause", onPause);
    video.addEventListener("play", onPlay);
    video.addEventListener("ended", onEnded);

    return () => {
      observer.disconnect();
      window.removeEventListener(ACTIVATE_EVENT, onActivate);
      document.removeEventListener("visibilitychange", onVisibility);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("ended", onEnded);
    };
  }, [src]);

  // Slide changes are pure CSS transforms — IntersectionObserver misses them,
  // so the carousel's `active` prop drives an explicit re-sync.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active) {
      if (inViewRef.current && !userPausedRef.current && !document.hidden && video.paused) {
        video.play().then(() => {
          window.dispatchEvent(new CustomEvent<HTMLVideoElement>(ACTIVATE_EVENT, { detail: video }));
        }).catch(() => {});
      }
    } else if (!video.paused) {
      programmaticRef.current = true;
      video.pause();
    }
  }, [active]);

  return (
    <video
      ref={videoRef}
      src={src}
      aria-label={ariaLabel}
      controls
      muted
      playsInline
      preload="metadata"
      poster={poster}
      className={className}
    />
  );
}