"use client";

import { useCallback, useEffect, useState } from "react";

export type Provider = "anthropic" | "openai";

export interface BrowserSettings {
  provider: Provider;
  username: string;
  keys: Record<Provider, string>;
}

const STORAGE_KEY = "betternpm.settings.v1";

const DEFAULT_SETTINGS: BrowserSettings = {
  provider: "anthropic",
  username: "",
  keys: { anthropic: "", openai: "" }
};

export function loadSettings(): BrowserSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return DEFAULT_SETTINGS;
    }

    const parsed = JSON.parse(raw) as Partial<BrowserSettings> & { keys?: Partial<Record<Provider, string>> };

    return {
      provider: parsed.provider === "openai" ? "openai" : "anthropic",
      username: typeof parsed.username === "string" ? parsed.username : "",
      keys: {
        anthropic: typeof parsed.keys?.anthropic === "string" ? parsed.keys.anthropic : "",
        openai: typeof parsed.keys?.openai === "string" ? parsed.keys.openai : ""
      }
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persist(settings: BrowserSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota / availability errors — settings are best-effort.
  }
}

/**
 * Browser-local audit settings (provider, leaderboard handle, BYOK keys). Persisted
 * to localStorage so the key never leaves the browser except to run an audit. Hydrates
 * after mount to avoid SSR/client mismatch.
 */
export function useBrowserSettings() {
  const [settings, setSettings] = useState<BrowserSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
    setHydrated(true);
  }, []);

  const setProvider = useCallback((provider: Provider) => {
    setSettings((prev) => {
      const next = { ...prev, provider };
      persist(next);
      return next;
    });
  }, []);

  const setUsername = useCallback((username: string) => {
    setSettings((prev) => {
      const next = { ...prev, username };
      persist(next);
      return next;
    });
  }, []);

  const setKey = useCallback((provider: Provider, value: string) => {
    setSettings((prev) => {
      const next = { ...prev, keys: { ...prev.keys, [provider]: value } };
      persist(next);
      return next;
    });
  }, []);

  return { settings, hydrated, setProvider, setUsername, setKey };
}
