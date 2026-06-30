/**
 * A compact, dependency-free semver subset sufficient for resolving npm dependency
 * ranges to a concrete installed version. It supports the comparator forms that
 * appear in the overwhelming majority of real package.json ranges: exact, `=`,
 * `^`, `~`, comparators (`>`, `>=`, `<`, `<=`), `x`/`*` wildcards, partial versions,
 * and `||` unions. Prerelease versions are excluded from matches unless a range
 * explicitly pins the same major.minor.patch with a prerelease tag.
 *
 * This is intentionally not a full semver implementation; unparseable ranges should
 * be handled by the caller (e.g. by falling back to the dist-tag `latest`).
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: ReadonlyArray<string | number>;
}

export function parseVersion(raw: string): SemVer | undefined {
  const cleaned = raw.trim().replace(/^[v=]+/, "");
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(cleaned);

  if (!match) {
    return undefined;
  }

  const prerelease = match[4]
    ? match[4].split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part))
    : [];

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease
  };
}

export function compareVersions(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) {
    return a.major < b.major ? -1 : 1;
  }

  if (a.minor !== b.minor) {
    return a.minor < b.minor ? -1 : 1;
  }

  if (a.patch !== b.patch) {
    return a.patch < b.patch ? -1 : 1;
  }

  return comparePrerelease(a.prerelease, b.prerelease);
}

function comparePrerelease(a: ReadonlyArray<string | number>, b: ReadonlyArray<string | number>): number {
  // A version with no prerelease has higher precedence than one with a prerelease.
  if (a.length === 0 && b.length === 0) {
    return 0;
  }

  if (a.length === 0) {
    return 1;
  }

  if (b.length === 0) {
    return -1;
  }

  const length = Math.min(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const left = a[index] as string | number;
    const right = b[index] as string | number;

    if (left === right) {
      continue;
    }

    const leftIsNumber = typeof left === "number";
    const rightIsNumber = typeof right === "number";

    if (leftIsNumber && rightIsNumber) {
      return left < right ? -1 : 1;
    }

    if (leftIsNumber !== rightIsNumber) {
      return leftIsNumber ? -1 : 1;
    }

    return String(left) < String(right) ? -1 : 1;
  }

  if (a.length === b.length) {
    return 0;
  }

  return a.length < b.length ? -1 : 1;
}

interface Bound {
  version: SemVer;
  inclusive: boolean;
}

interface ComparatorSet {
  lower?: Bound;
  upper?: Bound;
  exact?: SemVer;
}

function bumpMajor(version: SemVer): SemVer {
  return { major: version.major + 1, minor: 0, patch: 0, prerelease: [] };
}

function bumpMinor(version: SemVer): SemVer {
  return { major: version.major, minor: version.minor + 1, patch: 0, prerelease: [] };
}

function bumpPatch(version: SemVer): SemVer {
  return { major: version.major, minor: version.minor, patch: version.patch + 1, prerelease: [] };
}

function caretUpper(version: SemVer): SemVer {
  if (version.major > 0) {
    return bumpMajor(version);
  }

  if (version.minor > 0) {
    return bumpMinor(version);
  }

  return bumpPatch(version);
}

function parsePartial(raw: string): { version: SemVer; specificity: 0 | 1 | 2 | 3 } | undefined {
  const cleaned = raw.trim().replace(/^[v=]+/, "");

  if (cleaned === "" || cleaned === "*" || cleaned === "x" || cleaned === "X") {
    return { version: { major: 0, minor: 0, patch: 0, prerelease: [] }, specificity: 0 };
  }

  const match = /^(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?$/.exec(cleaned);

  if (!match) {
    return undefined;
  }

  const minorWild = match[2] === undefined || match[2] === "x" || match[2] === "X" || match[2] === "*";
  const patchWild = match[3] === undefined || match[3] === "x" || match[3] === "X" || match[3] === "*";
  const major = Number(match[1]);
  const minor = minorWild ? 0 : Number(match[2]);
  const patch = patchWild ? 0 : Number(match[3]);
  const prerelease = match[4]
    ? match[4].split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part))
    : [];
  const specificity: 0 | 1 | 2 | 3 = minorWild ? 1 : patchWild ? 2 : 3;

  return { version: { major, minor, patch, prerelease }, specificity };
}

function parseComparator(token: string): ComparatorSet | undefined {
  const trimmed = token.trim();

  if (trimmed === "" || trimmed === "*" || trimmed === "x" || trimmed === "X") {
    return {};
  }

  if (trimmed.startsWith("^")) {
    const partial = parsePartial(trimmed.slice(1));
    if (!partial) {
      return undefined;
    }
    return { lower: { version: partial.version, inclusive: true }, upper: { version: caretUpper(partial.version), inclusive: false } };
  }

  if (trimmed.startsWith("~")) {
    const partial = parsePartial(trimmed.slice(1));
    if (!partial) {
      return undefined;
    }
    const upper = partial.specificity >= 2 ? bumpMinor(partial.version) : bumpMajor(partial.version);
    return { lower: { version: partial.version, inclusive: true }, upper: { version: upper, inclusive: false } };
  }

  const operatorMatch = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(trimmed);
  if (!operatorMatch) {
    return undefined;
  }

  const operator = operatorMatch[1] ?? "=";
  const partial = parsePartial(operatorMatch[2] ?? "");
  if (!partial) {
    return undefined;
  }

  switch (operator) {
    case ">":
      return { lower: { version: partial.version, inclusive: false } };
    case ">=":
      return { lower: { version: partial.version, inclusive: true } };
    case "<":
      return { upper: { version: partial.version, inclusive: false } };
    case "<=":
      return { upper: { version: partial.version, inclusive: true } };
    default: {
      if (partial.specificity === 3) {
        return { exact: partial.version };
      }
      // Partial exact (e.g. `1.2`) behaves like a range covering that prefix.
      const upper = partial.specificity === 1 ? bumpMajor(partial.version) : bumpMinor(partial.version);
      return { lower: { version: partial.version, inclusive: true }, upper: { version: upper, inclusive: false } };
    }
  }
}

function mergeSets(sets: ComparatorSet[]): ComparatorSet | undefined {
  const merged: ComparatorSet = {};

  for (const set of sets) {
    if (set.exact) {
      merged.exact = set.exact;
    }

    if (set.lower && (!merged.lower || compareVersions(set.lower.version, merged.lower.version) > 0)) {
      merged.lower = set.lower;
    }

    if (set.upper && (!merged.upper || compareVersions(set.upper.version, merged.upper.version) < 0)) {
      merged.upper = set.upper;
    }
  }

  return merged;
}

function satisfiesSet(version: SemVer, set: ComparatorSet): boolean {
  // Exclude prereleases unless the range explicitly targets a prerelease bound.
  if (version.prerelease.length > 0) {
    const boundHasPrerelease = Boolean(set.exact?.prerelease.length)
      || Boolean(set.lower?.version.prerelease.length)
      || Boolean(set.upper?.version.prerelease.length);

    if (!boundHasPrerelease) {
      return false;
    }
  }

  if (set.exact) {
    return compareVersions(version, set.exact) === 0;
  }

  if (set.lower) {
    const comparison = compareVersions(version, set.lower.version);
    if (comparison < 0 || (comparison === 0 && !set.lower.inclusive)) {
      return false;
    }
  }

  if (set.upper) {
    const comparison = compareVersions(version, set.upper.version);
    if (comparison > 0 || (comparison === 0 && !set.upper.inclusive)) {
      return false;
    }
  }

  return true;
}

/**
 * Returns true if `version` satisfies `range`. Returns false for ranges that cannot
 * be parsed, so callers can detect non-support by also checking `isParseableRange`.
 */
export function satisfies(version: string, range: string): boolean {
  const parsedVersion = parseVersion(version);
  if (!parsedVersion) {
    return false;
  }

  const unions = range.split("||");

  for (const union of unions) {
    const tokens = union.trim().split(/\s+/).filter(Boolean);
    const comparators = tokens.length === 0 ? [{} as ComparatorSet] : tokens.map(parseComparator);

    if (comparators.some((comparator) => comparator === undefined)) {
      continue;
    }

    const merged = mergeSets(comparators as ComparatorSet[]);
    if (merged && satisfiesSet(parsedVersion, merged)) {
      return true;
    }
  }

  return false;
}

export function isParseableRange(range: string): boolean {
  const unions = range.split("||");

  return unions.every((union) => {
    const tokens = union.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return true;
    }
    return tokens.every((token) => parseComparator(token) !== undefined);
  });
}

/**
 * Returns the highest version from `versions` that satisfies `range`, or undefined
 * if none match or the range is unparseable.
 */
export function maxSatisfying(versions: string[], range: string): string | undefined {
  let best: { raw: string; parsed: SemVer } | undefined;

  for (const raw of versions) {
    if (!satisfies(raw, range)) {
      continue;
    }

    const parsed = parseVersion(raw);
    if (!parsed) {
      continue;
    }

    if (!best || compareVersions(parsed, best.parsed) > 0) {
      best = { raw, parsed };
    }
  }

  return best?.raw;
}
