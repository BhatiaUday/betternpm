import { ArrowUpRight } from "lucide-react";
import { CopyCommand } from "../components/copy-command";

export default function Page() {
  return (
    <main className="launch-shell">
      <section className="launch-panel" aria-labelledby="launch-title">
        <p className="kicker">Now live on npm</p>
        <h1 id="launch-title">Inspect before you run.</h1>
        <p className="launch-copy">
          betternpm inspects npm packages for typosquats, risky install scripts, and known
          vulnerabilities before they ever run — then hands off to npm.
        </p>

        <div className="command-stack" aria-label="Install commands">
          <CopyCommand command="npm i -g betternpm-cli" />
          <CopyCommand command="curl -fsSL https://betternpm.org/latest | sh" />
        </div>

        <div className="home-cta">
          <a className="home-cta-primary" href="/search">
            Search &amp; audit packages
            <ArrowUpRight size={18} aria-hidden="true" />
          </a>
          <p className="home-cta-note">
            No install needed — search any npm package in your browser and queue an AI audit with
            your own key. Sign in with GitHub to claim your handle on the <a href="/leaderboard">leaderboard</a>.
          </p>
        </div>

        <div className="link-row" aria-label="Project links">
          <a href="https://x.com/theo" rel="noreferrer" target="_blank">
            <span>inspired by</span>
            <strong>
              Theo
              <ArrowUpRight size={16} aria-hidden="true" />
            </strong>
          </a>
          <a href="https://github.com/BhatiaUday/betternpm" rel="noreferrer" target="_blank">
            <span>built by Uday Bhatia</span>
            <strong>
              GitHub
              <ArrowUpRight size={16} aria-hidden="true" />
            </strong>
          </a>
          <a href="https://github.com/sponsors/BhatiaUday" rel="noreferrer" target="_blank">
            <span>support the project</span>
            <strong>
              Sponsor
              <ArrowUpRight size={16} aria-hidden="true" />
            </strong>
          </a>
        </div>
      </section>
    </main>
  );
}
