"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Search, ShieldCheck, Trophy } from "lucide-react";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "https://api.betternpm.org").replace(/\/$/, "");

interface LeaderboardEntry {
  rank: number;
  username: string;
  totalCostUsd: number;
  totalAudits: number;
  verified: boolean;
}

interface SearchResult {
  packageName: string;
  version: string;
  target: string;
  provider: string;
  riskLevel: string;
  score: number;
  auditedAt: string;
}

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [boardStatus, setBoardStatus] = useState<"loading" | "idle" | "error">("loading");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "error">("idle");
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const response = await fetch(`${API_URL}/v1/leaderboard`);

        if (!response.ok) {
          throw new Error();
        }

        const data = await response.json() as { leaderboard?: LeaderboardEntry[] };

        if (active) {
          setEntries(data.leaderboard ?? []);
          setBoardStatus("idle");
        }
      } catch {
        if (active) {
          setBoardStatus("error");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const runSearch = useCallback(async () => {
    const trimmed = query.trim();

    if (trimmed.length < 2) {
      return;
    }

    setSearchStatus("loading");
    setSearched(true);

    try {
      const response = await fetch(`${API_URL}/v1/search?q=${encodeURIComponent(trimmed)}`);

      if (!response.ok) {
        throw new Error();
      }

      const data = await response.json() as { results?: SearchResult[] };
      setResults(data.results ?? []);
      setSearchStatus("idle");
    } catch {
      setSearchStatus("error");
    }
  }, [query]);

  return (
    <main className="board-shell">
      <header className="audit-masthead">
        <p className="kicker">community audits</p>
        <h1 className="audit-title">Leaderboard</h1>
        <p className="audit-sub">
          Top contributors by estimated audit spend. Sign in with GitHub on the{" "}
          <a href="/search">search</a> page, or run <code>betternpm login github</code> in the
          CLI, then run an audit to appear here.
        </p>
      </header>

      <section className="board-section">
        <h2 className="board-h"><Trophy size={18} aria-hidden="true" /> Top auditors</h2>
        {boardStatus === "loading"
          ? <p className="muted">Loading…</p>
          : boardStatus === "error"
            ? <p className="error-line">Could not load the leaderboard.</p>
            : entries.length === 0
              ? <p className="muted">No ranked auditors yet — set a username and run an audit to be the first.</p>
              : (
                <table className="board-table">
                  <thead>
                    <tr><th>#</th><th>Auditor</th><th>Audits</th><th>Est. spend</th></tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.username}>
                        <td className="rank">{entry.rank}</td>
                        <td>{entry.username}{entry.verified && <ShieldCheck className="lb-verified" size={14} aria-label="verified" />}</td>
                        <td>{entry.totalAudits}</td>
                        <td>${entry.totalCostUsd.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
      </section>

      <section className="board-section">
        <h2 className="board-h"><Search size={18} aria-hidden="true" /> Search audited packages</h2>
        <div className="input-row">
          <input
            className="text-input"
            placeholder="search a package name…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void runSearch();
              }
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <button type="button" className="ghost-button" onClick={() => void runSearch()} disabled={searchStatus === "loading"}>
            {searchStatus === "loading" ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
            <span>Search</span>
          </button>
        </div>

        {searchStatus === "error" && <p className="error-line">Search failed. Try again.</p>}
        {searched && searchStatus === "idle" && results.length === 0 && (
          <p className="muted">No cached audits match that name yet.</p>
        )}

        {results.length > 0 && (
          <div className="finding-list">
            {results.map((result, index) => (
              <a className="search-row" key={`${result.packageName}-${result.version}-${index}`} href={`/p/${result.packageName}/${result.version}`}>
                <span className={`severity severity-${result.riskLevel}`}>{result.riskLevel} {result.score}</span>
                <div>
                  <strong>{result.packageName}@{result.version}</strong>
                  <p>{result.target} · {result.provider} · {new Date(result.auditedAt).toLocaleDateString()}</p>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
