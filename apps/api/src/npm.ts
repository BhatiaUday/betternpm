import type {
  NpmRegistryMetadata,
  NpmVersionMetadata,
  OsvVulnerability,
  PackageDownloads,
  PackageFacts
} from "./types.js";

const NPM_REGISTRY_BASE_URL = "https://registry.npmjs.org";
const NPM_DOWNLOADS_BASE_URL = "https://api.npmjs.org/downloads/point/last-week";

export async function fetchPackageMetadata(name: string): Promise<NpmRegistryMetadata> {
  return fetchJson<NpmRegistryMetadata>(`${NPM_REGISTRY_BASE_URL}/${encodePackageName(name)}`);
}

export function resolveVersion(metadata: NpmRegistryMetadata, requestedVersion?: string): NpmVersionMetadata {
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
    const data = await fetchJson<{ downloads?: number }>(`${NPM_DOWNLOADS_BASE_URL}/${encodePackageName(name)}`);
    return { weekly: data.downloads ?? 0 };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to fetch weekly downloads."
    };
  }
}

export function buildPackageFacts(input: {
  requested: string;
  metadata: NpmRegistryMetadata;
  versionMetadata: NpmVersionMetadata;
  downloads: PackageDownloads;
  vulnerabilities: OsvVulnerability[];
  sourceScan?: PackageFacts["sourceScan"];
}): PackageFacts {
  const { requested, metadata, versionMetadata, downloads, vulnerabilities, sourceScan } = input;
  const runtimeDependencyCount = countKeys(versionMetadata.dependencies)
    + countKeys(versionMetadata.optionalDependencies)
    + countKeys(versionMetadata.peerDependencies);
  const dependencyCount = runtimeDependencyCount + countKeys(versionMetadata.devDependencies);

  return {
    requested,
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
    sourceScan
  };
}

function encodePackageName(name: string): string {
  return encodeURIComponent(name);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "betternpm-api/0.0.1"
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
