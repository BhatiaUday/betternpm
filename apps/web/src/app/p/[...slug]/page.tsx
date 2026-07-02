import type { Metadata } from "next";
import { PackagePermalink } from "../../../components/package-permalink";
import { parseSlug } from "../../../lib/package-slug";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "https://api.betternpm.org").replace(/\/$/, "");

interface AuditHistoryEntry {
  version: string;
  riskLevel: string;
  score: number;
  provider: string;
  model: string;
}

// Server-rendered metadata so shared /p links unfurl with the actual verdict
// ("left-pad@1.3.0 — low 92") on X/HN/Slack. The interactive page stays client-side.
export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }): Promise<Metadata> {
  const { slug } = await params;
  const { name, version } = parseSlug(slug ?? []);

  if (!name) {
    return { title: "Package audit | betternpm" };
  }

  const base = `${name}${version ? `@${version}` : ""}`;

  try {
    const response = await fetch(`${API_URL}/v1/packages/${name}/audits`, { next: { revalidate: 300 } });

    if (response.ok) {
      const data = await response.json() as { audits?: AuditHistoryEntry[] };
      const audits = data.audits ?? [];
      const entry = (version ? audits.find((audit) => audit.version === version) : audits[0]) ?? audits[0];

      if (entry) {
        const title = `${name}@${entry.version} — ${entry.riskLevel} ${entry.score} | betternpm audit`;
        const description = `Community security audit for ${name}@${entry.version}: risk ${entry.riskLevel} (${entry.score}/100), audited with ${entry.provider} · ${entry.model}. Inspect npm packages before they run.`;
        return {
          title,
          description,
          openGraph: { title, description, type: "article", siteName: "betternpm" }
        };
      }
    }
  } catch {
    // Fall through to the generic title on any metadata fetch failure.
  }

  return {
    title: `${base} audit | betternpm`,
    description: `Security audit status and history for the npm package ${base} on betternpm.`
  };
}

export default function PackagePermalinkPage() {
  return <PackagePermalink />;
}
