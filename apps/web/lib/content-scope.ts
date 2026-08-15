export const PUBLIC_CONTENT_SCOPE = "public";

export function isPublicContentScope(scope: string) {
  return scope === PUBLIC_CONTENT_SCOPE;
}

export function publicContentHref(
  type: "thread" | "event" | "resource" | "showcase",
  id: string,
) {
  return `/dashboard/${type === "thread" ? "threads" : type === "event" ? "events" : type === "resource" ? "resources" : "showcase"}/${id}`;
}