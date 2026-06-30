import type { NpmVersionMetadata, SourceScanSummary } from "./types.js";

const MAX_FILES = 2_000;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 500;
const DEFAULT_READ_LIMIT = 6_000;
const MAX_READ_LIMIT = 20_000;
const DEFAULT_SEARCH_RESULTS = 40;
const MAX_SEARCH_RESULTS = 100;
const MAX_SEARCH_LINE_LENGTH = 240;

export interface WorkspaceFile {
  path: string;
  size: number;
}

export interface WorkspaceListResult {
  files: WorkspaceFile[];
  total: number;
  truncated: boolean;
}

export interface WorkspaceReadResult {
  path: string;
  size: number;
  encoding: "utf-8" | "binary";
  content: string;
  offset: number;
  truncated: boolean;
  error?: string;
}

export interface WorkspaceSearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface WorkspaceSearchResult {
  matches: WorkspaceSearchMatch[];
  filesSearched: number;
  truncated: boolean;
  error?: string;
}

export interface PackageWorkspace {
  fileCount: number;
  totalBytes: number;
  truncated: boolean;
  manifest(): Record<string, unknown> | undefined;
  listFiles(options?: { pattern?: string; limit?: number }): WorkspaceListResult;
  readFile(path: string, options?: { offset?: number; limit?: number }): WorkspaceReadResult;
  searchCode(query: string, options?: { isRegex?: boolean; maxResults?: number }): WorkspaceSearchResult;
  summary(): SourceScanSummary;
}

export async function createWorkspace(input: {
  tarballUrl: string;
  integrity?: string;
  repository?: NpmVersionMetadata["repository"];
  gitHead?: string;
}): Promise<PackageWorkspace> {
  const tarball = await downloadTarball(input.tarballUrl);
  await verifyIntegrity(tarball, input.integrity);
  const decompressed = await gunzip(tarball);

  const files = new Map<string, Uint8Array>();
  const paths: string[] = [];
  let totalBytes = 0;
  let skippedFiles = 0;
  let truncated = false;

  for (const entry of iterateTarEntries(decompressed)) {
    if (!shouldKeepEntry(entry.name)) {
      skippedFiles += 1;
      continue;
    }

    if (files.size >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) {
      truncated = true;
      skippedFiles += 1;
      continue;
    }

    const path = stripPackagePrefix(entry.name);
    const content = entry.content.byteLength > MAX_FILE_BYTES
      ? entry.content.slice(0, MAX_FILE_BYTES)
      : entry.content;

    if (!files.has(path)) {
      paths.push(path);
    }

    files.set(path, content);
    totalBytes += content.byteLength;
  }

  paths.sort((a, b) => a.localeCompare(b));

  return new TarballWorkspace(files, paths, totalBytes, skippedFiles, truncated);
}

class TarballWorkspace implements PackageWorkspace {
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly truncated: boolean;
  private readonly files: Map<string, Uint8Array>;
  private readonly paths: string[];
  private readonly skippedFiles: number;

  constructor(files: Map<string, Uint8Array>, paths: string[], totalBytes: number, skippedFiles: number, truncated: boolean) {
    this.files = files;
    this.paths = paths;
    this.totalBytes = totalBytes;
    this.skippedFiles = skippedFiles;
    this.truncated = truncated;
    this.fileCount = files.size;
  }

  manifest(): Record<string, unknown> | undefined {
    const raw = this.files.get("package.json");

    if (!raw) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(decodeText(raw)) as unknown;
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
    } catch {
      return undefined;
    }
  }

  listFiles(options: { pattern?: string; limit?: number } = {}): WorkspaceListResult {
    const limit = clamp(options.limit ?? DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
    const matcher = options.pattern ? buildMatcher(options.pattern) : undefined;
    const matched = matcher ? this.paths.filter((path) => matcher(path)) : this.paths;
    const files = matched.slice(0, limit).map((path) => ({
      path,
      size: this.files.get(path)?.byteLength ?? 0
    }));

    return {
      files,
      total: matched.length,
      truncated: matched.length > files.length
    };
  }

  readFile(path: string, options: { offset?: number; limit?: number } = {}): WorkspaceReadResult {
    const normalized = normalizePath(path);
    const raw = this.files.get(normalized);

    if (!raw) {
      return {
        path: normalized,
        size: 0,
        encoding: "utf-8",
        content: "",
        offset: 0,
        truncated: false,
        error: `File not found: ${normalized}. Use list_files to see available paths.`
      };
    }

    if (isBinary(raw)) {
      return {
        path: normalized,
        size: raw.byteLength,
        encoding: "binary",
        content: "",
        offset: 0,
        truncated: false,
        error: "Binary file; contents are not shown as text."
      };
    }

    const decoded = decodeText(raw);
    const offset = clamp(options.offset ?? 0, 0, decoded.length);
    const limit = clamp(options.limit ?? DEFAULT_READ_LIMIT, 1, MAX_READ_LIMIT);
    const content = decoded.slice(offset, offset + limit);

    return {
      path: normalized,
      size: decoded.length,
      encoding: "utf-8",
      content,
      offset,
      truncated: offset + content.length < decoded.length
    };
  }

  searchCode(query: string, options: { isRegex?: boolean; maxResults?: number } = {}): WorkspaceSearchResult {
    const maxResults = clamp(options.maxResults ?? DEFAULT_SEARCH_RESULTS, 1, MAX_SEARCH_RESULTS);
    const matches: WorkspaceSearchMatch[] = [];
    let filesSearched = 0;
    let regex: RegExp | undefined;

    if (options.isRegex) {
      try {
        regex = new RegExp(query, "i");
      } catch (error) {
        return {
          matches: [],
          filesSearched: 0,
          truncated: false,
          error: `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }

    const needle = query.toLowerCase();

    for (const path of this.paths) {
      const raw = this.files.get(path);

      if (!raw || isBinary(raw)) {
        continue;
      }

      filesSearched += 1;
      const lines = decodeText(raw).split("\n");

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const hit = regex ? regex.test(line) : line.toLowerCase().includes(needle);

        if (!hit) {
          continue;
        }

        matches.push({
          path,
          line: index + 1,
          text: line.trim().slice(0, MAX_SEARCH_LINE_LENGTH)
        });

        if (matches.length >= maxResults) {
          return { matches, filesSearched, truncated: true };
        }
      }
    }

    return { matches, filesSearched, truncated: false };
  }

  summary(): SourceScanSummary {
    return {
      scanned: true,
      filesScanned: this.fileCount,
      bytesScanned: this.totalBytes,
      skippedFiles: this.skippedFiles,
      findings: [],
      snippets: []
    };
  }
}

async function downloadTarball(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "betternpm-api/0.0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Tarball download failed (${response.status}) for ${url}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function verifyIntegrity(tarball: Uint8Array<ArrayBuffer>, integrity?: string): Promise<void> {
  if (!integrity?.startsWith("sha512-")) {
    return;
  }

  const expected = integrity.slice("sha512-".length);
  const digest = await crypto.subtle.digest("SHA-512", tarball);
  const actual = base64(new Uint8Array(digest));

  if (actual !== expected) {
    throw new Error("Tarball integrity mismatch against npm registry metadata.");
  }
}

async function gunzip(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function* iterateTarEntries(data: Uint8Array): Generator<{ name: string; content: Uint8Array }> {
  let offset = 0;

  while (offset + 512 <= data.byteLength) {
    const header = data.slice(offset, offset + 512);

    if (header.every((byte) => byte === 0)) {
      break;
    }

    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = parseInt(readString(header, 124, 12).trim() || "0", 8);
    const type = readString(header, 156, 1);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;

    if (type === "0" || type === "") {
      yield {
        name: fullName,
        content: data.slice(contentStart, contentEnd)
      };
    }

    offset = contentStart + Math.ceil(size / 512) * 512;
  }
}

function shouldKeepEntry(entry: string): boolean {
  if (entry.endsWith("/")) {
    return false;
  }

  return !entry.toLowerCase().includes("/node_modules/");
}

function stripPackagePrefix(entry: string): string {
  return entry.replace(/^package\//, "");
}

function normalizePath(path: string): string {
  return stripPackagePrefix(path.replace(/^\.\//, "").replace(/^\/+/, ""));
}

function buildMatcher(pattern: string): (path: string) => boolean {
  if (/[*?]/.test(pattern)) {
    const source = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^]*")
      .replace(/\?/g, ".");
    const regex = new RegExp(source, "i");
    return (path) => regex.test(path);
  }

  const needle = pattern.toLowerCase();
  return (path) => path.toLowerCase().includes(needle);
}

function isBinary(data: Uint8Array): boolean {
  const sampleLength = Math.min(data.byteLength, 1_024);

  for (let index = 0; index < sampleLength; index += 1) {
    if (data[index] === 0) {
      return true;
    }
  }

  return false;
}

function decodeText(data: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(data);
}

function readString(data: Uint8Array, start: number, length: number): string {
  const bytes = data.slice(start, start + length);
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end === -1 ? bytes : bytes.slice(0, end));
}

function base64(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}
