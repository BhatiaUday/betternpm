import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/" className="site-brand">betternpm</Link>
      <nav className="site-nav" aria-label="Primary">
        <Link href="/search">Search</Link>
        <Link href="/audit">Audit</Link>
        <Link href="/leaderboard">Leaderboard</Link>
        <a href="https://github.com/sponsors/BhatiaUday" rel="noreferrer" target="_blank">Sponsor</a>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>
        Bring your own key — it is sent only to run your audit and is never stored. Audit results are cached
        and shared publicly. Request IPs are logged.
      </p>
    </footer>
  );
}
