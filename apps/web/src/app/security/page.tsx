import type { Metadata } from "next";
import { ShieldCheck, ShieldAlert } from "lucide-react";

export const metadata: Metadata = {
  title: "Security model | betternpm",
  description:
    "Exactly what betternpm checks, how BYOK AI audits work, what we store, and what we don't protect against yet."
};

export default function SecurityPage() {
  return (
    <main className="audit-shell">
      <header className="audit-masthead">
        <p className="kicker">honesty first</p>
        <h1 className="audit-title">Security model</h1>
        <p className="audit-sub">
          Exactly what betternpm checks, how it checks it, and — just as important — what it does
          not protect against yet.
        </p>
      </header>

      <section className="security-section">
        <h2><ShieldCheck size={18} aria-hidden="true" /> What the free inspection does</h2>
        <p>
          Every <code>betternpx</code> / <code>betternpm install</code> run inspects the package{" "}
          <strong>before anything executes</strong>, using deterministic checks that run locally:
        </p>
        <ul>
          <li>
            <strong>Known vulnerabilities</strong> — queries{" "}
            <a href="https://osv.dev" rel="noreferrer" target="_blank">OSV.dev</a> for the exact
            package@version. Hits are <em>blocking</em> (override requires{" "}
            <code>--force-install</code>).
          </li>
          <li>
            <strong>Typosquat detection</strong> — Damerau-Levenshtein edit distance plus
            homoglyph normalization (<code>l0dash</code>, <code>rеact</code> with a Cyrillic е)
            against a curated list of ~200 popular packages.
          </li>
          <li>
            <strong>Install scripts</strong> — any <code>preinstall</code> / <code>install</code> /{" "}
            <code>postinstall</code> is flagged high severity; these run arbitrary code at install
            time and are the most common supply-chain attack vector.
          </li>
          <li>
            <strong>Source scan</strong> — downloads the tarball (verifying its registry
            integrity hash), then scans contents for credential/token references
            (<code>.npmrc</code>, <code>.ssh</code>, <code>.env</code>), environment harvesting,{" "}
            <code>child_process</code>, dynamic code (<code>eval</code>, <code>new Function</code>),
            outbound network calls, and obfuscation signals.
          </li>
          <li>
            <strong>Metadata checks</strong> — package age (very new versions are risky),
            download counts, missing repository/license, and optional direct-dependency auditing
            (<code>--audit-deps</code>).
          </li>
        </ul>
        <p>
          The inspected tarball is <strong>never executed</strong>. After you approve, execution is
          delegated to the standard <code>npm exec</code> / <code>npm install</code> — betternpm
          adds a decision point, it does not replace npm.
        </p>
      </section>

      <section className="security-section">
        <h2><ShieldCheck size={18} aria-hidden="true" /> How AI audits work (BYOK)</h2>
        <ul>
          <li>
            AI audits are <strong>bring-your-own-key</strong>: your Anthropic or OpenAI key is sent
            over HTTPS only to run your audit, relayed to the provider, and{" "}
            <strong>never stored</strong> — not in the database, not in logs. It exists only in the
            in-flight request and the queue message that processes it.
          </li>
          <li>
            The audit server independently downloads the tarball, verifies its integrity hash
            against the npm registry, and lets the model explore the real package contents with
            read-only tools: <code>list_files</code>, <code>read_file</code>, <code>search_code</code>,{" "}
            <code>decode_strings</code> (decodes base64/hex payloads), and{" "}
            <code>diff_previous_version</code> (compares against the previous release — where
            malicious code usually arrives).
          </li>
          <li>
            Coverage is enforced mechanically: the agent&apos;s verdict is <strong>rejected</strong>{" "}
            until it has read every install-script file, bin entrypoint, and the main entry. The
            full investigation transcript is stored with each audit and viewable on the package page.
          </li>
          <li>
            Verdicts are <strong>floored by deterministic facts</strong>: a package with known OSV
            vulnerabilities cannot be rated low by an enthusiastic model.
          </li>
          <li>
            Results are cached and shared publicly by exact{" "}
            <code>package @ version + integrity + scanner profile + provider + model</code>, so one
            person&apos;s audit benefits everyone. Some demo audits are seeded by the platform
            operator and labeled with their provider/model like any other audit.
          </li>
          <li>
            Audits are attributed only to <strong>verified GitHub identities</strong> — handles
            cannot be free-texted, so leaderboard credit cannot be impersonated.
          </li>
        </ul>
      </section>

      <section className="security-section">
        <h2>What we store</h2>
        <ul>
          <li>Audit results (package identity, risk verdict, findings) — public by design.</li>
          <li>Request IPs on audit requests, for abuse control. Never shown publicly.</li>
          <li>If you sign in: your GitHub login and id. Nothing else from your account.</li>
          <li>
            In your browser / on your machine: provider choice, BYOK keys, and session tokens stay
            in localStorage / <code>~/.config/betternpm</code> (chmod 600). They never touch our
            database.
          </li>
        </ul>
      </section>

      <section className="security-section security-limits">
        <h2><ShieldAlert size={18} aria-hidden="true" /> What we do not protect against (yet)</h2>
        <ul>
          <li>
            <strong>Novel, well-hidden malware.</strong> Heuristics are patterns and AI review is
            probabilistic — a determined attacker can evade both. A low-risk verdict is evidence,
            not proof.
          </li>
          <li>
            <strong>Transitive dependencies.</strong> Only the target package (and, with{" "}
            <code>--audit-deps</code>, its direct dependencies) are inspected — not the full tree.
          </li>
          <li>
            <strong>Runtime behavior.</strong> We analyze statically; we do not sandbox or trace
            execution. Behavior that only appears at runtime (time bombs, C2 triggers) can pass.
          </li>
          <li>
            <strong>Compromised maintainers publishing plausible code.</strong> If malicious code
            looks like ordinary code, static review may miss it.
          </li>
          <li>
            <strong>Typosquats of niche packages.</strong> The popular-package list catches attacks
            on well-known names; imitations of small packages may not be flagged.
          </li>
          <li>
            <strong>Model mistakes.</strong> AI verdicts can be wrong in both directions — for
            example, heavily minified (but legitimate) packages have been rated risky. Findings
            link to the evidence so you can judge for yourself.
          </li>
        </ul>
        <p>
          Treat betternpm as a fast, evidence-gathering first line — not a guarantee. For
          high-stakes code, read the source.
        </p>
      </section>

      <section className="security-section">
        <h2>Report a vulnerability</h2>
        <p>
          Found a security issue in betternpm itself? Open a{" "}
          <a href="https://github.com/BhatiaUday/betternpm/security/advisories/new" rel="noreferrer" target="_blank">
            private security advisory
          </a>{" "}
          on GitHub. The CLI and audit pipeline are{" "}
          <a href="https://github.com/BhatiaUday/betternpm" rel="noreferrer" target="_blank">open source</a>{" "}
          — audit the auditor.
        </p>
      </section>
    </main>
  );
}
