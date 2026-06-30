#!/usr/bin/env node
import { inspectPackage, type PackageInspection } from "betternpm-core";
import { basename } from "node:path";
import { parseCliArgs } from "./args.js";
import { readAllowRecord, writeAllowRecord } from "./allow-cache.js";
import { applyAuditOverrides, readConfig, writeConfig, configPath, type AuditOverrides, type BetterNpxConfig } from "./config.js";
import { clearProviderKeys, credentialsPath, promptSecret, setProviderKey, type ProviderName } from "./credentials.js";
import { runNpmExec, runNpmPassthrough } from "./exec.js";
import { parseNpmInstallInspectionPlan, type NpmInstallInspectionPlan } from "./npm-command.js";
import { estimateAuditCost, formatCostRange } from "./pricing.js";
import { runServerAudit, type ServerAuditResult, type ServerAuditUnavailableReason } from "./server-audit.js";
import { confirmAuditCharge, confirmExecution, getBlockingReason, getServerAuditBlockingReason, renderHelp, renderInspection, renderServerAudit, renderStaticOnlyWarning } from "./ui.js";

const CLI_VERSION = "0.0.1";

async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const commandName = inferInvokedCommandName();

  if (argv[0] === "login" || argv[0] === "logout") {
    return handleAuthCommand(argv, await readConfig());
  }

  if (isNpmReplacementCommand(commandName) && !isBetterNpmInspectCommand(argv)) {
    const npmInstallPlan = parseNpmInstallInspectionPlan(argv);

    if (npmInstallPlan) {
      const config = await readConfig();
      return handleNpmInstallCommand(npmInstallPlan, config);
    }

    return runNpmPassthrough(argv);
  }

  const cliArgs = parseCliArgs(argv);

  if (cliArgs.help) {
    console.log(renderHelp(CLI_VERSION, commandName));
    return 0;
  }

  if (cliArgs.version) {
    console.log(CLI_VERSION);
    return 0;
  }

  const config = await readConfig();

  if (cliArgs.mode === "config") {
    return handleConfigCommand(cliArgs, config);
  }

  const effectiveConfig = applyAuditOverrides(config, cliArgs);
  const chargeGuard = buildChargeGuard(effectiveConfig, cliArgs.yes);

  const { inspection, serverAudit, staticOnly } = await auditPackage(cliArgs.packageSpec, effectiveConfig, "npx", {
    includeOsv: cliArgs.includeOsv,
    forceRefresh: cliArgs.forceFreshAudit,
    inlineApiKey: cliArgs.apiKeyInline,
    onBeforeProviderCharge: chargeGuard
  });
  const allowRecord = effectiveConfig.autoAllowCached ? await readAllowRecord(inspection) : undefined;

  if (cliArgs.json) {
    console.log(JSON.stringify({ inspection, serverAudit: serverAudit ?? null, staticOnly: staticOnly ?? null, autoAllowed: Boolean(allowRecord) }, null, 2));
    return 0;
  }

  console.log(renderInspection(inspection));

  if (serverAudit) {
    console.log(renderServerAudit(serverAudit));
  } else if (staticOnly) {
    console.log(renderStaticOnlyWarning(staticOnly, effectiveConfig));
  }

  if (allowRecord) {
    console.log("\nAuto-allow: exact package/version/integrity was previously approved locally.");
  }

  if (cliArgs.mode === "inspect") {
    return 0;
  }

  const blockingReason = serverAudit
    ? getServerAuditBlockingReason(serverAudit, cliArgs.forceInstall)
    : getBlockingReason(inspection, cliArgs.forceInstall);

  if (blockingReason) {
    console.error(`\nBlocked: ${blockingReason}. Re-run with --force-install if you understand the risk.`);
    return 2;
  }

  if (!allowRecord && !cliArgs.yes && !(await confirmExecution())) {
    console.error("\nExecution cancelled.");
    return 130;
  }

  await writeAllowRecord(inspection);

  return runNpmExec({
    packageSpec: `${inspection.facts.name}@${inspection.facts.version}`,
    commandArgs: cliArgs.commandArgs
  });
}

async function handleNpmInstallCommand(plan: NpmInstallInspectionPlan, config: BetterNpxConfig): Promise<number> {
  console.log(`Better npm install inspection: ${plan.packageSpecs.join(", ")}`);

  const effectiveConfig = applyAuditOverrides(config, plan);
  const chargeGuard = buildChargeGuard(effectiveConfig, false);

  for (const packageSpec of plan.packageSpecs) {
    const { inspection, serverAudit, staticOnly } = await auditPackage(packageSpec, effectiveConfig, "npm-install", {
      includeOsv: true,
      forceRefresh: plan.forceFreshAudit,
      inlineApiKey: plan.apiKeyInline,
      onBeforeProviderCharge: chargeGuard
    });

    console.log(`\n${renderInspection(inspection)}`);

    if (serverAudit) {
      console.log(renderServerAudit(serverAudit));
    } else if (staticOnly) {
      console.log(renderStaticOnlyWarning(staticOnly, effectiveConfig));
    }

    const blockingReason = serverAudit
      ? getServerAuditBlockingReason(serverAudit, plan.forceInstall)
      : getBlockingReason(inspection, plan.forceInstall);

    if (blockingReason) {
      console.error(`\nBlocked ${inspection.facts.name}@${inspection.facts.version}: ${blockingReason}. Re-run with --force-install if you understand the risk.`);
      return 2;
    }
  }

  return runNpmPassthrough(plan.npmArgs);
}

interface AuditFlowResult {
  inspection: PackageInspection;
  serverAudit?: ServerAuditResult;
  staticOnly?: ServerAuditUnavailableReason;
}

async function auditPackage(
  packageSpec: string,
  config: BetterNpxConfig,
  target: "npx" | "npm-install",
  options: {
    includeOsv: boolean;
    forceRefresh: boolean;
    inlineApiKey?: string;
    onBeforeProviderCharge?: (info: { provider: string; model?: string }) => Promise<boolean>;
  }
): Promise<AuditFlowResult> {
  const serverEnabled = config.llmProvider !== "none";

  // When the server can run an AI audit, skip the local tarball download and let the server do it.
  const probe = await inspectPackage(packageSpec, {
    target,
    includeOsv: options.includeOsv,
    inspectTarball: serverEnabled ? false : config.inspectTarball,
    minimumVersionAgeHours: config.minimumVersionAgeHours,
    auditDependencies: config.auditDependencies
  });

  const outcome = await runServerAudit(probe, config, {
    forceRefresh: options.forceRefresh,
    target,
    inlineApiKey: options.inlineApiKey,
    onBeforeProviderCharge: options.onBeforeProviderCharge
  });

  if (outcome.status === "completed") {
    return { inspection: probe, serverAudit: outcome.result };
  }

  // No AI audit available (no provider, declined cost, or no cached audit and no key).
  // Fall back to local static analysis.
  if (!serverEnabled) {
    return { inspection: probe, staticOnly: outcome.reason };
  }

  const staticInspection = await inspectPackage(packageSpec, {
    target,
    includeOsv: options.includeOsv,
    inspectTarball: config.inspectTarball,
    minimumVersionAgeHours: config.minimumVersionAgeHours,
    auditDependencies: config.auditDependencies,
    cache: false
  });

  return { inspection: staticInspection, staticOnly: outcome.reason };
}

/**
 * Build the pre-charge guard used before any fresh BYOK provider audit. It enforces
 * the optional cost cap and, on an interactive terminal, asks the user to confirm
 * the estimated spend. `skipPrompt` (from --yes) approves without asking.
 */
function buildChargeGuard(
  config: BetterNpxConfig,
  skipPrompt: boolean
): (info: { provider: string; model?: string }) => Promise<boolean> {
  return async ({ provider, model }) => {
    const estimate = estimateAuditCost(provider, model);

    if (estimate && config.maxAuditCostUsd !== undefined && estimate.high > config.maxAuditCostUsd) {
      console.error(`\nSkipping AI audit: estimated ${formatCostRange(estimate)} exceeds your cost cap of $${config.maxAuditCostUsd.toFixed(2)}.`);
      return false;
    }

    if (skipPrompt || !config.confirmAuditCost) {
      return true;
    }

    return confirmAuditCharge(estimate, provider, model);
  };
}

async function handleAuthCommand(argv: string[], config: BetterNpxConfig): Promise<number> {
  const command = argv[0];

  if (command === "login") {
    return handleLoginCommand(argv[1], config);
  }

  await clearProviderKeys();
  console.log(`Removed saved API keys from ${credentialsPath()}.`);
  return 0;
}

async function handleLoginCommand(providerArg: string | undefined, config: BetterNpxConfig): Promise<number> {
  const provider = resolveLoginProvider(providerArg, config);

  if (!provider) {
    console.error("Specify a provider: betternpm login anthropic | betternpm login openai");
    return 1;
  }

  const key = await promptSecret(`Paste your ${provider} API key (input hidden): `);

  if (!key) {
    console.error("No API key provided.");
    return 1;
  }

  await setProviderKey(provider, key);

  if (config.llmProvider !== provider) {
    await writeConfig({ ...config, llmProvider: provider });
  }

  console.log(`Saved ${provider} API key to ${credentialsPath()} (permissions 600).`);
  console.log("It stays on this machine and is only sent to the betternpm audit server when you run an audit.");
  return 0;
}

function resolveLoginProvider(value: string | undefined, config: BetterNpxConfig): ProviderName | undefined {
  if (value === "anthropic" || value === "openai") {
    return value;
  }

  if (value === undefined && (config.llmProvider === "anthropic" || config.llmProvider === "openai")) {
    return config.llmProvider;
  }

  return undefined;
}

async function handleConfigCommand(
  cliArgs: ReturnType<typeof parseCliArgs>,
  config: BetterNpxConfig
): Promise<number> {
  if (!cliArgs.configSet) {
    console.log(JSON.stringify({ path: configPath(), config }, null, 2));
    return 0;
  }

  const nextConfig = { ...config };
  const key = cliArgs.configSet as keyof BetterNpxConfig;
  const value = cliArgs.configValue ?? "";

  switch (key) {
    case "minimumVersionAgeHours":
      nextConfig.minimumVersionAgeHours = Number(value);
      break;
    case "inspectTarball":
    case "autoAllowCached":
      nextConfig[key] = value === "true";
      break;
    case "auditDependencies":
    case "confirmAuditCost":
      nextConfig[key] = value === "true";
      break;
    case "maxAuditCostUsd": {
      const trimmed = value.trim();
      if (trimmed === "") {
        nextConfig.maxAuditCostUsd = undefined;
        break;
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error("maxAuditCostUsd must be a non-negative number (USD).");
      }
      nextConfig.maxAuditCostUsd = parsed;
      break;
    }
    case "auditServerUrl":
      nextConfig.auditServerUrl = value;
      break;
    case "llmProvider":
      if (value !== "none" && value !== "anthropic" && value !== "openai") {
        throw new Error("llmProvider must be none, anthropic, or openai.");
      }

      nextConfig.llmProvider = value;
      break;
    case "llmModel":
      nextConfig.llmModel = value;
      break;
    case "apiKeyEnv":
      nextConfig.apiKeyEnv = value;
      break;
    case "username":
      nextConfig.username = value.trim() || undefined;
      break;
    default:
      throw new Error(`Unknown config key: ${String(key)}`);
  }

  await writeConfig(nextConfig);
  console.log(`Updated ${String(key)} in ${configPath()}`);
  return 0;
}

function inferInvokedCommandName(): string {
  const candidate = basename(process.argv[1] ?? "");

  return candidate === "betternpm" || candidate === "bnpm" || candidate === "betternpx" || candidate === "bnpx"
    ? candidate
    : "betternpx";
}

function isNpmReplacementCommand(commandName: string): boolean {
  return commandName === "betternpm" || commandName === "bnpm";
}

function isBetterNpmInspectCommand(argv: string[]): boolean {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "inspect") {
      return true;
    }

    if (arg === "--") {
      return false;
    }

    if (arg === "--json" || arg === "--yes" || arg === "-y" || arg === "--force-install" || arg === "--force-fresh-audit" || arg === "--no-audit") {
      continue;
    }

    if (arg === "--package" || arg === "-p") {
      index += 1;
      continue;
    }

    if (arg.startsWith("--package=")) {
      continue;
    }

    return false;
  }

  return false;
}

main().then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
);
