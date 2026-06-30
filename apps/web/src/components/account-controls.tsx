"use client";

import { LogOut, ShieldCheck } from "lucide-react";
import { useBrowserSettings } from "../lib/browser-settings";

function GithubMark({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.2 3.44 9.6 8.21 11.16.6.11.82-.25.82-.56 0-.28-.01-1.02-.02-2-3.34.71-4.04-1.58-4.04-1.58-.55-1.37-1.34-1.74-1.34-1.74-1.09-.73.08-.72.08-.72 1.2.08 1.84 1.21 1.84 1.21 1.07 1.8 2.81 1.28 3.5.98.11-.76.42-1.28.76-1.57-2.67-.3-5.47-1.31-5.47-5.83 0-1.29.47-2.34 1.23-3.17-.12-.3-.53-1.52.12-3.16 0 0 1-.32 3.3 1.21a11.5 11.5 0 0 1 6 0c2.28-1.53 3.29-1.21 3.29-1.21.65 1.64.24 2.86.12 3.16.77.83 1.23 1.88 1.23 3.17 0 4.53-2.81 5.52-5.49 5.81.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.28 0 .31.21.68.83.56A12.01 12.01 0 0 0 24 12.29C24 5.78 18.63.5 12 .5z" />
    </svg>
  );
}

// Leaderboard-handle control: when signed in with GitHub it shows the verified
// handle + sign-out; otherwise a free-text handle plus a "Sign in with GitHub" CTA.
export function AccountControls({ apiUrl }: { apiUrl: string }) {
  const { settings, signOut } = useBrowserSettings();
  const api = apiUrl.replace(/\/$/, "");

  if (settings.session) {
    return (
      <div className="field">
        <label>Leaderboard handle</label>
        <div className="account-signed">
          <span className="account-id">
            <GithubMark size={15} />
            @{settings.session.login}
            <span className="verified-tag"><ShieldCheck size={12} aria-hidden="true" /> verified</span>
          </span>
          <button type="button" className="link-button" onClick={() => signOut()}>
            <LogOut size={14} aria-hidden="true" /> Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field">
      <label>Leaderboard handle</label>
      <a className="github-button" href={`${api}/v1/auth/github/start`}>
        <GithubMark size={15} /> Sign in with GitHub to claim your handle
      </a>
      <p className="field-hint">
        Audits are credited to your verified GitHub username — handles can&apos;t be set
        manually. Sign in to appear on the <a href="/leaderboard">leaderboard</a>.
      </p>
    </div>
  );
}
