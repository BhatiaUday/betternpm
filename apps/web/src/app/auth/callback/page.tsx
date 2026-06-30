"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { saveSession } from "../../../lib/browser-settings";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = params.get("token");
    const login = params.get("login");

    if (token && login) {
      saveSession({ token, login });
      window.history.replaceState(null, "", "/auth/callback");
      router.replace("/search");
      return;
    }

    setError(params.get("message") ?? "Sign-in failed. Please try again.");
  }, [router]);

  return (
    <main className="audit-shell">
      <header className="audit-masthead">
        <p className="kicker">github</p>
        <h1 className="audit-title">{error ? "Sign-in failed" : "Signing you in…"}</h1>
        <p className="audit-sub">{error ?? "One moment while we finish connecting your GitHub account."}</p>
      </header>
      {error && <a className="github-button" href="/search">Back to search</a>}
    </main>
  );
}
