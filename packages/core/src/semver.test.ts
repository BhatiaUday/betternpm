import { describe, expect, it } from "vitest";
import { compareVersions, isParseableRange, maxSatisfying, parseVersion, satisfies } from "./semver.js";

describe("parseVersion", () => {
  it("parses plain and prefixed versions", () => {
    expect(parseVersion("1.2.3")).toMatchObject({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion("v2.0.0")).toMatchObject({ major: 2, minor: 0, patch: 0 });
    expect(parseVersion("=3.4.5")).toMatchObject({ major: 3, minor: 4, patch: 5 });
  });

  it("parses prerelease identifiers", () => {
    expect(parseVersion("1.0.0-beta.2")?.prerelease).toEqual(["beta", 2]);
  });

  it("returns undefined for non-versions", () => {
    expect(parseVersion("not-a-version")).toBeUndefined();
  });
});

describe("compareVersions", () => {
  it("orders by major, minor, patch", () => {
    expect(compareVersions(parseVersion("1.0.0")!, parseVersion("2.0.0")!)).toBe(-1);
    expect(compareVersions(parseVersion("1.2.0")!, parseVersion("1.1.9")!)).toBe(1);
  });

  it("ranks a release above its prerelease", () => {
    expect(compareVersions(parseVersion("1.0.0")!, parseVersion("1.0.0-rc.1")!)).toBe(1);
  });
});

describe("satisfies", () => {
  it("matches exact pins", () => {
    expect(satisfies("8.0.0", "8.0.0")).toBe(true);
    expect(satisfies("8.0.1", "8.0.0")).toBe(false);
  });

  it("matches caret ranges", () => {
    expect(satisfies("1.5.0", "^1.2.3")).toBe(true);
    expect(satisfies("2.0.0", "^1.2.3")).toBe(false);
    expect(satisfies("0.2.9", "^0.2.3")).toBe(true);
    expect(satisfies("0.3.0", "^0.2.3")).toBe(false);
  });

  it("matches tilde ranges", () => {
    expect(satisfies("2.1.9", "~2.1.1")).toBe(true);
    expect(satisfies("2.2.0", "~2.1.1")).toBe(false);
  });

  it("matches comparator and wildcard ranges", () => {
    expect(satisfies("3.4.0", ">=3.0.0")).toBe(true);
    expect(satisfies("1.0.0", "*")).toBe(true);
    expect(satisfies("1.5.2", "1.x")).toBe(true);
    expect(satisfies("2.0.0", "1.x")).toBe(false);
  });

  it("supports unions", () => {
    expect(satisfies("3.0.0", "^1.0.0 || ^3.0.0")).toBe(true);
    expect(satisfies("2.0.0", "^1.0.0 || ^3.0.0")).toBe(false);
  });

  it("excludes prereleases from ordinary ranges", () => {
    expect(satisfies("2.0.0-rc.1", "^1.0.0")).toBe(false);
  });
});

describe("maxSatisfying", () => {
  it("returns the highest matching version", () => {
    const versions = ["2.1.1", "2.1.5", "2.2.0", "3.0.0"];
    expect(maxSatisfying(versions, "~2.1.1")).toBe("2.1.5");
    expect(maxSatisfying(versions, "^2.0.0")).toBe("2.2.0");
    expect(maxSatisfying(versions, "8.0.0")).toBeUndefined();
  });
});

describe("isParseableRange", () => {
  it("recognises supported ranges", () => {
    expect(isParseableRange("^1.2.3")).toBe(true);
    expect(isParseableRange(">=1.0.0 <2.0.0")).toBe(true);
  });

  it("rejects unsupported range syntax", () => {
    expect(isParseableRange("https://example.com/pkg.tgz")).toBe(false);
    expect(isParseableRange("npm:other@^1.0.0")).toBe(false);
  });
});
