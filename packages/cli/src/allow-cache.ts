import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PackageInspection } from "betternpm-core";

interface AllowRecord {
  packageName: string;
  version: string;
  integrity?: string;
  scannerProfile: string;
  riskLevel: string;
  score: number;
  allowedAt: string;
}

export async function readAllowRecord(inspection: PackageInspection): Promise<AllowRecord | undefined> {
  try {
    const raw = await readFile(allowPath(inspection), "utf8");
    return JSON.parse(raw) as AllowRecord;
  } catch {
    return undefined;
  }
}

export async function writeAllowRecord(inspection: PackageInspection): Promise<void> {
  await mkdir(allowDir(), { recursive: true });
  const record: AllowRecord = {
    packageName: inspection.facts.name,
    version: inspection.facts.version,
    integrity: inspection.facts.integrity,
    scannerProfile: inspection.scannerProfile,
    riskLevel: inspection.risk.level,
    score: inspection.risk.score,
    allowedAt: new Date().toISOString()
  };

  await writeFile(allowPath(inspection), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function allowPath(inspection: PackageInspection): string {
  return join(allowDir(), `${allowKey(inspection)}.json`);
}

function allowKey(inspection: PackageInspection): string {
  const hash = createHash("sha256");
  hash.update([
    inspection.scannerProfile,
    inspection.facts.name,
    inspection.facts.version,
    inspection.facts.integrity ?? "no-integrity",
    inspection.risk.level,
    String(inspection.risk.score)
  ].join("\u001f"));
  return hash.digest("hex");
}

function allowDir(): string {
  if (process.env.BETTERNPM_ALLOW_DIR) {
    return process.env.BETTERNPM_ALLOW_DIR;
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "betternpm", "allowed");
  }

  return join(homedir(), ".cache", "betternpm", "allowed");
}
