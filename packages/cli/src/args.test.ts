import { describe, expect, it } from "vitest";
import { inferCommandName, parseCliArgs } from "./args.js";

describe("parseCliArgs", () => {
  it("parses inspect mode", () => {
    expect(parseCliArgs(["inspect", "create-next-app"])).toMatchObject({
      mode: "inspect",
      packageSpec: "create-next-app",
      commandArgs: []
    });
  });

  it("parses default run mode", () => {
    expect(parseCliArgs(["create-next-app@latest", "my-app"])).toMatchObject({
      mode: "run",
      packageSpec: "create-next-app@latest",
      commandArgs: ["create-next-app", "my-app"]
    });
  });

  it("parses package flag mode", () => {
    expect(parseCliArgs(["--package", "typescript", "--", "tsc", "--version"])).toMatchObject({
      mode: "run",
      packageSpec: "typescript",
      commandArgs: ["tsc", "--version"]
    });
  });

  it("keeps command flags after the package target", () => {
    expect(parseCliArgs(["create-next-app", "--help"])).toMatchObject({
      packageSpec: "create-next-app",
      commandArgs: ["create-next-app", "--help"],
      help: false
    });
  });

  it("parses config set commands", () => {
    expect(parseCliArgs(["config", "set", "minimumVersionAgeHours", "168"])).toMatchObject({
      mode: "config",
      configSet: "minimumVersionAgeHours",
      configValue: "168"
    });
  });

  it("parses force install and fresh audit separately", () => {
    expect(parseCliArgs(["--force-install", "--force-fresh-audit", "create-next-app"])).toMatchObject({
      packageSpec: "create-next-app",
      forceInstall: true,
      forceFreshAudit: true
    });
  });

  it("rejects ambiguous legacy force flag", () => {
    expect(() => parseCliArgs(["--force", "create-next-app"])).toThrow("Use --force-install");
  });

  it("parses provider, model, and dependency override flags", () => {
    expect(parseCliArgs(["--provider", "anthropic", "--model", "claude-opus-4-8", "--audit-deps", "create-next-app"])).toMatchObject({
      packageSpec: "create-next-app",
      providerOverride: "anthropic",
      modelOverride: "claude-opus-4-8",
      auditDependencies: true
    });
  });

  it("supports --flag=value form and a numeric max cost", () => {
    expect(parseCliArgs(["--api-key-env=MY_KEY", "--max-cost=0.5", "inspect", "react"])).toMatchObject({
      mode: "inspect",
      packageSpec: "react",
      apiKeyEnvOverride: "MY_KEY",
      maxCost: 0.5
    });
  });

  it("rejects a negative max cost", () => {
    expect(() => parseCliArgs(["--max-cost", "-1", "react"])).toThrow("--max-cost");
  });
});

describe("inferCommandName", () => {
  it("strips versions", () => {
    expect(inferCommandName("cowsay@latest")).toBe("cowsay");
  });

  it("uses the package segment for scoped packages", () => {
    expect(inferCommandName("@scope/tool@1.0.0")).toBe("tool");
  });
});
