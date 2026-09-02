/**
 * Noto Emoji Animation catalog service.
 * Fetches the emoji catalog from Google's Noto Emoji Animation project
 * and maps codepoints to Lottie animation URLs.
 */

export interface NotoEmoji {
  codepoint: string;
  unicode: string;
  name: string;
  category: string;
  tags: string[];
  lottieUrl: string;
  svgUrl: string;
}

export interface EmojiCatalog {
  emojis: NotoEmoji[];
  categories: string[];
}

const CATALOG_URL = "https://googlefonts.github.io/noto-emoji-animation/data/api.json";
const LOTTIE_BASE = "https://fonts.gstatic.com/s/e/notoemoji/latest";
const SVG_BASE = "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg";

// In-memory cache
let catalogCache: EmojiCatalog | null = null;
let fetchPromise: Promise<EmojiCatalog> | null = null;

/**
 * Fetch the emoji catalog from Google's Noto Emoji Animation API
 */
export async function fetchEmojiCatalog(): Promise<EmojiCatalog> {
  if (catalogCache) return catalogCache;
  
  if (fetchPromise) return fetchPromise;
  
  fetchPromise = (async () => {
    try {
      const response = await fetch(CATALOG_URL);
      if (!response.ok) {
        throw new Error(`Failed to fetch emoji catalog: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Transform the API response into our format
      const emojis: NotoEmoji[] = [];
      const categories = new Set<string>();
      
      // The API returns { icons: [...] } where each icon has name, codepoint, categories, tags
      if (data && data.icons && Array.isArray(data.icons)) {
        for (const icon of data.icons) {
          const { name, codepoint, categories: iconCategories, tags } = icon;
          
          if (codepoint) {
            const category = iconCategories?.[0] || "Other";
            
            // Codepoints may be sequences like "2764_fe0f_200d_1f525"
            // (heart on fire). Decode *every* part so the inserted character
            // is the full emoji, not just its first component.
            const unicode = codepointToEmoji(codepoint);
            if (!unicode) continue;
            
            emojis.push({
              codepoint,
              unicode,
              name: name || `emoji_${codepoint}`,
              category,
              tags: tags || [],
              lottieUrl: `${LOTTIE_BASE}/${codepoint}/lottie.json`,
              svgUrl: svgUrlForCodepoint(codepoint),
            });
            
            categories.add(category);
          }
        }
      }
      
      // Sort categories with "Smileys and emotions" first, then alphabetically
      const sortedCategories = Array.from(categories).sort((a, b) => {
        if (a === "Smileys and emotions") return -1;
        if (b === "Smileys and emotions") return 1;
        return a.localeCompare(b);
      });
      
      catalogCache = {
        emojis,
        categories: sortedCategories,
      };
      
      return catalogCache;
    } catch (error) {
      console.error('Failed to fetch emoji catalog:', error);
      // Return empty catalog on error
      return { emojis: [], categories: [] };
    } finally {
      fetchPromise = null;
    }
  })();
  
  return fetchPromise;
}

/**
 * Get emoji by codepoint
 */
export async function getEmojiByCodepoint(codepoint: string): Promise<NotoEmoji | undefined> {
  const catalog = await fetchEmojiCatalog();
  const wanted = stripVS16(codepoint);
  return catalog.emojis.find(e => stripVS16(e.codepoint) === wanted);
}

/**
 * Search emoji by name, tags, or category
 */
export async function searchEmoji(query: string): Promise<NotoEmoji[]> {
  const catalog = await fetchEmojiCatalog();
  const lowerQuery = query.toLowerCase();
  
  return catalog.emojis.filter(emoji => 
    emoji.name.toLowerCase().includes(lowerQuery) ||
    emoji.category.toLowerCase().includes(lowerQuery) ||
    emoji.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
  );
}

/**
 * Get emoji by category
 */
export async function getEmojiByCategory(category: string): Promise<NotoEmoji[]> {
  const catalog = await fetchEmojiCatalog();
  return catalog.emojis.filter(emoji => emoji.category === category);
}

/** Variation selector-16 — present in many emoji, absent from Noto asset names. */
const VS16 = "fe0f";

/** Remove every fe0f part from a "_"-joined codepoint key. */
function stripVS16(codepoint: string): string {
  return codepoint.split("_").filter((p) => p !== VS16).join("_");
}

/**
 * Convert an emoji (single character *or* a full sequence such as a
 * skin-toned hand or a ZWJ family) to the Noto asset key, e.g.
 *   "❤️‍🔥" -> "2764_200d_1f525"
 *   "👍🏽"  -> "1f44d_1f3fd"
 *
 * The result is safe for both the Lottie CDN and the SVG repo: neither
 * requires the fe0f selector and the SVG repo 404s when it is present.
 */
export function emojiToCodepoint(emoji: string): string | null {
  const parts: string[] = [];
  for (const ch of emoji) {
    const cp = ch.codePointAt(0);
    if (!cp) continue;
    const hex = cp.toString(16).toLowerCase();
    if (hex === VS16) continue;
    parts.push(hex);
  }
  return parts.length ? parts.join("_") : null;
}

/**
 * Convert a catalog codepoint string ("2764_fe0f_200d_1f525") back into the
 * emoji character it represents. Returns "" if it cannot be decoded.
 */
export function codepointToEmoji(codepoint: string): string {
  try {
    return codepoint
      .split("_")
      .map((hex) => String.fromCodePoint(parseInt(hex, 16)))
      .join("");
  } catch {
    return "";
  }
}

/**
 * Get the Lottie URL for an emoji character
 */
export async function getEmojiLottieUrl(emoji: string): Promise<string | null> {
  const codepoint = emojiToCodepoint(emoji);
  if (!codepoint) return null;
  
  const emojiData = await getEmojiByCodepoint(codepoint);
  return emojiData?.lottieUrl ?? null;
}

/**
 * Get SVG URL for a codepoint (synchronous).
 * Noto SVG filenames never include the fe0f selector, so strip it.
 */
export function svgUrlForCodepoint(codepoint: string): string {
  return `${SVG_BASE}/emoji_u${stripVS16(codepoint)}.svg`;
}
