/**
 * Plays a short generated chime when a new incoming chat message arrives.
 * Uses a lazily-created expo-audio player (singleton) so we don't allocate a
 * new player on every message. Safe to call from anywhere — failures are
 * swallowed so a missing audio device never breaks the chat.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

let player: AudioPlayer | null = null;
let audioModeReady = false;

async function ensureAudioMode() {
  if (audioModeReady) return;
  try {
    // Allow the chime to play even when the device is on silent (iOS) and
    // duck rather than interrupt other audio.
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
    });
  } catch {
    // ignore — not fatal
  }
  audioModeReady = true;
}

export async function playNotificationSound() {
  try {
    await ensureAudioMode();
    if (!player) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      player = createAudioPlayer(require('@/assets/notification.wav'));
      player.volume = 0.6;
    }
    player.seekTo(0);
    player.play();
  } catch {
    // No audio available (e.g. web autoplay block) — ignore silently.
  }
}
