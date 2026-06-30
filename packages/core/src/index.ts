export { inspectPackage } from "./inspect.js";
export { parsePackageSpec } from "./package-spec.js";
export { assessRisk } from "./heuristics.js";
export { detectTyposquat, damerauLevenshtein, POPULAR_PACKAGES } from "./typosquat.js";
export { auditDirectDependencies } from "./dependencies.js";
export { queryOsv, queryOsvBatch } from "./osv.js";
export { satisfies, maxSatisfying, parseVersion, compareVersions } from "./semver.js";
export type {
  DependencyAudit,
  DependencyAuditEntry,
  Finding,
  FindingSeverity,
  InspectPackageOptions,
  OsvVulnerability,
  PackageFacts,
  PackageInspection,
  PackageSpec,
  RiskAssessment,
  RiskLevel,
  TyposquatAssessment
} from "./types.js";
