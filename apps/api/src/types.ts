export const SCANNER_PROFILE_VERSION = "agent-audit-v1";

export type FindingSeverity = "info" | "low" | "medium" | "high" | "blocked";
export type RiskLevel = "low" | "medium" | "high" | "blocked";
export type AuditConfidence = "low" | "medium" | "high";
export type AuditProvider = "local" | "anthropic" | "openai";
export type AuditTargetKind = "npx" | "npm-install";

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
  sourceScan?: SourceScanSummary;
}

export interface SourceScanSummary {
  scanned: boolean;
  filesScanned: number;
  bytesScanned: number;
  skippedFiles: number;
  findings: Finding[];
  snippets: SourceSnippet[];
  error?: string;
}

export interface SourceSnippet {
  file: string;
  sourceUrl?: string;
  content: string;
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
  confidence?: AuditConfidence;
  summary?: string;
}

export interface AuditIdentity {
  target: AuditTargetKind;
  packageName: string;
  version: string;
  integrity: string;
  scannerProfile: string;
  provider: AuditProvider;
  model: string;
}

export interface AuditRecord {
  id: string;
  identity: AuditIdentity;
  facts: PackageFacts;
  risk: RiskAssessment;
  auditedAt: string;
  requestedByUserId?: string;
  createdAt: string;
}

export interface ProviderAuditReport {
  risk: RiskAssessment;
  summary: string;
  usage?: TokenUsage;
  rawText?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}
