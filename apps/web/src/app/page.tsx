import { ArrowUpRight } from "lucide-react";
import { CopyCommand } from "../components/copy-command";

export default function Page() {
  return (
    <main className="launch-shell">
      <section className="launch-panel" aria-labelledby="launch-title">
        <p className="kicker">Now live on npm</p>
        <h1 id="launch-title">Inspect before you run.</h1>
        <p className="launch-copy">
          betternpm catches malware, typosquats, and known vulnerabilities
          before an npm package ever executes — then hands off to npm.
        </p>

        <div className="command-stack" aria-label="Install commands">
          <CopyCommand command="npm i -g betternpm-cli" />
          <CopyCommand command="curl -fsSL https://betternpm.org/latest | sh" />
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
