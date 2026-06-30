// USD per 1,000,000 tokens. Mirrors apps/api/src/pricing.ts; keep in sync when
// provider pricing changes. Used only to show the user a pre-audit BYOK estimate.
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

const PROVIDER_FALLBACK: Record<"anthropic" | "openai", ModelPrice> = {
  anthropic: { inputPerMillion: 5, outputPerMillion: 25 },
  openai: { inputPerMillion: 2, outputPerMillion: 15 }
};

const PROVIDER_DEFAULT_MODEL: Record<"anthropic" | "openai", string> = {
  anthropic: "claude-opus-4-8",
  openai: "gpt-5.5"
};

// Typical token envelope for one agentic flagship audit at high effort. The agent
// reads several tarball files across steps (input) and reasons + emits a verdict
// (output). These are deliberately wide to avoid understating cost.
const TYPICAL_LOW = { inputTokens: 25_000, outputTokens: 4_000 };
const TYPICAL_HIGH = { inputTokens: 150_000, outputTokens: 30_000 };

export interface AuditCostEstimate {
  provider: "anthropic" | "openai";
  model: string;
  low: number;
  high: number;
}

export function estimateAuditCost(provider: string, model: string | undefined): AuditCostEstimate | undefined {
  if (provider !== "anthropic" && provider !== "openai") {
    return undefined;
  }

  const resolvedModel = model && model.trim() ? model : PROVIDER_DEFAULT_MODEL[provider];
  const price = MODEL_PRICES[resolvedModel] ?? PROVIDER_FALLBACK[provider];

  return {
    provider,
    model: resolvedModel,
    low: cost(TYPICAL_LOW, price),
    high: cost(TYPICAL_HIGH, price)
  };
}

export function formatCostRange(estimate: AuditCostEstimate): string {
  return `~$${estimate.low.toFixed(2)}–$${estimate.high.toFixed(2)}`;
}

function cost(usage: { inputTokens: number; outputTokens: number }, price: ModelPrice): number {
  const value = (usage.inputTokens / 1_000_000) * price.inputPerMillion
    + (usage.outputTokens / 1_000_000) * price.outputPerMillion;
  return Math.round(value * 100) / 100;
}
