import type { Metadata } from "next";
import { PackageSearch } from "../../components/package-search";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://api.betternpm.org";

export const metadata: Metadata = {
  title: "Search packages | betternpm",
  description: "Search npm, see which packages have already been audited, and queue an AI security audit on any version with your own key."
};

export default function SearchPage() {
  return (
    <main className="audit-shell">
      <header className="audit-masthead">
        <p className="kicker">npm, but safer</p>
        <h1 className="audit-title">Search npm packages</h1>
        <p className="audit-sub">
          Search the npm registry or paste an npm link, see what&apos;s already been audited, pick a version, and
          queue an AI security audit with your own Anthropic or OpenAI key. Your key and handle stay in your browser.
        </p>
      </header>
      <PackageSearch apiUrl={API_URL} />
    </main>
  );
}
