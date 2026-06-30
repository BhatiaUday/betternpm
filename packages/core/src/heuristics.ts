import type { Finding, InspectionTarget, PackageFacts, RiskAssessment } from "./types.js";

export interface AssessRiskOptions {
  target?: InspectionTarget;
}

const INSTALL_SCRIPT_NAMES = new Set([
  "preinstall",
  "install",
  "postinstall"
]);

const NON_INSTALL_LIFECYCLE_SCRIPT_NAMES = new Set([
  "prepublish",
  "prepublishOnly",
  "prepare"
]);

export function assessRisk(facts: PackageFacts, options: AssessRiskOptions = {}): RiskAssessment {
  const target = options.target ?? "npx";
  const findings: Finding[] = [];

  if (facts.sourceScan?.findings.length) {
    findings.push(...facts.sourceScan.findings);
  }

  if (facts.vulnerabilities.length > 0) {
    findings.push({
      severity: "blocked",
      code: "known-vulnerabilities",
      title: "Known vulnerabilities found in OSV",
      detail: facts.vulnerabilities.slice(0, 3).map((vuln) => vuln.id).join(", ")
    });
  }

  if (facts.typosquat?.suspected) {
    findings.push({
      severity: "high",
      code: "possible-typosquat",
      title: "Package name resembles a popular package",
      detail: facts.typosquat.reason
        ?? (facts.typosquat.nearest ? `Closest popular package: ${facts.typosquat.nearest}.` : undefined)
    });
  }

  if (facts.dependencyAudit?.scanned) {
    const vulnerableDeps = facts.dependencyAudit.entries.filter((entry) => entry.vulnerabilities.length > 0);
    if (vulnerableDeps.length > 0) {
      findings.push({
        severity: "high",
        code: "vulnerable-dependency",
        title: "Direct dependencies have known vulnerabilities",
        detail: vulnerableDeps
          .slice(0, 5)
          .map((entry) => `${entry.name}@${entry.resolvedVersion ?? entry.range}`)
          .join(", ")
      });
    }

    const typosquatDeps = facts.dependencyAudit.entries.filter((entry) => entry.typosquat?.suspected);
    if (typosquatDeps.length > 0) {
      findings.push({
        severity: "medium",
        code: "typosquat-dependency",
        title: "A direct dependency name resembles a popular package",
        detail: typosquatDeps
          .slice(0, 5)
          .map((entry) => `${entry.name} ≈ ${entry.typosquat?.nearest ?? "?"}`)
          .join(", ")
      });
    }
  }

  const installScripts = Object.keys(facts.scripts).filter((name) => INSTALL_SCRIPT_NAMES.has(name));
  if (installScripts.length > 0) {
    findings.push({
      severity: "high",
      code: "install-lifecycle-scripts",
      title: "Package defines install lifecycle scripts",
      detail: installScripts.join(", ")
    });
  }

  const nonInstallLifecycleScripts = Object.keys(facts.scripts).filter((name) => NON_INSTALL_LIFECYCLE_SCRIPT_NAMES.has(name));
  if (nonInstallLifecycleScripts.length > 0) {
    findings.push({
      severity: "info",
      code: "non-install-lifecycle-scripts",
      title: "Package includes non-install lifecycle scripts",
      detail: nonInstallLifecycleScripts.join(", ")
    });
  }

  if (target === "npx" && (!facts.bin || (typeof facts.bin === "object" && Object.keys(facts.bin).length === 0))) {
    findings.push({
      severity: "medium",
      code: "missing-bin",
      title: "No executable bin is declared",
      detail: "This may not be intended for npx-style execution."
    });
  }

  const publishedAgeHours = facts.publishedAt ? hoursSince(facts.publishedAt) : undefined;
  const minimumAgeHours = facts.agePolicy?.minimumAgeHours;
  if (
    minimumAgeHours !== undefined
    && facts.agePolicy?.resolvedAgeHours !== undefined
    && facts.agePolicy.resolvedAgeHours < minimumAgeHours
  ) {
    findings.push({
      severity: facts.agePolicy.resolvedAgeHours < 6 ? "high" : "medium",
      code: "below-configured-min-age",
      title: "Resolved version is newer than your configured minimum age",
      detail: formatAgePolicyDetail(facts.agePolicy)
    });
  }

  if (publishedAgeHours !== undefined && publishedAgeHours < 6) {
    findings.push({
      severity: "high",
      code: "very-new-release",
      title: "Release is less than 6 hours old",
      detail: `Published ${publishedAgeHours.toFixed(1)} hours ago.`
    });
  } else if (publishedAgeHours !== undefined && publishedAgeHours < 24) {
    findings.push({
      severity: "medium",
      code: "new-release",
      title: "Release is less than 24 hours old",
      detail: `Published ${publishedAgeHours.toFixed(1)} hours ago.`
    });
  }

  if (facts.downloads.weekly !== undefined && facts.downloads.weekly < 100) {
    findings.push({
      severity: "medium",
      code: "low-downloads",
      title: "Package has low weekly downloads",
      detail: `${facts.downloads.weekly.toLocaleString()} downloads in the last week.`
    });
  }

  if (facts.runtimeDependencyCount > 75) {
    findings.push({
      severity: "medium",
      code: "large-dependency-graph",
      title: "Large runtime dependency graph",
      detail: `${facts.runtimeDependencyCount} runtime dependencies.`
    });
  }

  if (!facts.license) {
    findings.push({ severity: "low", code: "missing-license", title: "No license metadata found" });
  }

  if (!facts.repository) {
    findings.push({ severity: "low", code: "missing-repository", title: "No repository metadata found" });
  }

  if (facts.maintainers.length === 0) {
    findings.push({ severity: "low", code: "missing-maintainers", title: "No maintainer metadata found" });
  }

  if (facts.downloads.error) {
    findings.push({
      severity: "info",
      code: "downloads-unavailable",
      title: "Download count unavailable",
      detail: facts.downloads.error
    });
  }

  return scoreFindings(findings);
}

function formatAgePolicyDetail(agePolicy: NonNullable<PackageFacts["agePolicy"]>): string {
  const ageText = agePolicy.resolvedAgeHours === undefined
    ? "unknown age"
    : `${agePolicy.resolvedAgeHours.toFixed(1)} hours old`;
  const recommendation = agePolicy.recommendedOlderVersion
    ? ` Recommended older version: ${agePolicy.recommendedOlderVersion.version} (${agePolicy.recommendedOlderVersion.ageHours.toFixed(1)} hours old).`
    : " No older version satisfying the age policy was found.";

  return `Current version is ${ageText}; minimum is ${agePolicy.minimumAgeHours} hours.${recommendation}`;
}

function scoreFindings(findings: Finding[]): RiskAssessment {
  if (findings.some((finding) => finding.severity === "blocked")) {
    return { level: "blocked", score: 0, findings };
  }

  const score = Math.max(
    0,
    100 - findings.reduce((total, finding) => total + penaltyFor(finding.severity), 0)
  );

  if (score < 65 || findings.some((finding) => finding.severity === "high")) {
    return { level: "high", score, findings };
  }

  if (score < 85 || findings.some((finding) => finding.severity === "medium")) {
    return { level: "medium", score, findings };
  }

  return { level: "low", score, findings };
}

function penaltyFor(severity: Finding["severity"]): number {
  switch (severity) {
    case "high":
      return 30;
    case "medium":
      return 15;
    case "low":
      return 5;
    case "info":
      return 0;
    case "blocked":
      return 100;
  }
}

function hoursSince(date: string): number | undefined {
  const timestamp = Date.parse(date);

  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  return (Date.now() - timestamp) / (1000 * 60 * 60);
}
