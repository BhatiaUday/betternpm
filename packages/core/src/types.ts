export const SCANNER_PROFILE_VERSION = "local-heuristics-v9";

export type FindingSeverity = "info" | "low" | "medium" | "high" | "blocked";
export type InspectionTarget = "npx" | "npm-install";
export type RiskLevel = "low" | "medium" | "high" | "blocked";

export interface PackageSpec {
  raw: string;
  name: string;
  requestedVersion?: string;
}

export interface NpmMaintainer {
  name?: string;
  email?: string;
}

export interface NpmDist {
  tarball?: string;
  integrity?: string;
  shasum?: string;
  unpackedSize?: number;
  fileCount?: number;
}

export interface NpmVersionMetadata {
  name: string;
  version: string;
  description?: string;
  license?: string;
  repository?: string | { type?: string; url?: string; directory?: string };
  homepage?: string;
  maintainers?: NpmMaintainer[];
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  bin?: string | Record<string, string>;
  dist?: NpmDist;
  gitHead?: string;
}

export interface NpmRegistryMetadata {
  name: string;
  description?: string;
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, NpmVersionMetadata>;
  time?: Record<string, string>;
  maintainers?: NpmMaintainer[];
  license?: string;
  repository?: string | { type?: string; url?: string; directory?: string };
  homepage?: string;
}

export interface OsvVulnerability {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  modified?: string;
  published?: string;
  severity?: Array<{ type: string; score: string }>;
}

export interface PackageDownloads {
  weekly?: number;
  error?: string;
}

export interface RecommendedOlderVersion {
  version: string;
  publishedAt: string;
  ageHours: number;
}

export interface AgePolicy {
  minimumAgeHours: number;
  resolvedAgeHours?: number;
  recommendedOlderVersion?: RecommendedOlderVersion;
}

export interface SourceScanSummary {
  scanned: boolean;
  filesScanned: number;
  bytesScanned: number;
  skippedFiles: number;
  findings: Finding[];
  error?: string;
}

export interface TyposquatAssessment {
  suspected: boolean;
  candidate: string;
  nearest?: string;
  distance?: number;
  reason?: string;
}

export interface DependencyAuditEntry {
  name: string;
  range: string;
  resolvedVersion?: string;
  riskLevel: RiskLevel;
  vulnerabilities: OsvVulnerability[];
  typosquat?: TyposquatAssessment;
  error?: string;
}

export interface DependencyAudit {
  scanned: boolean;
  depth: number;
  directDependencyCount: number;
  auditedCount: number;
  truncated: boolean;
  entries: DependencyAuditEntry[];
  error?: string;
}

export interface PackageFacts {
  requested: string;
  name: string;
  version: string;
  description?: string;
  license?: string;
  repository?: string;
  homepage?: string;
  publishedAt?: string;
  modifiedAt?: string;
  maintainers: NpmMaintainer[];
  dependencyCount: number;
  runtimeDependencyCount: number;
  scripts: Record<string, string>;
  bin?: string | Record<string, string>;
  tarball?: string;
  integrity?: string;
  gitHead?: string;
  unpackedSize?: number;
  fileCount?: number;
  downloads: PackageDownloads;
  vulnerabilities: OsvVulnerability[];
  agePolicy?: AgePolicy;
  sourceScan?: SourceScanSummary;
  typosquat?: TyposquatAssessment;
  dependencyAudit?: DependencyAudit;
}

export interface Finding {
  severity: FindingSeverity;
  code: string;
  title: string;
  detail?: string;
  evidence?: FindingEvidence[];
}

export interface FindingEvidence {
  file: string;
  sourceUrl?: string;
}

export interface RiskAssessment {
  level: RiskLevel;
  score: number;
  findings: Finding[];
}

export interface PackageInspection {
  scannerProfile: string;
  cacheKey: string;
  cacheHit: boolean;
  inspectedAt: string;
  facts: PackageFacts;
  risk: RiskAssessment;
}

export interface InspectPackageOptions {
  target?: InspectionTarget;
  includeOsv?: boolean;
  cache?: boolean;
  inspectTarball?: boolean;
  minimumVersionAgeHours?: number;
  auditDependencies?: boolean;
  maxDependencies?: number;
}
