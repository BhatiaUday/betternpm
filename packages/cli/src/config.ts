import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type LlmProvider = "none" | "anthropic" | "openai";

export interface BetterNpxConfig {
  minimumVersionAgeHours: number;
  inspectTarball: boolean;
  auditServerUrl: string;
  llmProvider: LlmProvider;
  llmModel?: string;
  apiKeyEnv?: string;
  autoAllowCached: boolean;
  username?: string;
  auditDependencies: boolean;
  confirmAuditCost: boolean;
  maxAuditCostUsd?: number;
}

export const DEFAULT_CONFIG: BetterNpxConfig = {
  minimumVersionAgeHours: 24,
  inspectTarball: true,
  auditServerUrl: "https://api.betternpm.org",
  llmProvider: "none",
  autoAllowCached: true,
  auditDependencies: false,
  confirmAuditCost: true
};

export async function readConfig(): Promise<BetterNpxConfig> {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<BetterNpxConfig>;

    return {
      ...DEFAULT_CONFIG,
      ...parsed
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function writeConfig(config: BetterNpxConfig): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export interface AuditOverrides {
  providerOverride?: string;
  modelOverride?: string;
  apiKeyEnvOverride?: string;
  apiKeyInline?: string;
  auditDependencies?: boolean;
  maxCost?: number;
}

/**
 * Produce a per-run config with command-line overrides applied on top of the saved
 * config. Only provided overrides take effect; everything else falls through.
 */
export function applyAuditOverrides(config: BetterNpxConfig, overrides: AuditOverrides): BetterNpxConfig {
  const next: BetterNpxConfig = { ...config };

  if (overrides.providerOverride !== undefined) {
    if (overrides.providerOverride !== "none" && overrides.providerOverride !== "anthropic" && overrides.providerOverride !== "openai") {
      throw new Error("--provider must be none, anthropic, or openai.");
    }

    next.llmProvider = overrides.providerOverride;
  }

  if (overrides.modelOverride !== undefined) {
    next.llmModel = overrides.modelOverride;
  }

  if (overrides.apiKeyEnvOverride !== undefined) {
    next.apiKeyEnv = overrides.apiKeyEnvOverride;
  }

  if (overrides.auditDependencies !== undefined) {
    next.auditDependencies = overrides.auditDependencies;
  }

  if (overrides.maxCost !== undefined) {
    next.maxAuditCostUsd = overrides.maxCost;
  }

  return next;
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function configDir(): string {
  if (process.env.BETTERNPM_CONFIG_DIR) {
    return process.env.BETTERNPM_CONFIG_DIR;
  }

  return join(homedir(), ".config", "betternpm");
}
