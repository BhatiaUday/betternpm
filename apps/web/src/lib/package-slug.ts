const VERSION_TAGS = new Set(["latest", "next", "beta", "alpha", "canary", "rc"]);

export function looksLikeVersion(segment: string): boolean {
  return /^v?\d+\.\d+/.test(segment) || VERSION_TAGS.has(segment);
}

export function isVersionTag(segment: string): boolean {
  return VERSION_TAGS.has(segment);
}

/**
 * Split a /p/[...slug] catch-all into a package name and (optional) version. The
 * last segment is treated as a version only when it looks like one, so scoped
 * names such as `@scope/pkg` and bare names both resolve correctly.
 */
export function parseSlug(slug: string[]): { name: string; version?: string } {
  const parts = slug.map((part) => decodeURIComponent(part)).filter(Boolean);

  if (parts.length === 0) {
    return { name: "" };
  }

  const last = parts[parts.length - 1] as string;

  if (parts.length > 1 && looksLikeVersion(last)) {
    return { name: parts.slice(0, -1).join("/"), version: last };
  }

  return { name: parts.join("/") };
}
