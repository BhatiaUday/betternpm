import { describe, expect, it } from "vitest";
import { parsePackageSpec } from "./package-spec.js";

describe("parsePackageSpec", () => {
  it("parses unscoped package names", () => {
    expect(parsePackageSpec("create-next-app")).toEqual({
      raw: "create-next-app",
      name: "create-next-app"
    });
  });

  it("parses unscoped package versions", () => {
    expect(parsePackageSpec("typescript@latest")).toEqual({
      raw: "typescript@latest",
      name: "typescript",
      requestedVersion: "latest"
    });
  });

  it("parses scoped package names", () => {
    expect(parsePackageSpec("@modelcontextprotocol/server-filesystem")).toEqual({
      raw: "@modelcontextprotocol/server-filesystem",
      name: "@modelcontextprotocol/server-filesystem"
    });
  });

  it("parses scoped package versions", () => {
    expect(parsePackageSpec("@scope/pkg@1.2.3")).toEqual({
      raw: "@scope/pkg@1.2.3",
      name: "@scope/pkg",
      requestedVersion: "1.2.3"
    });
  });
});
