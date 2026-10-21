/**
 * One video plays at a time, like the web player's global activate event:
 * joining candidates are ranked by their list position, and the topmost one
 * on screen owns playback — everyone else pauses. When it leaves the
 * viewport (or the screen), the next candidate takes over.
 */
type Candidate = { rank: number; play: () => void; pause: () => void };

const candidates = new Map<number, Candidate>();

function sync() {
  const ownerRank = Math.min(...Array.from(candidates.keys()));
  for (const candidate of candidates.values()) {
    if (candidate.rank === ownerRank) candidate.play();
    else candidate.pause();
  }
}

export function joinVideoPlayback(candidate: Candidate) {
  candidates.set(candidate.rank, candidate);
  sync();
}

export function leaveVideoPlayback(rank: number, pause: () => void) {
  if (candidates.get(rank)?.pause === pause) candidates.delete(rank);
  sync();
}
