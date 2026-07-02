"use client";

import { useEffect, useState } from "react";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "https://api.betternpm.org").replace(/\/$/, "");

interface Stats {
  audits: number;
  packages: number;
  risky: number;
}

/** Small live social-proof strip: "162 audits · 158 packages · 3 flagged". */
export function LiveStats() {
  const [stats, setStats] = useState<Stats>();

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const response = await fetch(`${API_URL}/v1/stats`);

        if (!response.ok) {
          return;
        }

        const data = await response.json() as Stats;

        if (active && typeof data.audits === "number") {
          setStats(data);
        }
      } catch {
        // Stats are decorative — stay hidden on failure.
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  if (!stats || stats.audits === 0) {
    return null;
  }

  return (
    <p className="live-stats" aria-label="Live audit statistics">
      <span className="live-dot" aria-hidden="true" />
      {stats.audits.toLocaleString()} community audits · {stats.packages.toLocaleString()} packages
      {stats.risky > 0 && <> · {stats.risky.toLocaleString()} flagged risky</>}
    </p>
  );
}
