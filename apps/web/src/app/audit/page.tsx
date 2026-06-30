import type { Metadata } from "next";
import { AuditConsole } from "../../components/audit-console";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://api.betternpm.org";

export const metadata: Metadata = {
  title: "Audit a package | Better npm",
  description: "Run an AI security audit on any npm package with your own Anthropic or OpenAI key."
};

export default function AuditPage() {
  return (
    <main className="audit-shell">
      <header className="audit-masthead">
        <p className="kicker">community AI audits</p>
        <h1 className="audit-title">Audit an npm package</h1>
        <p className="audit-sub">
          Paste an npm link or a package name, choose a version, and run an AI security audit with your own
          Anthropic or OpenAI key. Results are cached and shared with the community.
        </p>
      </header>
      <AuditConsole apiUrl={API_URL} />
    </main>
  );
}
