import { createInspectionCacheKey, readInspectionCache, writeInspectionCache } from "./cache.js";
import { auditDirectDependencies } from "./dependencies.js";
import { assessRisk } from "./heuristics.js";
import {
  buildAgePolicy,
  buildPackageFacts,
  fetchPackageMetadata,
  fetchWeeklyDownloads,
  resolveVersion
} from "./npm-registry.js";
import { queryOsv } from "./osv.js";
import { parsePackageSpec } from "./package-spec.js";
import { scanTarball } from "./tarball.js";
import { detectTyposquat } from "./typosquat.js";
import {
  SCANNER_PROFILE_VERSION,
  type InspectPackageOptions,
  type OsvVulnerability,
  type PackageInspection
} from "./types.js";

export async function inspectPackage(
  rawSpec: string,
  options: InspectPackageOptions = {}
): Promise<PackageInspection> {
  const includeOsv = options.includeOsv ?? true;
  const useCache = options.cache ?? true;
  const inspectTarball = options.inspectTarball ?? true;
  const auditDependencies = options.auditDependencies ?? false;
  const target = options.target ?? "npx";
  const spec = parsePackageSpec(rawSpec);
  const metadata = await fetchPackageMetadata(spec.name);
  const versionMetadata = resolveVersion(metadata, spec.requestedVersion);
  const cacheKey = createInspectionCacheKey({
    name: versionMetadata.name,
    version: versionMetadata.version,
    integrity: versionMetadata.dist?.integrity ?? versionMetadata.dist?.shasum,
    target
  });

  if (useCache) {
    const cached = await readInspectionCache(cacheKey);

    if (cached) {
      return cached;
    }
  }

  const [downloads, vulnerabilities] = await Promise.all([
    fetchWeeklyDownloads(versionMetadata.name),
    includeOsv ? safeQueryOsv(versionMetadata.name, versionMetadata.version) : Promise.resolve([])
  ]);
  const sourceScan = inspectTarball && versionMetadata.dist?.tarball
    ? await scanTarball({
      tarballUrl: versionMetadata.dist.tarball,
      integrity: versionMetadata.dist.integrity ?? versionMetadata.dist.shasum,
      repository: versionMetadata.repository ?? metadata.repository,
      gitHead: versionMetadata.gitHead
    })
    : undefined;
  const dependencyAudit = auditDependencies
    ? await auditDirectDependencies(versionMetadata, { maxDependencies: options.maxDependencies })
    : undefined;
  const agePolicy = buildAgePolicy(metadata, versionMetadata.version, options.minimumVersionAgeHours);
  const facts = buildPackageFacts(spec, metadata, versionMetadata, downloads, vulnerabilities, {
    agePolicy,
    sourceScan,
    typosquat: detectTyposquat(spec.name),
    dependencyAudit
  });
  const inspection: PackageInspection = {
    scannerProfile: SCANNER_PROFILE_VERSION,
    cacheKey,
    cacheHit: false,
    inspectedAt: new Date().toISOString(),
    facts,
    risk: assessRisk(facts, { target })
  };

  if (useCache) {
    await writeInspectionCache(inspection);
  }

  return inspection;
}

async function safeQueryOsv(name: string, version: string): Promise<OsvVulnerability[]> {
  try {
    return await queryOsv(name, version);
  } catch {
    return [];
  }
}
