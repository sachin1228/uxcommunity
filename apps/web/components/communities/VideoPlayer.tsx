"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";

/** Fired (on window) whenever a feed player starts so the other feed players pause. */
const ACTIVATE_EVENT = "video-player:activate";
/** Idle time after which the controls fade out while playing. */
const HIDE_DELAY_MS = 2400;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  return `${hours > 0 ? `${hours}:` : ""}${mm}:${String(secs).padStart(2, "0")}`;
}

/**
 * Video with custom chrome — YouTube-style, trimmed to the essentials:
 * play/pause, seek bar (buffered range, hover time, drag-to-scrub), time
 * readout, mute + volume slider, fullscreen. Controls fade out while playing
 * and return on hover / pause / focus; a centered play button doubles as the
 * replay affordance; double-click or `f` toggles fullscreen; space / k toggles
 * playback, ← → seek 5s, ↑ ↓ adjust volume, m mutes.
 *
 * Same import surface as the rest of the feed: on the feed surfaces
 * (`autoplayInView`) the video autoplays muted when scrolled into view,
 * pauses out of view, resumes only if the viewer let it play, and yields to
 * any other feed player that starts (one plays at a time). The full-screen
 * viewer passes `autoplayInView={false} autoPlay` to start with sound instead
 * and takes no part in that coordination.
 */
export function VideoPlayer({
  src,
  ariaLabel,
  className,
  containerClassName = "relative w-full",
  poster,
  autoplayInView = true,
  active = true,
  autoPlay = false,
}: {
  src: string;
  ariaLabel?: string;
  /** Classes for the <video> element — each surface controls its own sizing. */
  className?: string;
  /** Classes for the positioning wrapper the controls overlay spans. */
  containerClassName?: string;
  /** First-frame image shown until the first video frame decodes. */
  poster?: string;
  /**
   * Feed behavior (default true): muted autoplay in view, pause out of view,
   * one player at a time, and an explicit pause survives scroll-outs. The
   * full-screen viewer turns this off and starts playback with sound.
   */
  autoplayInView?: boolean;
  /** Carousel gating: plays only while in view AND on the visible slide. */
  active?: boolean;
  /** Start playing on mount with sound (full-screen viewer). */
  autoPlay?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekAreaRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const bufferedRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);

  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [muted, setMuted] = useState(autoplayInView);
  const [volume, setVolume] = useState(1);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canHover, setCanHover] = useState(true);

  // Behavior refs (feed modes) — kept out of state because the observer and
  // media-event callbacks must read them without re-subscribing.
  const userPausedRef = useRef(false);
  const programmaticRef = useRef(false);
  const inViewRef = useRef(false);
  const activeRef = useRef(active);

  // Controls refs — read inside the hide timer, which outlives re-renders.
  const hideTimerRef = useRef<number | null>(null);
  const scrubbingRef = useRef(false);
  const controlsHoverRef = useRef(false);
  const focusWithinRef = useRef(false);
  const wasPlayingRef = useRef(false);
  const downPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // The volume slider only makes sense with a mouse; on touch it's skipped.
  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setCanHover(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  /** Push progress / buffered position straight to the DOM — 60fps friendly. */
  const syncProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const total = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const played = total > 0 ? Math.min(1, video.currentTime / total) : 0;
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${played})`;
    if (bufferedRef.current) {
      let buffered = 0;
      if (total > 0 && video.buffered.length > 0) {
        buffered = Math.min(1, video.buffered.end(video.buffered.length - 1) / total);
      }
      bufferedRef.current.style.transform = `scaleX(${buffered})`;
    }
    if (thumbRef.current) {
      const width = seekAreaRef.current?.getBoundingClientRect().width ?? 0;
      thumbRef.current.style.transform = `translateX(${played * width}px)`;
    }
  }, []);

  /**
   * Play, then announce it so the other feed players pause. `allowMutedFallback`
   * is for programmatic starts (scroll-in, mount): if the autoplay policy
   * refuses sound playback, retry muted rather than staying frozen. User
   * actions never fall back — they happen under a gesture. Only feed players
   * announce: the full-screen viewer is modal and deliberately leaves the
   * feed's behavior untouched (it neither pauses nor is paused by others).
   */
  const attemptPlay = useCallback(
    (allowMutedFallback = false) => {
      const video = videoRef.current;
      if (!video) return;
      const announce = () => {
        if (!autoplayInView) return;
        window.dispatchEvent(new CustomEvent<HTMLVideoElement>(ACTIVATE_EVENT, { detail: video }));
      };
      const attempt = video.play();
      if (!attempt || typeof attempt.then !== "function") return;
      attempt
        .then(announce)
        .catch(() => {
          if (allowMutedFallback && !video.muted) {
            video.muted = true;
            video.play().then(announce).catch(() => {});
          }
        });
    },
    [autoplayInView],
  );

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const armHideTimer = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      const video = videoRef.current;
      if (!video || video.paused || video.ended) return;
      if (scrubbingRef.current || controlsHoverRef.current || focusWithinRef.current) return;
      setControlsVisible(false);
    }, HIDE_DELAY_MS);
  }, [clearHideTimer]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    armHideTimer();
  }, [armHideTimer]);

  /** Media wiring — listeners for both modes; observers only for the feed. */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setCurrentTime(0);
    setDuration(0);
    setEnded(false);
    setBuffering(false);

    // Autoplay policies only allow muted playback without a gesture.
    if (autoplayInView) video.muted = true;

    const onPlay = () => {
      setPlaying(true);
      setEnded(false);
      userPausedRef.current = false;
      // Controls fade on an idle timer while playing; paused they stay put.
      armHideTimer();
    };
    const onPause = () => {
      setPlaying(false);
      clearHideTimer();
      setControlsVisible(true);
      // Distinguish our programmatic pauses from the viewer pressing pause.
      if (programmaticRef.current) programmaticRef.current = false;
      else userPausedRef.current = true;
    };
    const onEnded = () => {
      setPlaying(false);
      setEnded(true);
      userPausedRef.current = false;
      // A finished video replays from the top the next time it scrolls in.
      video.currentTime = 0;
    };
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      syncProgress();
    };
    const onDuration = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      syncProgress();
    };
    const onWaiting = () => setBuffering(true);
    const onPlayable = () => setBuffering(false);
    const onSeeked = () => {
      setCurrentTime(video.currentTime);
      syncProgress();
    };
    const onVolumeChange = () => {
      setMuted(video.muted);
      setVolume(video.volume);
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onDuration);
    video.addEventListener("durationchange", onDuration);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlayable);
    video.addEventListener("canplay", onPlayable);
    video.addEventListener("progress", syncProgress);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("volumechange", onVolumeChange);

    let observer: IntersectionObserver | null = null;
    let onActivate: ((event: Event) => void) | null = null;
    let onVisibility: (() => void) | null = null;

    if (autoplayInView) {
      // Another player started — pause this one (not counted as a user pause).
      onActivate = (event: Event) => {
        const starter = (event as CustomEvent<HTMLVideoElement>).detail;
        if (starter && starter !== video && !video.paused) {
          programmaticRef.current = true;
          video.pause();
        }
      };
      window.addEventListener(ACTIVATE_EVENT, onActivate);

      const shouldPlay = () =>
        inViewRef.current && activeRef.current && !userPausedRef.current && !document.hidden;
      const sync = () => {
        if (shouldPlay()) {
          if (video.paused) attemptPlay(true);
        } else if (!video.paused) {
          programmaticRef.current = true;
          video.pause();
        }
      };

      if (typeof IntersectionObserver !== "undefined") {
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) inViewRef.current = entry.isIntersecting;
            sync();
          },
          { threshold: 0.5 },
        );
        observer.observe(video);
      }

      // Background tabs pause; coming back resumes (if still allowed to play).
      onVisibility = sync;
      document.addEventListener("visibilitychange", onVisibility);
    }

    // `loadedmetadata` can fire before hydration attaches the listeners (the
    // browser starts fetching during HTML parse), so take an initial read.
    if (video.readyState >= 1) {
      onDuration();
      setCurrentTime(video.currentTime);
      syncProgress();
    }

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onDuration);
      video.removeEventListener("durationchange", onDuration);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlayable);
      video.removeEventListener("canplay", onPlayable);
      video.removeEventListener("progress", syncProgress);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("volumechange", onVolumeChange);
      observer?.disconnect();
      if (onActivate) window.removeEventListener(ACTIVATE_EVENT, onActivate);
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [src, autoplayInView, attemptPlay, syncProgress, armHideTimer, clearHideTimer]);

  // The full-screen viewer starts playback as soon as it mounts.
  useEffect(() => {
    if (!autoPlay) return;
    attemptPlay(true);
  }, [autoPlay, src, attemptPlay]);

  // Slide changes are pure CSS transforms — IntersectionObserver misses them,
  // so the carousel's `active` prop drives an explicit re-sync.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active) {
      if (inViewRef.current && !userPausedRef.current && !document.hidden && video.paused) {
        attemptPlay(true);
      }
    } else if (!video.paused) {
      programmaticRef.current = true;
      video.pause();
    }
  }, [active, attemptPlay]);

  // Smooth seek-bar motion: step the fill/thumb once per frame while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      syncProgress();
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [playing, syncProgress]);

  useEffect(() => {
    const onChange = () => {
      const root = rootRef.current;
      setIsFullscreen(
        !!root &&
          (document.fullscreenElement === root ||
            (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement === root),
      );
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) attemptPlay();
    else video.pause();
    showControls();
  }, [attemptPlay, showControls]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.muted || video.volume === 0) {
      video.muted = false;
      if (video.volume === 0) video.volume = 0.5;
    } else {
      video.muted = true;
    }
    showControls();
  }, [showControls]);

  const setVolumeLevel = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;
    const next = Math.min(1, Math.max(0, value));
    video.volume = next;
    video.muted = next <= 0;
  }, []);

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    const video = videoRef.current as
      | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
      | null;
    if (!root) return;
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => void;
    };
    const active = document.fullscreenElement === root || doc.webkitFullscreenElement === root;
    if (active) {
      if (document.exitFullscreen) void document.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
    } else if (root.requestFullscreen) {
      void root.requestFullscreen().catch(() => {});
    } else {
      // iPhone Safari (pre-Fullscreen API) falls back to its native player.
      video?.webkitEnterFullscreen?.();
    }
    showControls();
  }, [showControls]);

  const seekBy = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      const total = Number.isFinite(video.duration) ? video.duration : 0;
      if (total <= 0) return;
      video.currentTime = Math.min(total, Math.max(0, video.currentTime + delta));
      setCurrentTime(video.currentTime);
      syncProgress();
      showControls();
    },
    [showControls, syncProgress],
  );

  const nudgeVolume = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      const next = Math.min(1, Math.max(0, video.volume + delta));
      video.volume = next;
      video.muted = next <= 0;
      showControls();
    },
    [showControls],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    if (key === " " || key === "k" || key === "K") {
      event.preventDefault();
      event.stopPropagation();
      togglePlay();
    } else if (key === "m" || key === "M") {
      event.preventDefault();
      event.stopPropagation();
      toggleMute();
    } else if (key === "f" || key === "F") {
      event.preventDefault();
      event.stopPropagation();
      toggleFullscreen();
    } else if (key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      seekBy(-5);
    } else if (key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      seekBy(5);
    } else if (key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      nudgeVolume(0.05);
    } else if (key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      nudgeVolume(-0.05);
    } else if (key === "Home") {
      event.preventDefault();
      event.stopPropagation();
      seekBy(-Infinity);
    } else if (key === "End") {
      event.preventDefault();
      event.stopPropagation();
      seekBy(Infinity);
    }
  };

  /** Seek-bar scrub: pause while dragging, live-seek, resume on release. */
  const scrubTo = useCallback(
    (clientX: number) => {
      const video = videoRef.current;
      const area = seekAreaRef.current;
      if (!video || !area) return;
      const rect = area.getBoundingClientRect();
      const fraction = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
      const total = Number.isFinite(video.duration) ? video.duration : 0;
      if (total <= 0) return;
      video.currentTime = fraction * total;
      setCurrentTime(video.currentTime);
      setHoverFraction(fraction);
      syncProgress();
    },
    [syncProgress],
  );

  const onSeekPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const area = seekAreaRef.current;
    if (!video || !area) return;
    const total = Number.isFinite(video.duration) ? video.duration : 0;
    if (total <= 0) return;
    event.preventDefault();
    area.setPointerCapture(event.pointerId);
    scrubbingRef.current = true;
    setScrubbing(true);
    wasPlayingRef.current = !video.paused && !video.ended;
    if (!video.paused) {
      programmaticRef.current = true;
      video.pause();
    }
    area.focus({ preventScroll: true });
    scrubTo(event.clientX);
    showControls();
  };

  const onSeekPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (scrubbingRef.current) {
      scrubTo(event.clientX);
      return;
    }
    if (!canHover) return;
    const area = seekAreaRef.current;
    const video = videoRef.current;
    if (!area || !video) return;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    const rect = area.getBoundingClientRect();
    if (rect.width <= 0) return;
    setHoverFraction(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
  };

  const endScrub = () => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    setScrubbing(false);
    const video = videoRef.current;
    if (video && wasPlayingRef.current && video.paused) attemptPlay();
    wasPlayingRef.current = false;
  };

  const onSurfacePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    downPosRef.current = { x: event.clientX, y: event.clientY };
  };

  const onSurfaceClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element | null;
    if (target?.closest?.("[data-controls]")) return;
    const down = downPosRef.current;
    downPosRef.current = null;
    // A drag that happened to end on the video is not a play/pause tap.
    if (down && (Math.abs(event.clientX - down.x) > 8 || Math.abs(event.clientY - down.y) > 8)) return;
    event.stopPropagation();
    togglePlay();
  };

  const onSurfaceDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element | null;
    if (target?.closest?.("[data-controls]")) return;
    event.stopPropagation();
    toggleFullscreen();
  };

  const displayTime = currentTime;
  const showCenterButton = !playing || ended;

  return (
    <div
      ref={rootRef}
      data-video-player
      tabIndex={0}
      aria-label={ariaLabel ? `Video: ${ariaLabel}` : "Video player"}
      className={`group/player video-player relative select-none outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${containerClassName} ${
        !controlsVisible && canHover ? "cursor-none" : ""
      }`}
      onMouseMove={canHover ? showControls : undefined}
      onPointerDown={onSurfacePointerDown}
      onClick={onSurfaceClick}
      onDoubleClick={onSurfaceDoubleClick}
      onKeyDown={onKeyDown}
      onFocusCapture={() => {
        focusWithinRef.current = true;
        showControls();
      }}
      onBlurCapture={() => {
        focusWithinRef.current = false;
        armHideTimer();
      }}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        aria-label={ariaLabel}
        preload="metadata"
        playsInline
        disableRemotePlayback
        className={className}
      />

      {/* Center overlay — play / replay, with the buffering spinner taking
          over while the video stalls. */}
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
        {buffering ? (
          <Loader2
            size={38}
            strokeWidth={2.5}
            aria-hidden
            className="animate-spin text-white/90 drop-shadow-md"
          />
        ) : (
          <button
            type="button"
            data-controls
            aria-label={ended ? "Replay video" : "Play video"}
            onClick={(event) => {
              event.stopPropagation();
              togglePlay();
            }}
            className={`flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white shadow-lg outline-none backdrop-blur-[1px] transition-all duration-200 ease-out hover:scale-105 hover:bg-black/65 focus-visible:ring-2 focus-visible:ring-white/80 ${
              showCenterButton ? "scale-100 opacity-100" : "pointer-events-none scale-75 opacity-0"
            }`}
          >
            {ended ? (
              <RotateCcw size={24} strokeWidth={2.5} />
            ) : (
              <Play size={24} fill="currentColor" strokeWidth={0} className="ml-0.5" />
            )}
          </button>
        )}
      </div>

      {/* Bottom chrome — fades out while playing, returns on hover / pause. */}
      <div
        data-controls
        className={`absolute inset-x-0 bottom-0 z-20 transition-opacity duration-300 ease-out ${
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onMouseEnter={() => {
          controlsHoverRef.current = true;
        }}
        onMouseLeave={() => {
          controlsHoverRef.current = false;
          armHideTimer();
        }}
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />
        <div className="relative px-2.5 pb-1 pt-6">
          {/* Seek bar */}
          <div
            ref={seekAreaRef}
            role="slider"
            tabIndex={0}
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.max(1, Math.round(duration))}
            aria-valuenow={Math.round(displayTime)}
            aria-valuetext={`${formatTime(displayTime)} of ${formatTime(duration)}`}
            aria-disabled={duration <= 0 || undefined}
            onPointerDown={onSeekPointerDown}
            onPointerMove={onSeekPointerMove}
            onPointerUp={endScrub}
            onPointerCancel={endScrub}
            onPointerLeave={() => {
              if (!scrubbingRef.current) setHoverFraction(null);
            }}
            className="group/seek relative flex h-5 w-full cursor-pointer touch-none items-center rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-white/60"
          >
            <div
              className={`relative w-full overflow-hidden rounded-full bg-white/25 transition-[height] duration-150 ease-out ${
                scrubbing ? "h-[5px]" : "h-[3px] group-hover/seek:h-[5px]"
              }`}
            >
              <div
                ref={bufferedRef}
                className="absolute inset-0 origin-left scale-x-0 rounded-full bg-white/30"
              />
              <div
                ref={fillRef}
                className="absolute inset-0 origin-left scale-x-0 rounded-full bg-white"
              />
            </div>
            <span
              ref={thumbRef}
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 z-10 -ml-1.5 flex w-3 items-center justify-center"
            >
              <span
                className={`block h-3 w-3 rounded-full bg-white shadow-md transition-transform duration-150 ease-out ${
                  scrubbing ? "scale-125" : "scale-0 group-hover/seek:scale-125"
                }`}
              />
            </span>
            {canHover && hoverFraction !== null && (
              <span
                className="pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2 rounded-md bg-black/85 px-1.5 py-0.5 font-body text-[11px] font-medium tabular-nums text-white shadow-lg"
                style={{ left: `clamp(26px, ${hoverFraction * 100}%, calc(100% - 26px))` }}
              >
                {formatTime(hoverFraction * duration)}
              </span>
            )}
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-0.5 pb-0.5">
            <button
              type="button"
              aria-label={playing ? "Pause" : ended ? "Replay video" : "Play"}
              onClick={(event) => {
                event.stopPropagation();
                togglePlay();
              }}
              className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/90 outline-none transition-colors duration-150 hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/80"
            >
              {playing ? (
                <Pause size={18} fill="currentColor" strokeWidth={0} />
              ) : (
                <Play size={18} fill="currentColor" strokeWidth={0} className="translate-x-px" />
              )}
            </button>

            <span className="ml-1 mr-0.5 font-body text-xs font-medium tabular-nums text-white/90">
              {formatTime(displayTime)} / {formatTime(duration)}
            </span>

            <div className="flex-1" />

            <div className="group/volume relative flex items-center">
              {/* Vertical volume popup floating above the mute button (YT-mobile
                  style). Absolute, so nothing in the bar ever shifts — and the
                  button stays exactly where the cursor is. */}
              {canHover && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-30 -translate-x-1/2 pb-2 group-hover/volume:pointer-events-auto">
                  <div className="translate-y-1.5 scale-95 rounded-lg border border-white/10 bg-black/75 p-2 opacity-0 shadow-lg backdrop-blur-sm transition-all duration-200 ease-out group-hover/volume:translate-y-0 group-hover/volume:scale-100 group-hover/volume:opacity-100 focus-within:translate-y-0 focus-within:scale-100 focus-within:opacity-100">
                    <VolumeSlider value={muted ? 0 : volume} onChange={setVolumeLevel} />
                  </div>
                </div>
              )}
              <button
                type="button"
                aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleMute();
                }}
                className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/90 outline-none transition-colors duration-150 hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/80"
              >
                {muted || volume === 0 ? (
                  <VolumeX size={20} strokeWidth={2} />
                ) : (
                  <Volume2 size={20} strokeWidth={2} />
                )}
              </button>
            </div>

            <button
              type="button"
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              onClick={(event) => {
                event.stopPropagation();
                toggleFullscreen();
              }}
              className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/90 outline-none transition-colors duration-150 hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/80"
            >
              {isFullscreen ? <Minimize size={18} strokeWidth={2} /> : <Maximize size={18} strokeWidth={2} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Vertical volume slider inside the popup above the mute button. */
function VolumeSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const applyFromClientY = (clientY: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return;
    // Top of the track is full volume.
    onChange(Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height)));
  };

  const nudge = (delta: number) => onChange(Math.min(1, Math.max(0, value + delta)));

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Volume"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      tabIndex={0}
      onPointerDown={(event) => {
        event.stopPropagation();
        trackRef.current?.setPointerCapture(event.pointerId);
        setDragging(true);
        applyFromClientY(event.clientY);
      }}
      onPointerMove={(event) => {
        if (dragging) applyFromClientY(event.clientY);
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          nudge(0.05);
        } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          nudge(-0.05);
        }
      }}
      className="group/vol relative flex h-16 w-4 cursor-pointer touch-none justify-center rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-white/60"
    >
      <div className="relative h-full w-[3px] overflow-hidden rounded-full bg-white/30">
        <div
          className="absolute inset-0 origin-bottom rounded-full bg-white"
          style={{ transform: `scaleY(${value})` }}
        />
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 translate-y-1/2"
        style={{ bottom: `${value * 100}%` }}
      >
        <span
          className={`flex h-3 w-3 items-center justify-center transition-transform duration-150 ease-out ${
            dragging ? "scale-100" : "scale-0 group-hover/vol:scale-100"
          }`}
        >
          <span className="block h-3 w-3 rounded-full bg-white shadow" />
        </span>
      </span>
    </div>
  );
}
