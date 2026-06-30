import { createHash } from "node:crypto";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import type { Finding, FindingEvidence, NpmVersionMetadata, SourceScanSummary } from "./types.js";

const gunzipAsync = promisify(gunzip);
const MAX_FILES_TO_SCAN = 80;
const MAX_BYTES_PER_FILE = 128 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json"]);

const SUSPICIOUS_PATTERNS: Array<{
  code: string;
  title: string;
  severity: Finding["severity"];
  pattern: RegExp;
}> = [
  {
    code: "credential-token-reference",
    title: "Source references credential token names",
    severity: "high",
    pattern: /aws_access_key_id|github_token|npm_token/i
  },
  {
    code: "credential-path-reference",
    title: "Source references common credential paths",
    severity: "medium",
    pattern: /\.npmrc|\.env|id_rsa|id_ed25519|\.ssh/i
  },
  {
    code: "process-env-access",
    title: "Source reads environment variables",
    severity: "medium",
    pattern: /process\.env|Deno\.env|getenv\(/i
  },
  {
    code: "child-process-usage",
    title: "Source uses child process APIs",
    severity: "low",
    pattern: /child_process|spawn\(|exec\(|execSync\(|fork\(/i
  },
  {
    code: "dynamic-code-execution",
    title: "Source uses dynamic code execution",
    severity: "medium",
    pattern: /\beval\s*\(|new Function\s*\(|vm\.runIn/i
  },
  {
    code: "network-exfiltration-signal",
    title: "Source performs outbound network requests",
    severity: "medium",
    pattern: /fetch\s*\(|https?\.request\s*\(|XMLHttpRequest|axios\.|node-fetch/i
  }
];

export async function scanTarball(input: {
  tarballUrl: string;
  integrity?: string;
  repository?: NpmVersionMetadata["repository"];
  gitHead?: string;
}): Promise<SourceScanSummary> {
  try {
    const tarball = await downloadTarball(input.tarballUrl);

    if (input.integrity && input.integrity.startsWith("sha512-")) {
      const expected = input.integrity.slice("sha512-".length);
      const actual = createHash("sha512").update(tarball).digest("base64");

      if (actual !== expected) {
        return emptyScan(`Tarball integrity mismatch for ${input.tarballUrl}.`);
      }
    }

    const decompressed = await gunzipAsync(tarball);
    const findings = new Map<string, Finding>();
    const sourceBaseUrl = createSourceBaseUrl(input.repository, input.gitHead);
    let bytesScanned = 0;
    let filesScanned = 0;
    let skippedFiles = 0;

    for (const entry of iterateTarEntries(decompressed)) {
      if (!shouldScanEntry(entry.name)) {
        skippedFiles += 1;
        continue;
      }

      if (filesScanned >= MAX_FILES_TO_SCAN || bytesScanned >= MAX_TOTAL_BYTES) {
        skippedFiles += 1;
        continue;
      }

      const limitedBytes = entry.content.subarray(0, Math.min(entry.content.byteLength, MAX_BYTES_PER_FILE, MAX_TOTAL_BYTES - bytesScanned));
      const limited = limitedBytes.toString("utf8");
      const file = stripPackagePrefix(entry.name);
      bytesScanned += limitedBytes.byteLength;
      filesScanned += 1;

      for (const suspiciousPattern of SUSPICIOUS_PATTERNS) {
        if (suspiciousPattern.pattern.test(limited)) {
          addFinding(findings, {
            severity: suspiciousPattern.severity,
            code: suspiciousPattern.code,
            title: suspiciousPattern.title,
            file,
            sourceUrl: sourceBaseUrl ? `${sourceBaseUrl}/${file}` : undefined
          });
        }
      }

      if (shouldCheckObfuscation(file)) {
        for (const obfuscationFinding of detectObfuscation(limited)) {
          addFinding(findings, {
            ...obfuscationFinding,
            file,
            sourceUrl: sourceBaseUrl ? `${sourceBaseUrl}/${file}` : undefined
          });
        }
      }
    }

    return {
      scanned: true,
      filesScanned,
      bytesScanned,
      skippedFiles,
      findings: [...findings.values()]
    };
  } catch (error) {
    return emptyScan(error instanceof Error ? error.message : "Unable to scan tarball.");
  }
}

function detectObfuscation(content: string): Array<Pick<Finding, "code" | "severity" | "title">> {
  const findings: Array<Pick<Finding, "code" | "severity" | "title">> = [];
  const lines = content.split("\n");
  const longestLine = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const unicodeEscapeCount = (content.match(/\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/gi) ?? []).length;
  const base64BlobCount = (content.match(/["'`][A-Za-z0-9+/]{160,}={0,2}["'`]/g) ?? []).length;
  const identifierNoiseCount = (content.match(/_[0-9a-f]{5,}|\$[0-9a-f]{5,}/gi) ?? []).length;
  const lowNewlineDensity = content.length > 10_000 && lines.length < 12;

  if (longestLine > 4_000 || lowNewlineDensity) {
    findings.push({
      severity: "low",
      code: "obfuscated-long-lines",
      title: "Source appears bundled, minified, or packed into unusually long lines"
    });
  }

  if (unicodeEscapeCount > 40 || base64BlobCount > 2 || identifierNoiseCount > 30) {
    findings.push({
      severity: "high",
      code: "obfuscation-signals",
      title: "Source contains obfuscation-like encoding or generated identifier patterns"
    });
  }

  return findings;
}

function addFinding(findings: Map<string, Finding>, input: {
  severity: Finding["severity"];
  code: string;
  title: string;
  file: string;
  sourceUrl?: string;
}): void {
  const existing = findings.get(input.code);
  const evidence = appendEvidence(existing?.evidence ?? [], {
    file: input.file,
    sourceUrl: input.sourceUrl
  });

  findings.set(input.code, {
    severity: input.severity,
    code: input.code,
    title: input.title,
    detail: evidence.map((item) => item.file).join(", "),
    evidence
  });
}

function appendEvidence(existing: FindingEvidence[], next: FindingEvidence): FindingEvidence[] {
  if (existing.some((item) => item.file === next.file)) {
    return existing;
  }

  return [...existing, next].slice(0, 5);
}

async function downloadTarball(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "betternpm/0.0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Tarball download failed (${response.status}) for ${url}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function* iterateTarEntries(data: Buffer): Generator<{ name: string; content: Buffer }> {
  let offset = 0;

  while (offset + 512 <= data.byteLength) {
    const header = data.subarray(offset, offset + 512);

    if (header.every((byte) => byte === 0)) {
      break;
    }

    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(readString(header, 124, 12).trim() || "0", 8) || 0;
    const type = readString(header, 156, 1);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;

    if (contentEnd > data.byteLength) {
      break;
    }

    if (type === "0" || type === "") {
      yield {
        name: fullName,
        content: data.subarray(contentStart, contentEnd)
      };
    }

    offset = contentStart + Math.ceil(size / 512) * 512;
  }
}

function readString(data: Buffer, start: number, length: number): string {
  const bytes = data.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return (end === -1 ? bytes : bytes.subarray(0, end)).toString("utf8");
}

function shouldScanEntry(entry: string): boolean {
  if (entry.endsWith("/")) {
    return false;
  }

  const normalized = entry.toLowerCase();
  if (normalized.includes("/node_modules/") || normalized.includes("/test/") || normalized.includes("/tests/")) {
    return false;
  }

  return SOURCE_EXTENSIONS.has(extensionFor(normalized));
}

function shouldCheckObfuscation(entry: string): boolean {
  return extensionFor(entry.toLowerCase()) !== ".json";
}

function extensionFor(path: string): string {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(index);
}

function stripPackagePrefix(entry: string): string {
  return entry.replace(/^package\//, "");
}

function createSourceBaseUrl(repository: NpmVersionMetadata["repository"], gitHead: string | undefined): string | undefined {
  if (!gitHead) {
    return undefined;
  }

  const normalized = normalizeRepository(repository);

  if (!normalized) {
    return undefined;
  }

  const match = normalized.url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);

  if (!match) {
    return undefined;
  }

  return `https://github.com/${match[1]}/${match[2]}/blob/${gitHead}${normalized.directory ? `/${normalized.directory}` : ""}`;
}

function normalizeRepository(repository: NpmVersionMetadata["repository"]): { url: string; directory?: string } | undefined {
  const raw = typeof repository === "string" ? repository : repository?.url;

  if (!raw) {
    return undefined;
  }

  const url = raw
    .replace(/^git\+/, "")
    .replace(/^git:\/\/github\.com\//, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/[?#].*$/, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const directory = typeof repository === "string" ? undefined : repository?.directory?.replace(/^\/+|\/+$/g, "");

  return { url, directory };
}

function emptyScan(error: string): SourceScanSummary {
  return {
    scanned: false,
    filesScanned: 0,
    bytesScanned: 0,
    skippedFiles: 0,
    findings: [{
      severity: "info",
      code: "source-scan-unavailable",
      title: "Source scan unavailable",
      detail: error
    }],
    error
  };
}