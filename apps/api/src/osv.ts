import type { OsvVulnerability } from "./types.js";

const OSV_QUERY_URL = "https://api.osv.dev/v1/query";

interface OsvResponse {
  vulns?: OsvVulnerability[];
}

export async function queryOsv(name: string, version: string): Promise<OsvVulnerability[]> {
  const response = await fetch(OSV_QUERY_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "betternpm-api/0.0.1"
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
