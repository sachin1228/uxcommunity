// ─── Shared avatar library ────────────────────────────────────────────────
// Used by both /signup and /dashboard/profile — single source of truth.

export type AvatarSource =
  | "dicebear"
  | "boring-avatars"
  | "robohash"
  | "avataaars"
  | "multiavatar";

export interface AvatarOption {
  id: string;
  source: AvatarSource;
  style: string;
  label: string;
  /** URL stored in DB (and used for display for non-boring-avatars). */
  dbUrl: string;
  /** Seed used for boring-avatars rendering. */
  seed: string;
}

// ─── Config constants ─────────────────────────────────────────────────────

export const ALL_DICEBEAR_STYLES: { style: string; label: string }[] = [
  { style: "adventurer",          label: "Adventurer" },
  { style: "adventurer-neutral",  label: "Adventurer Neutral" },
  { style: "avataaars",           label: "Avataaars" },
  { style: "avataaars-neutral",   label: "Avataaars Neutral" },
  { style: "big-ears",            label: "Big Ears" },
  { style: "big-ears-neutral",    label: "Big Ears Neutral" },
  { style: "big-smile",           label: "Big Smile" },
  { style: "bottts",              label: "Bottts" },
  { style: "bottts-neutral",      label: "Bottts Neutral" },
  { style: "croodles",            label: "Croodles" },
  { style: "croodles-neutral",    label: "Croodles Neutral" },
  { style: "dylan",               label: "Dylan" },
  { style: "fun-emoji",           label: "Fun Emoji" },
  { style: "glass",               label: "Glass" },
  { style: "identicon",           label: "Identicon" },
  { style: "initials",            label: "Initials" },
  { style: "lorelei",             label: "Lorelei" },
  { style: "lorelei-neutral",     label: "Lorelei Neutral" },
  { style: "micah",               label: "Micah" },
  { style: "miniavs",             label: "Miniavs" },
  { style: "notionists",          label: "Notionists" },
  { style: "notionists-neutral",  label: "Notionists Neutral" },
  { style: "open-peeps",          label: "Open Peeps" },
  { style: "personas",            label: "Personas" },
  { style: "pixel-art",           label: "Pixel Art" },
  { style: "pixel-art-neutral",   label: "Pixel Art Neutral" },
  { style: "rings",               label: "Rings" },
  { style: "shapes",              label: "Shapes" },
  { style: "thumbs",              label: "Thumbs" },
];

export const ALL_BORING_STYLES: { style: string; label: string }[] = [
  { style: "marble",    label: "Marble" },
  { style: "beam",      label: "Beam" },
  { style: "pixel",     label: "Pixel" },
  { style: "sunset",    label: "Sunset" },
  { style: "ring",      label: "Ring" },
  { style: "bauhaus",   label: "Bauhaus" },
  { style: "triangles", label: "Triangles" },
];

export const ALL_ROBOHASH_SETS: { set: string; label: string }[] = [
  { set: "set1", label: "Robots" },
  { set: "set2", label: "Monsters" },
  { set: "set3", label: "Robot Heads" },
  { set: "set4", label: "Kittens" },
];

export const ALL_MULTIAVATAR_SEEDS: string[] = [
  "Alex",   "Jamie",  "Riley",  "Morgan",
  "Casey",  "Quinn",  "Avery",  "Blake",
  "Taylor", "Jordan", "Phoenix","Sage",
  "Drew",   "Reese",  "Dakota", "Finley",
  "Rowan",  "Skylar", "Lennon", "Remy",
];

export const ALL_AVATAAARS_CONFIGS: { id: string; label: string; params: string }[] = [
  { id: "sharp",   label: "Sharp",   params: "topType=ShortHairShortWaved&accessoriesType=Blank&hairColor=BrownDark&facialHairType=Blank&clotheType=BlazerShirt&clotheColor=Black&eyeType=Default&eyebrowType=Default&mouthType=Smile&skinColor=Light" },
  { id: "bun",     label: "Bun",     params: "topType=LongHairBun&accessoriesType=Blank&hairColor=Auburn&facialHairType=Blank&clotheType=Hoodie&clotheColor=Blue01&eyeType=Happy&eyebrowType=RaisedExcited&mouthType=Smile&skinColor=Pale" },
  { id: "curly",   label: "Curly",   params: "topType=LongHairCurly&accessoriesType=Blank&hairColor=Black&facialHairType=Blank&clotheType=ShirtScoopNeck&clotheColor=PastelBlue&eyeType=Wink&eyebrowType=Default&mouthType=Smile&skinColor=Brown" },
  { id: "dreads",  label: "Dreads",  params: "topType=LongHairDreads&accessoriesType=Blank&hairColor=Black&facialHairType=Blank&clotheType=GraphicShirt&clotheColor=Gray01&eyeType=Default&eyebrowType=Default&mouthType=Default&skinColor=DarkBrown" },
  { id: "wavy",    label: "Wavy",    params: "topType=LongHairFro&accessoriesType=Blank&hairColor=Blonde&facialHairType=Blank&clotheType=CollarSweater&clotheColor=PastelOrange&eyeType=Squint&eyebrowType=Default&mouthType=Smile&skinColor=Tanned" },
  { id: "shaggy",  label: "Shaggy",  params: "topType=ShortHairShaggy&accessoriesType=Blank&hairColor=BlondeGolden&facialHairType=BeardLight&clotheType=ShirtCrewNeck&clotheColor=Blue01&eyeType=Default&eyebrowType=Default&mouthType=Default&skinColor=Light" },
  { id: "glasses", label: "Glasses", params: "topType=ShortHairSides&accessoriesType=Prescription01&hairColor=Brown&facialHairType=Blank&clotheType=BlazerSweater&clotheColor=Black&eyeType=Default&eyebrowType=Default&mouthType=Twinkle&skinColor=Pale" },
  { id: "hat",     label: "Hat",     params: "topType=WinterHat1&accessoriesType=Blank&hatColor=Blue01&facialHairType=Blank&clotheType=Overall&clotheColor=PastelGreen&eyeType=Happy&eyebrowType=Default&mouthType=Smile&skinColor=Light" },
  { id: "turban",  label: "Turban",  params: "topType=Turban&accessoriesType=Blank&hatColor=PastelOrange&facialHairType=Blank&clotheType=ShirtCrewNeck&clotheColor=PastelYellow&eyeType=Default&eyebrowType=Default&mouthType=Smile&skinColor=Tanned" },
  { id: "hijab",   label: "Hijab",   params: "topType=Hijab&accessoriesType=Blank&hatColor=Blue02&facialHairType=Blank&clotheType=BlazerShirt&clotheColor=Black&eyeType=Happy&eyebrowType=Default&mouthType=Smile&skinColor=Brown" },
  { id: "flat",    label: "Flat",    params: "topType=ShortHairShortFlat&accessoriesType=Blank&hairColor=Red&facialHairType=Blank&clotheType=Hoodie&clotheColor=PastelRed&eyeType=Default&eyebrowType=Default&mouthType=Smile&skinColor=Light" },
  { id: "mohawk",  label: "Mohawk",  params: "topType=ShortHairFrizzle&accessoriesType=Sunglasses&hairColor=SilverGray&facialHairType=Blank&clotheType=GraphicShirt&clotheColor=Gray02&eyeType=Default&eyebrowType=Default&mouthType=Smile&skinColor=DarkBrown" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

export function getAvatarTabLabel(source: AvatarSource): string {
  if (source === "dicebear")       return "DiceBear";
  if (source === "boring-avatars") return "Boring Avs";
  if (source === "robohash")       return "Robohash";
  if (source === "avataaars")      return "Avataaars";
  return "Multiavatar";
}

export function getAllAvatarOptions(name: string): AvatarOption[] {
  const baseName = name || "designer";
  const seedNames = Array.from({ length: 6 }, (_, i) =>
    i === 0 ? baseName : `${baseName} ${i + 1}`
  );

  const dicebear = ALL_DICEBEAR_STYLES.flatMap(({ style, label }) =>
    seedNames.map((seedName, i) => ({
      id: `dicebear-${style}-${i}`,
      source: "dicebear" as AvatarSource,
      style,
      label: i === 0 ? label : `${label} ${i + 1}`,
      dbUrl: `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seedName)}`,
      seed: seedName,
    }))
  );

  const boring = ALL_BORING_STYLES.flatMap(({ style, label }) =>
    seedNames.map((seedName, i) => ({
      id: `boring-${style}-${i}`,
      source: "boring-avatars" as AvatarSource,
      style,
      label: i === 0 ? label : `${label} ${i + 1}`,
      dbUrl: `boring://${style}/${encodeURIComponent(seedName)}`,
      seed: seedName,
    }))
  );

  const robohash = ALL_ROBOHASH_SETS.flatMap(({ set, label }) =>
    seedNames.map((seedName, i) => ({
      id: `robohash-${set}-${i}`,
      source: "robohash" as AvatarSource,
      style: set,
      label: i === 0 ? label : `${label} ${i + 1}`,
      dbUrl: `https://robohash.org/${encodeURIComponent(seedName)}?set=${set}&size=200x200`,
      seed: seedName,
    }))
  );

  const avataaars = ALL_AVATAAARS_CONFIGS.map(({ id, label, params }) => ({
    id: `avataaars-${id}`,
    source: "avataaars" as AvatarSource,
    style: "avataaars",
    label,
    dbUrl: `https://avataaars.io/?avatarStyle=Circle&${params}`,
    seed: label,
  }));

  const multiavatar = ALL_MULTIAVATAR_SEEDS.map((seedName) => ({
    id: `multiavatar-${seedName}`,
    source: "multiavatar" as AvatarSource,
    style: "open-peeps",
    label: seedName,
    dbUrl: `https://api.dicebear.com/9.x/open-peeps/svg?seed=${encodeURIComponent(seedName)}`,
    seed: seedName,
  }));

  return [...dicebear, ...boring, ...robohash, ...avataaars, ...multiavatar];
}

export function getAvatarSourceOptions(name: string) {
  const all = getAllAvatarOptions(name);
  return {
    all,
    dicebear:          all.filter((o) => o.source === "dicebear"),
    "boring-avatars":  all.filter((o) => o.source === "boring-avatars"),
    robohash:          all.filter((o) => o.source === "robohash"),
    avataaars:         all.filter((o) => o.source === "avataaars"),
    multiavatar:       all.filter((o) => o.source === "multiavatar"),
  };
}
