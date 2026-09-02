/**
 * Keep page identity independent from capture-specific query strings, dynamic
 * record ids, and display-language changes.
 */
export function canonicalPageRoute(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "/";
  try {
    const url = new URL(trimmed, "http://brain-creator.local");
    const pathname = url.pathname
      .replace(/\/+(?=\/)/gu, "/")
      .replace(/\/(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{16,})(?=\/|$)/giu, "/:id")
      .replace(/\/$/u, "") || "/";
    return pathname;
  } catch {
    return trimmed
      .split(/[?#]/u, 1)[0]
      .replace(/\/+(?=\/)/gu, "/")
      .replace(/\/(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{16,})(?=\/|$)/giu, "/:id")
      .replace(/\/$/u, "") || "/";
  }
}

export function canonicalPageIdentityKey(route: string) {
  return `page:${canonicalPageRoute(route)}`;
}
