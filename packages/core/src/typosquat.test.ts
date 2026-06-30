import { describe, expect, it } from "vitest";
import { damerauLevenshtein, detectTyposquat } from "./typosquat.js";

describe("damerauLevenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(damerauLevenshtein("lodash", "lodash")).toBe(0);
  });

  it("counts a single substitution as distance 1", () => {
    expect(damerauLevenshtein("react", "react".replace("t", "x"))).toBe(1);
  });

  it("counts an adjacent transposition as distance 1", () => {
    expect(damerauLevenshtein("ab", "ba")).toBe(1);
    expect(damerauLevenshtein("lodash", "lodahs")).toBe(1);
  });

  it("counts an insertion as distance 1", () => {
    expect(damerauLevenshtein("express", "expresss")).toBe(1);
  });
});

describe("detectTyposquat", () => {
  it("does not flag an exact popular package", () => {
    expect(detectTyposquat("lodash").suspected).toBe(false);
    expect(detectTyposquat("react").suspected).toBe(false);
    expect(detectTyposquat("create-next-app").suspected).toBe(false);
  });

  it("flags a one-edit transposition of a popular package", () => {
    const result = detectTyposquat("lodahs");
    expect(result.suspected).toBe(true);
    expect(result.nearest).toBe("lodash");
    expect(result.distance).toBe(1);
  });

  it("flags an extra-character squat", () => {
    const result = detectTyposquat("expresss");
    expect(result.suspected).toBe(true);
    expect(result.nearest).toBe("express");
  });

  it("flags a homoglyph disguise", () => {
    const result = detectTyposquat("l0dash");
    expect(result.suspected).toBe(true);
    expect(result.nearest).toBe("lodash");
  });

  it("does not flag an unrelated package name", () => {
    expect(detectTyposquat("my-cool-internal-tool").suspected).toBe(false);
    expect(detectTyposquat("acme-design-system").suspected).toBe(false);
  });

  it("does not flag very short names", () => {
    expect(detectTyposquat("ax").suspected).toBe(false);
  });

  it("treats a scoped package matching a popular bare name as safe", () => {
    expect(detectTyposquat("@my-org/lodash").suspected).toBe(false);
  });
});
