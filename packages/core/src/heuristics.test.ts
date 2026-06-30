import { describe, expect, it } from "vitest";
import { assessRisk } from "./heuristics.js";
import type { PackageFacts } from "./types.js";

const baseFacts: PackageFacts = {
  requested: "safe-tool",
  name: "safe-tool",
  version: "1.0.0",
  license: "MIT",
  repository: "https://github.com/example/safe-tool",
  maintainers: [{ name: "maintainer" }],
  dependencyCount: 1,
  runtimeDependencyCount: 1,
  scripts: {},
  bin: { "safe-tool": "cli.js" },
  downloads: { weekly: 10_000 },
  vulnerabilities: [],
  sourceScan: {
    scanned: false,
    filesScanned: 0,
    bytesScanned: 0,
    skippedFiles: 0,
    findings: []
  }
};

describe("assessRisk", () => {
  it("marks a normal executable package as low risk", () => {
    expect(assessRisk(baseFacts).level).toBe("low");
  });

  it("does not require a bin for npm install audits", () => {
    const result = assessRisk({
      ...baseFacts,
      bin: undefined
    }, { target: "npm-install" });

    expect(result.level).toBe("low");
    expect(result.findings.some((finding) => finding.code === "missing-bin")).toBe(false);
  });

  it("blocks packages with known vulnerabilities", () => {
    const result = assessRisk({
      ...baseFacts,
      vulnerabilities: [{ id: "GHSA-test" }]
    });

    expect(result.level).toBe("blocked");
    expect(result.score).toBe(0);
  });

  it("flags lifecycle scripts as high risk", () => {
    const result = assessRisk({
      ...baseFacts,
      scripts: { postinstall: "node install.js" }
    });

    expect(result.level).toBe("high");
    expect(result.findings.some((finding) => finding.code === "install-lifecycle-scripts")).toBe(true);
  });

  it("does not treat publish-only lifecycle scripts as high risk", () => {
    const result = assessRisk({
      ...baseFacts,
      scripts: { prepublishOnly: "node build.js" }
    });

    expect(result.level).toBe("low");
    expect(result.findings.some((finding) => finding.code === "non-install-lifecycle-scripts")).toBe(true);
  });

  it("flags versions below the configured minimum age", () => {
    const result = assessRisk({
      ...baseFacts,
      publishedAt: new Date().toISOString(),
      agePolicy: {
        minimumAgeHours: 168,
        resolvedAgeHours: 1,
        recommendedOlderVersion: {
          version: "0.9.0",
          publishedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
          ageHours: 240
        }
      }
    });

    expect(result.level).toBe("high");
    expect(result.findings.some((finding) => finding.code === "below-configured-min-age")).toBe(true);
  });

  it("flags a suspected typosquat as high risk", () => {
    const result = assessRisk({
      ...baseFacts,
      name: "lodahs",
      typosquat: {
        suspected: true,
        candidate: "lodahs",
        nearest: "lodash",
        distance: 1,
        reason: "Differs from the popular package \"lodash\" by 1 character."
      }
    });

    expect(result.level).toBe("high");
    expect(result.findings.some((finding) => finding.code === "possible-typosquat")).toBe(true);
  });

  it("flags packages whose direct dependencies have known vulnerabilities", () => {
    const result = assessRisk({
      ...baseFacts,
      dependencyAudit: {
        scanned: true,
        depth: 1,
        directDependencyCount: 1,
        auditedCount: 1,
        truncated: false,
        entries: [
          {
            name: "bad-dep",
            range: "^1.0.0",
            resolvedVersion: "1.2.3",
            riskLevel: "blocked",
            vulnerabilities: [{ id: "GHSA-dep" }]
          }
        ]
      }
    });

    expect(result.level).toBe("high");
    expect(result.findings.some((finding) => finding.code === "vulnerable-dependency")).toBe(true);
  });
});
