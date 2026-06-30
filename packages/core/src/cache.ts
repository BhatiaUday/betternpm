import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { SCANNER_PROFILE_VERSION, type InspectionTarget, type PackageInspection } from "./types.js";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface CacheEnvelope {
  createdAt: string;
  data: PackageInspection;
}

export function createInspectionCacheKey(input: {
  name: string;
  version: string;
  integrity?: string;
  target?: InspectionTarget;
}): string {
  const hash = createHash("sha256");
  hash.update(`${SCANNER_PROFILE_VERSION}:${input.target ?? "npx"}:${input.name}@${input.version}:${input.integrity ?? "no-integrity"}`);
  return hash.digest("hex");
}

export async function readInspectionCache(cacheKey: string): Promise<PackageInspection | undefined> {
  try {
    const raw = await readFile(cachePath(cacheKey), "utf8");
    const envelope = JSON.parse(raw) as CacheEnvelope;
    const ageMs = Date.now() - Date.parse(envelope.createdAt);

    if (!Number.isFinite(ageMs) || ageMs > CACHE_TTL_MS) {
      return undefined;
    }

    return {
      ...envelope.data,
      cacheHit: true
    };
  } catch {
    return undefined;
  }
}

export async function writeInspectionCache(inspection: PackageInspection): Promise<void> {
  await mkdir(cacheDir(), { recursive: true });
  const envelope: CacheEnvelope = {
    createdAt: new Date().toISOString(),
    data: {
      ...inspection,
      cacheHit: false
    }
  };

  await writeFile(cachePath(inspection.cacheKey), `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
}

function cacheDir(): string {
  if (process.env.BETTERNPM_CACHE_DIR) {
    return process.env.BETTERNPM_CACHE_DIR;
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "betternpm");
  }

  return join(homedir(), ".cache", "betternpm");
}

function cachePath(cacheKey: string): string {
  return join(cacheDir(), `${cacheKey}.json`);
}
