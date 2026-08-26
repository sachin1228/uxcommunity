const LEGACY_GENERATED_PICTURE_PATTERNS = [
  /^boring:\/\//i,
  /^https:\/\/(?:[^/]+\.)?dicebear\.com\//i,
  /^https:\/\/(?:[^/]+\.)?robohash\.org\//i,
  /^https:\/\/(?:[^/]+\.)?(?:api\.)?avataaars\.io\//i,
  /^https:\/\/(?:[^/]+\.)?multiavatar\.com\//i,
  /^https:\/\/source\.boringavatars\.com\//i,
];

export function resolveProfilePictureUri(url: string | null | undefined): string | null {
  if (!url || LEGACY_GENERATED_PICTURE_PATTERNS.some((pattern) => pattern.test(url))) {
    return null;
  }

  return url;
}
