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
            
            // Convert codepoint to unicode character
            let unicode = "";
            try {
              unicode = String.fromCodePoint(parseInt(codepoint, 16));
            } catch {
              // Skip if codepoint is invalid
              continue;
            }
            
            emojis.push({
              codepoint,
              unicode,
              name: name || `emoji_${codepoint}`,
              category,
              tags: tags || [],
              lottieUrl: `${LOTTIE_BASE}/${codepoint}/lottie.json`,
              svgUrl: `${SVG_BASE}/emoji_u${codepoint}.svg`,
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
  return catalog.emojis.find(e => e.codepoint === codepoint);
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

/**
 * Convert a Unicode emoji character to its codepoint string
 */
export function emojiToCodepoint(emoji: string): string | null {
  // Handle ZWJ sequences - take the first character
  const codePoints = Array.from(emoji);
  if (codePoints.length === 0) return null;
  
  // Get the first code point (main emoji)
  const firstChar = codePoints[0];
  const codePoint = firstChar.codePointAt(0);
  
  if (!codePoint) return null;
  
  // Convert to hex string without leading zeros
  return codePoint.toString(16).toLowerCase();
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
