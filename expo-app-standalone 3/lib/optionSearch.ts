/**
 * Ranked search for master-data pickers — the mobile twin of
 * `apps/web/lib/search/option-search.ts`; keep the two in lockstep.
 *
 * A city is often known by more than its catalog name — Bengaluru is typed as
 * Bangalore, Mumbai as Bombay — so every option can carry aliases, and the
 * query is matched against the name and all of them. The closest match ranks
 * first: exact, prefix, word prefix, substring, then a small edit distance so
 * a typo ("Banglore", "Bengalru") still finds the city.
 */

export interface SearchableOption {
  name: string;
  aliases?: string[] | null;
}

/** Lowercase, strip diacritics and punctuation, collapse spaces. */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = row;
  }
  return previous[b.length];
}

/** Allowed typo distance by query length — short queries stay exact. */
function typoBudget(query: string): number {
  if (query.length >= 8) return 2;
  if (query.length >= 4) return 1;
  return 0;
}

function scoreCandidate(candidate: string, query: string): number | null {
  if (candidate === query) return 0;
  if (candidate.startsWith(query)) return 1;

  const words = candidate.split(' ');
  if (words.some((word) => word.startsWith(query))) return 2;
  if (candidate.includes(query)) return 3;

  const budget = typoBudget(query);
  if (!budget) return null;

  let best: number | null = null;
  for (const target of [candidate, ...words]) {
    if (Math.abs(target.length - query.length) > budget) continue;
    const distance = editDistance(query, target);
    if (distance <= budget && (best === null || distance < best)) best = distance;
  }
  return best === null ? null : 4 + best;
}

/** Lowest score across the name and its aliases; null when nothing matches. */
export function matchScore(option: SearchableOption, query: string): number | null {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;

  const candidates = [option.name, ...(option.aliases ?? [])]
    .map(normalizeSearchText)
    .filter(Boolean);

  let best: number | null = null;
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, normalizedQuery);
    if (score !== null && (best === null || score < best)) best = score;
  }
  return best;
}

/**
 * The options matching `query`, best first. Ties keep the catalog order the
 * caller supplied (alphabetical). An empty query returns the list untouched.
 */
export function rankOptions<T extends SearchableOption>(options: T[], query: string): T[] {
  const trimmed = query.trim();
  if (!trimmed) return options;

  return options
    .map((option, index) => ({ option, index, score: matchScore(option, trimmed) }))
    .filter((entry): entry is { option: T; index: number; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.option);
}
