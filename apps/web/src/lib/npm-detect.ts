// Detects whether each published version of a package ships an executable (`bin`),
// reading the CORS-enabled npm registry packument. Used to auto-pick the audit
// command (npx for executables, npm install for libraries). Returns {} on failure
// so callers can fall back to a manual choice.
export async function loadBinMap(name: string): Promise<Record<string, boolean>> {
  const path = name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);

  try {
    const response = await fetch(`https://registry.npmjs.org/${path}`, {
      headers: { accept: "application/vnd.npm.install-v1+json" }
    });

    if (!response.ok) {
      return {};
    }

    const doc = await response.json() as { versions?: Record<string, { bin?: unknown }> };
    const map: Record<string, boolean> = {};

    for (const [value, meta] of Object.entries(doc.versions ?? {})) {
      map[value] = hasExecutable(meta?.bin);
    }

    return map;
  } catch {
    return {};
  }
}

export function hasExecutable(bin: unknown): boolean {
  if (typeof bin === "string") {
    return bin.trim().length > 0;
  }

  if (bin && typeof bin === "object") {
    return Object.keys(bin as Record<string, unknown>).length > 0;
  }

  return false;
}
