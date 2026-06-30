import { encodePackageName } from "./package-spec.js";
import { queryOsvBatch } from "./osv.js";
import { isParseableRange, maxSatisfying, parseVersion } from "./semver.js";
import { detectTyposquat } from "./typosquat.js";
import type {
  DependencyAudit,
  DependencyAuditEntry,
  NpmVersionMetadata,
  OsvVulnerability,
  RiskLevel
} from "./types.js";

const NPM_REGISTRY_BASE_URL = "https://registry.npmjs.org";
const ABBREVIATED_ACCEPT = "application/vnd.npm.install-v1+json";
const DEFAULT_MAX_DEPENDENCIES = 50;
const RESOLVE_CONCURRENCY = 8;

interface AbbreviatedPackument {
  versions?: Record<string, unknown>;
  "dist-tags"?: Record<string, string>;
}

interface ResolvedDependency {
  name: string;
  range: string;
  resolvedVersion?: string;
  error?: string;
}

/**
 * Audit the direct runtime dependencies (depth 1) of a package using only cheap,
 * deterministic signals — resolved version + OSV vulnerabilities + typosquat name
 * checks. No tarball download and no AI calls are made, so this stays inexpensive
 * even for packages with large dependency sets.
 */
export async function auditDirectDependencies(
  versionMetadata: NpmVersionMetadata,
  options: { maxDependencies?: number } = {}
): Promise<DependencyAudit> {
  const maxDependencies = options.maxDependencies ?? DEFAULT_MAX_DEPENDENCIES;
  const dependencies = versionMetadata.dependencies ?? {};
  const names = Object.keys(dependencies);
  const directDependencyCount = names.length;

  if (directDependencyCount === 0) {
    return {
      scanned: true,
      depth: 1,
      directDependencyCount: 0,
      auditedCount: 0,
      truncated: false,
      entries: []
    };
  }

  const truncated = directDependencyCount > maxDependencies;
  const selected = names.slice(0, maxDependencies);

  try {
    const resolved = await mapWithConcurrency(selected, RESOLVE_CONCURRENCY, (name) =>
      resolveDependency(name, dependencies[name] ?? "*")
    );

    const batchTargets = resolved
      .map((dependency, index) => ({ dependency, index }))
      .filter((item) => item.dependency.resolvedVersion);

    const vulnLists = await safeOsvBatch(
      batchTargets.map((item) => ({
        name: item.dependency.name,
        version: item.dependency.resolvedVersion as string
      }))
    );

    const vulnByIndex = new Map<number, OsvVulnerability[]>();
    batchTargets.forEach((item, position) => {
      vulnByIndex.set(item.index, vulnLists[position] ?? []);
    });

    const entries: DependencyAuditEntry[] = resolved.map((dependency, index) => {
      const vulnerabilities = vulnByIndex.get(index) ?? [];
      const typosquat = detectTyposquat(dependency.name);

      return {
        name: dependency.name,
        range: dependency.range,
        resolvedVersion: dependency.resolvedVersion,
        vulnerabilities,
        typosquat: typosquat.suspected ? typosquat : undefined,
        riskLevel: levelForDependency(vulnerabilities, typosquat.suspected),
        error: dependency.error
      };
    });

    return {
      scanned: true,
      depth: 1,
      directDependencyCount,
      auditedCount: entries.length,
      truncated,
      entries
    };
  } catch (error) {
    return {
      scanned: false,
      depth: 1,
      directDependencyCount,
      auditedCount: 0,
      truncated,
      entries: [],
      error: error instanceof Error ? error.message : "Dependency audit failed."
    };
  }
}

function levelForDependency(vulnerabilities: OsvVulnerability[], typosquatSuspected: boolean): RiskLevel {
  if (vulnerabilities.length > 0) {
    return "blocked";
  }

  if (typosquatSuspected) {
    return "high";
  }

  return "low";
}

async function resolveDependency(name: string, range: string): Promise<ResolvedDependency> {
  const trimmedRange = range.trim();

  // An exact pin needs no network call and is resolved precisely.
  const exact = parseVersion(trimmedRange);
  if (exact && /^[v=]*\d+\.\d+\.\d+/.test(trimmedRange)) {
    return { name, range, resolvedVersion: `${exact.major}.${exact.minor}.${exact.patch}${exact.prerelease.length ? `-${exact.prerelease.join(".")}` : ""}` };
  }

  try {
    // For caret/tilde/comparator ranges, resolve the highest published version that
    // actually satisfies the range so OSV is queried against the right artifact.
    if (isParseableRange(trimmedRange)) {
      const packument = await fetchJson<AbbreviatedPackument>(
        `${NPM_REGISTRY_BASE_URL}/${encodePackageName(name)}`,
        ABBREVIATED_ACCEPT
      );
      const versions = Object.keys(packument.versions ?? {});
      const resolved = maxSatisfying(versions, trimmedRange) ?? packument["dist-tags"]?.latest;

      if (resolved) {
        return { name, range, resolvedVersion: resolved };
      }
    }

    // Fallback: unparseable range (git/url/alias) -> use the latest published version.
    const manifest = await fetchJson<NpmVersionMetadata>(
      `${NPM_REGISTRY_BASE_URL}/${encodePackageName(name)}/latest`
    );

    return { name, range, resolvedVersion: manifest.version };
  } catch (error) {
    return {
      name,
      range,
      error: error instanceof Error ? error.message : "Unable to resolve dependency version."
    };
  }
}

async function safeOsvBatch(queries: Array<{ name: string; version: string }>): Promise<OsvVulnerability[][]> {
  if (queries.length === 0) {
    return [];
  }

  try {
    return await queryOsvBatch(queries);
  } catch {
    return queries.map(() => []);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index] as T);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);

  return results;
}

async function fetchJson<T>(url: string, accept = "application/json"): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "accept": accept,
      "user-agent": "betternpm/0.0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return response.json() as Promise<T>;
}
