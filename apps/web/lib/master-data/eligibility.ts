/**
 * Master-data image-fetch eligibility.
 *
 * The Admin "Fetch images" flow auto-attaches a photo (Pexels for cities,
 * Wikipedia for every other list) to each master-data row. Only the "Other"
 * catch-all option is excluded — it is a fallback choice, not a real entry,
 * and has no meaningful photo.
 */

const NON_ITEM_NAMES = ["other"];

/**
 * Returns true when a master-data row should get an auto-fetched Wikipedia
 * image. Matching is case-insensitive so it works regardless of how the name
 * was entered in master data.
 */
export function shouldAutoFetchImage(name: string): boolean {
  return !NON_ITEM_NAMES.includes(name.trim().toLowerCase());
}