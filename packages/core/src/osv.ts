import type { OsvVulnerability } from "./types.js";

const OSV_QUERY_URL = "https://api.osv.dev/v1/query";
const OSV_QUERYBATCH_URL = "https://api.osv.dev/v1/querybatch";

interface OsvResponse {
  vulns?: OsvVulnerability[];
}

interface OsvBatchResponse {
  results?: Array<{ vulns?: OsvVulnerability[] }>;
}

export interface OsvBatchQuery {
  name: string;
  version: string;
}

/**
 * Query OSV for many package versions in a single request. The querybatch endpoint
 * returns vulnerabilities (id + modified only) per query, in the same order. Results
 * are aligned positionally to the input queries.
 */
export async function queryOsvBatch(queries: OsvBatchQuery[]): Promise<OsvVulnerability[][]> {
  if (queries.length === 0) {
    return [];
  }

  const response = await fetch(OSV_QUERYBATCH_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "betternpm/0.0.1"
    },
    body: JSON.stringify({
      queries: queries.map((query) => ({
        version: query.version,
        package: { name: query.name, ecosystem: "npm" }
      }))
    })
  });

  if (!response.ok) {
    throw new Error(`OSV batch query failed (${response.status}).`);
  }

  const data = await response.json() as OsvBatchResponse;
  const results = data.results ?? [];

  return queries.map((_, index) => results[index]?.vulns ?? []);
}

export async function queryOsv(name: string, version: string): Promise<OsvVulnerability[]> {
  const response = await fetch(OSV_QUERY_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "betternpm/0.0.1"
    },
    body: JSON.stringify({
      version,
      package: {
        name,
        ecosystem: "npm"
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OSV query failed (${response.status}).`);
  }

  const data = await response.json() as OsvResponse;
  return data.vulns ?? [];
}
