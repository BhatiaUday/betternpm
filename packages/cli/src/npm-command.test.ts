import { describe, expect, it } from "vitest";
import { parseNpmInstallInspectionPlan } from "./npm-command.js";

describe("parseNpmInstallInspectionPlan", () => {
  it("detects direct install package specs", () => {
    expect(parseNpmInstallInspectionPlan(["install", "react", "@types/node@latest"])).toMatchObject({
      npmArgs: ["install", "react", "@types/node@latest"],
      packageSpecs: ["react", "@types/node@latest"]
    });
  });

  it("supports npm aliases and install flags", () => {
    expect(parseNpmInstallInspectionPlan(["i", "-D", "typescript", "--workspace", "apps/web"])).toMatchObject({
      packageSpecs: ["typescript"]
    });
  });

  it("passes through installs without direct registry specs", () => {
    expect(parseNpmInstallInspectionPlan(["install"])).toBeUndefined();
    expect(parseNpmInstallInspectionPlan(["install", "."])).toBeUndefined();
    expect(parseNpmInstallInspectionPlan(["install", "file:../local-package"])).toBeUndefined();
  });

  it("removes Better npm override flags before passing to npm", () => {
    expect(parseNpmInstallInspectionPlan(["--force-install", "--force-fresh-audit", "install", "cowsay"])).toMatchObject({
      npmArgs: ["install", "cowsay"],
      packageSpecs: ["cowsay"],
      forceInstall: true,
      forceFreshAudit: true
    });
  });

  it("strips provider/model/key overrides and keeps npm args intact", () => {
    expect(parseNpmInstallInspectionPlan(["--provider", "openai", "--model=gpt-5.5", "--audit-deps", "install", "-D", "left-pad"])).toMatchObject({
      npmArgs: ["install", "-D", "left-pad"],
      packageSpecs: ["left-pad"],
      providerOverride: "openai",
      modelOverride: "gpt-5.5",
      auditDependencies: true
    });
  });

  it("parses an inline max cost on the install path", () => {
    expect(parseNpmInstallInspectionPlan(["--max-cost", "1.25", "install", "react"])).toMatchObject({
      packageSpecs: ["react"],
      maxCost: 1.25
    });
  });

  it("ignores non-install npm commands", () => {
    expect(parseNpmInstallInspectionPlan(["run", "check"])).toBeUndefined();
    expect(parseNpmInstallInspectionPlan(["publish"])).toBeUndefined();
  });
});