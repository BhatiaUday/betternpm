"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

export type Provider = "anthropic" | "openai";

export interface Session {
  token: string;
  login: string;
}

export interface BrowserSettings {
  provider: Provider;
  keys: Record<Provider, string>;
  session?: Session;
}

const STORAGE_KEY = "betternpm.settings.v1";

const DEFAULT_SETTINGS: BrowserSettings = {
  provider: "anthropic",
  keys: { anthropic: "", openai: "" }
};

// Shared module-level store so every component (console, search, account controls)
// sees the same settings and reacts to sign-in / sign-out consistently.
let store: BrowserSettings = DEFAULT_SETTINGS;
let hydrated = false;
const listeners = new Set<() => void>();

function readStorage(): BrowserSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return DEFAULT_SETTINGS;
    }

    const parsed = JSON.parse(raw) as Partial<BrowserSettings> & {
      keys?: Partial<Record<Provider, string>>;
      session?: Partial<Session>;
    };

    const session = parsed.session && typeof parsed.session.token === "string" && typeof parsed.session.login === "string"
      ? { token: parsed.session.token, login: parsed.session.login }
      : undefined;

    return {
      provider: parsed.provider === "openai" ? "openai" : "anthropic",
      keys: {
        anthropic: typeof parsed.keys?.anthropic === "string" ? parsed.keys.anthropic : "",
        openai: typeof parsed.keys?.openai === "string" ? parsed.keys.openai : ""
      },
      session
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

function ensureHydrated(): void {
  if (!hydrated) {
    store = readStorage();
    hydrated = true;
  }
}

function setStore(next: BrowserSettings): void {
  store = next;
  persist(next);
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Persist a GitHub session (used by the /auth/callback page outside React state). */
export function saveSession(session: Session): void {
  ensureHydrated();
  setStore({ ...store, session });
}

/**
 * Browser-local audit settings (provider, handle, BYOK keys, GitHub session).
 * Persisted to localStorage; keys/tokens never leave the browser except to run an
 * audit. Backed by a shared store so all consumers stay in sync.
 */
export function useBrowserSettings() {
  const settings = useSyncExternalStore(subscribe, () => store, () => DEFAULT_SETTINGS);

  useEffect(() => {
    if (!hydrated) {
      hydrated = true;
      store = readStorage();
      for (const listener of listeners) {
        listener();
      }
    }
  }, []);

  const setProvider = useCallback((provider: Provider) => setStore({ ...store, provider }), []);
  const setKey = useCallback((provider: Provider, value: string) => setStore({ ...store, keys: { ...store.keys, [provider]: value } }), []);
  const setSession = useCallback((session: Session) => setStore({ ...store, session }), []);
  const signOut = useCallback(() => setStore({ ...store, session: undefined }), []);

  return { settings, setProvider, setKey, setSession, signOut };
}
