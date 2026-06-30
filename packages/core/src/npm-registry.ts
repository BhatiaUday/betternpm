import { encodePackageName } from "./package-spec.js";
import type {
  AgePolicy,
  NpmRegistryMetadata,
  NpmVersionMetadata,
  PackageDownloads,
  PackageFacts,
  PackageSpec
} from "./types.js";

const NPM_REGISTRY_BASE_URL = "https://registry.npmjs.org";
const NPM_DOWNLOADS_BASE_URL = "https://api.npmjs.org/downloads/point/last-week";

export async function fetchPackageMetadata(name: string): Promise<NpmRegistryMetadata> {
  return fetchJson<NpmRegistryMetadata>(`${NPM_REGISTRY_BASE_URL}/${encodePackageName(name)}`);
}

export function resolveVersion(
  metadata: NpmRegistryMetadata,
  requestedVersion?: string
): NpmVersionMetadata {
  const versions = metadata.versions ?? {};
  const distTags = metadata["dist-tags"] ?? {};
  const target = requestedVersion ?? distTags.latest;

  if (!target) {
    throw new Error(`Package ${metadata.name} has no latest dist-tag.`);
  }

  const resolvedVersion = versions[target] ? target : distTags[target];

  if (!resolvedVersion) {
    throw new Error(`Unable to resolve ${metadata.name}@${requestedVersion ?? "latest"}.`);
  }

  const version = versions[resolvedVersion];

  if (!version) {
    throw new Error(`Resolved ${metadata.name}@${resolvedVersion}, but metadata was missing.`);
  }

  return version;
}

export async function fetchWeeklyDownloads(name: string): Promise<PackageDownloads> {
  try {
    const data = await fetchJson<{ downloads?: number }>(
      `${NPM_DOWNLOADS_BASE_URL}/${encodePackageName(name)}`
    );

    return { weekly: data.downloads ?? 0 };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to fetch weekly downloads."
    };
  }
}

export function buildAgePolicy(
  metadata: NpmRegistryMetadata,
  version: string,
  minimumAgeHours: number | undefined
): AgePolicy | undefined {
  if (!minimumAgeHours || minimumAgeHours <= 0) {
    return undefined;
  }

  const publishedAt = metadata.time?.[version];
  const resolvedAgeHours = publishedAt ? hoursSince(publishedAt) : undefined;
  const recommendedOlderVersion = findNewestVersionOlderThan(metadata, minimumAgeHours, version);

  return {
    minimumAgeHours,
    resolvedAgeHours,
    recommendedOlderVersion
  };
}

export function findNewestVersionOlderThan(
  metadata: NpmRegistryMetadata,
  minimumAgeHours: number,
  excludedVersion?: string
): AgePolicy["recommendedOlderVersion"] {
  const versions = Object.keys(metadata.versions ?? {});
  const candidates = versions
    .map((version) => {
      const publishedAt = metadata.time?.[version];
      const ageHours = publishedAt ? hoursSince(publishedAt) : undefined;

      return publishedAt && ageHours !== undefined
        ? { version, publishedAt, ageHours }
        : undefined;
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .filter((candidate) => candidate.version !== excludedVersion && candidate.ageHours >= minimumAgeHours)
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));

  return candidates[0];
}

export function buildPackageFacts(
  spec: PackageSpec,
  metadata: NpmRegistryMetadata,
  versionMetadata: NpmVersionMetadata,
  downloads: PackageDownloads,
  vulnerabilities: PackageFacts["vulnerabilities"],
  options: {
    agePolicy?: AgePolicy;
    sourceScan?: PackageFacts["sourceScan"];
    typosquat?: PackageFacts["typosquat"];
    dependencyAudit?: PackageFacts["dependencyAudit"];
  } = {}
): PackageFacts {
  const runtimeDependencyCount = countKeys(versionMetadata.dependencies)
    + countKeys(versionMetadata.optionalDependencies)
    + countKeys(versionMetadata.peerDependencies);
  const dependencyCount = runtimeDependencyCount + countKeys(versionMetadata.devDependencies);

  return {
    requested: spec.raw,
    name: versionMetadata.name,
    version: versionMetadata.version,
    description: versionMetadata.description ?? metadata.description,
    license: versionMetadata.license ?? metadata.license,
    repository: normalizeRepository(versionMetadata.repository ?? metadata.repository),
    homepage: versionMetadata.homepage ?? metadata.homepage,
    publishedAt: metadata.time?.[versionMetadata.version],
    modifiedAt: metadata.time?.modified,
    maintainers: versionMetadata.maintainers ?? metadata.maintainers ?? [],
    dependencyCount,
    runtimeDependencyCount,
    scripts: versionMetadata.scripts ?? {},
    bin: versionMetadata.bin,
    tarball: versionMetadata.dist?.tarball,
    integrity: versionMetadata.dist?.integrity ?? versionMetadata.dist?.shasum,
    gitHead: versionMetadata.gitHead,
    unpackedSize: versionMetadata.dist?.unpackedSize,
    fileCount: versionMetadata.dist?.fileCount,
    downloads,
    vulnerabilities,
    agePolicy: options.agePolicy,
    sourceScan: options.sourceScan,
    typosquat: options.typosquat,
    dependencyAudit: options.dependencyAudit
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "betternpm/0.0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return response.json() as Promise<T>;
}

function countKeys(value: Record<string, string> | undefined): number {
  return value ? Object.keys(value).length : 0;
}

function normalizeRepository(repository: NpmVersionMetadata["repository"]): string | undefined {
  if (!repository) {
    return undefined;
  }

  if (typeof repository === "string") {
    return repository;
  }

  return repository.url;
}

function hoursSince(date: string): number | undefined {
  const timestamp = Date.parse(date);

  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  return (Date.now() - timestamp) / (1000 * 60 * 60);
}
