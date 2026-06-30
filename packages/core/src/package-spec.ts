import type { PackageSpec } from "./types.js";

export function parsePackageSpec(raw: string): PackageSpec {
  const spec = raw.trim();

  if (!spec) {
    throw new Error("Package spec is required.");
  }

  if (spec.startsWith("@")) {
    const slashIndex = spec.indexOf("/");

    if (slashIndex === -1) {
      throw new Error(`Invalid scoped package spec: ${raw}`);
    }

    const versionIndex = spec.indexOf("@", slashIndex + 1);

    if (versionIndex === -1) {
      return { raw: spec, name: spec };
    }

    return {
      raw: spec,
      name: spec.slice(0, versionIndex),
      requestedVersion: spec.slice(versionIndex + 1)
    };
  }

  const versionIndex = spec.lastIndexOf("@");

  if (versionIndex <= 0) {
    return { raw: spec, name: spec };
  }

  return {
    raw: spec,
    name: spec.slice(0, versionIndex),
    requestedVersion: spec.slice(versionIndex + 1)
  };
}

export function encodePackageName(name: string): string {
  return encodeURIComponent(name);
}
