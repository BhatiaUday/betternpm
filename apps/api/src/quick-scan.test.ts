import { describe, expect, it } from "vitest";
import { assessLocalRisk, damerauLevenshtein, detectTyposquat, renderBadgeSvg } from "./quick-scan.js";
import type { PackageFacts } from "./types.js";

function baseFacts(overrides: Partial<PackageFacts> = {}): PackageFacts {
  return {
    requested: "example-pkg",
    name: "example-pkg",
    version: "1.0.0",
    repository: "https://github.com/example/example-pkg",
    publishedAt: new Date(Date.now() - 90 * 24 * 3_600_000).toISOString(),
    maintainers: [],
    dependencyCount: 0,
    runtimeDependencyCount: 0,
    scripts: {},
    downloads: { weekly: 1_000_000 },
    vulnerabilities: [],
    ...overrides
  };
}

describe("damerauLevenshtein", () => {
  it("counts substitutions, insertions, and transpositions", () => {
    expect(damerauLevenshtein("lodash", "lodash")).toBe(0);
    expect(damerauLevenshtein("lodash", "l0dash")).toBe(1);
    expect(damerauLevenshtein("react", "raect")).toBe(1);
    expect(damerauLevenshtein("express", "expresss")).toBe(1);
  });
});

describe("detectTyposquat", () => {
  it("does not flag exact popular names", () => {
    expect(detectTyposquat("react").suspected).toBe(false);
    expect(detectTyposquat("lodash").suspected).toBe(false);
  });

  it("flags homoglyph disguises", () => {
    const result = detectTyposquat("l0dash");
    expect(result.suspected).toBe(true);
    expect(result.nearest).toBe("lodash");
  });

  it("flags distance-1 lookalikes", () => {
    const result = detectTyposquat("expresss");
    expect(result.suspected).toBe(true);
    expect(result.nearest).toBe("express");
  });

  it("leaves unrelated names alone", () => {
    expect(detectTyposquat("betternpm-core").suspected).toBe(false);
  });
});

describe("assessLocalRisk", () => {
  it("returns low with no signals", () => {
    const risk = assessLocalRisk(baseFacts(), "example-pkg");
    expect(risk.level).toBe("low");
    expect(risk.score).toBeGreaterThanOrEqual(90);
    expect(risk.findings).toHaveLength(0);
  });

  it("blocks on OSV vulnerabilities", () => {
    const risk = assessLocalRisk(baseFacts({ vulnerabilities: [{ id: "GHSA-test" }] }), "example-pkg");
    expect(risk.level).toBe("blocked");
    expect(risk.score).toBeLessThanOrEqual(40);
  });

  it("flags install lifecycle scripts as high", () => {
    const risk = assessLocalRisk(baseFacts({ scripts: { postinstall: "node setup.js" } }), "example-pkg");
    expect(risk.level).toBe("high");
    expect(risk.findings.some((finding) => finding.code === "install-script")).toBe(true);
  });

  it("flags typosquat names as high", () => {
    const risk = assessLocalRisk(baseFacts({ name: "l0dash" }), "l0dash");
    expect(risk.level).toBe("high");
    expect(risk.findings.some((finding) => finding.title.includes("resembles"))).toBe(true);
  });

  it("flags very new versions", () => {
    const risk = assessLocalRisk(baseFacts({ publishedAt: new Date(Date.now() - 3_600_000).toISOString() }), "example-pkg");
    expect(risk.findings.some((finding) => finding.title.includes("recently"))).toBe(true);
    expect(risk.level).toBe("high");
  });
});

describe("renderBadgeSvg", () => {
  it("renders the verdict", () => {
    const svg = renderBadgeSvg({ riskLevel: "low", score: 92 });
    expect(svg).toContain("low 92");
    expect(svg).toContain("betternpm");
    expect(svg).toContain("<svg");
  });

  it("renders not-audited when no status", () => {
    expect(renderBadgeSvg(undefined)).toContain("not audited");
  });
});
