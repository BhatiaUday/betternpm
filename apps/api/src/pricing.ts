import type { AuditProvider, TokenUsage } from "./types.js";

// USD per 1,000,000 tokens. ESTIMATES used only to rank leaderboard spend;
// update as provider pricing changes. Keyed by exact API model id with a
// per-provider fallback for unknown ids.
interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-4-6": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-opus-4-8": { inputPerMillion: 5, outputPerMillion: 25 },
  "gpt-5.4": { inputPerMillion: 1.25, outputPerMillion: 10 },
  "gpt-5.5": { inputPerMillion: 2, outputPerMillion: 15 }
};

const PROVIDER_FALLBACK: Record<Exclude<AuditProvider, "local">, ModelPrice> = {
  anthropic: { inputPerMillion: 3, outputPerMillion: 15 },
  openai: { inputPerMillion: 1.25, outputPerMillion: 10 }
};

export function estimateCostUsd(
  provider: Exclude<AuditProvider, "local">,
  model: string,
  usage: TokenUsage
): number {
  const price = MODEL_PRICES[model] ?? PROVIDER_FALLBACK[provider];
  const cost = (usage.inputTokens / 1_000_000) * price.inputPerMillion
    + (usage.outputTokens / 1_000_000) * price.outputPerMillion;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
