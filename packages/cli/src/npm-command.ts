const npmInstallCommands = new Set(["install", "i", "add"]);
const valueOptions = new Set([
  "--before",
  "--cache",
  "--globalconfig",
  "--include",
  "--install-strategy",
  "--omit",
  "--prefix",
  "--registry",
  "--save-bundle",
  "--save-prefix",
  "--scope",
  "--tag",
  "--userconfig",
  "--workspace",
  "-w"
]);

export interface NpmInstallInspectionPlan {
  npmArgs: string[];
  packageSpecs: string[];
  forceInstall: boolean;
  forceFreshAudit: boolean;
  providerOverride?: string;
  modelOverride?: string;
  apiKeyEnvOverride?: string;
  apiKeyInline?: string;
  auditDependencies?: boolean;
  maxCost?: number;
}

const valueOverrideFlags = new Map<string, "providerOverride" | "modelOverride" | "apiKeyEnvOverride" | "apiKeyInline" | "maxCost">([
  ["--provider", "providerOverride"],
  ["--model", "modelOverride"],
  ["--api-key-env", "apiKeyEnvOverride"],
  ["--api-key", "apiKeyInline"],
  ["--max-cost", "maxCost"]
]);

export function parseNpmInstallInspectionPlan(argv: string[]): NpmInstallInspectionPlan | undefined {
  let forceInstall = false;
  let forceFreshAudit = false;
  let auditDependencies: boolean | undefined;
  const overrides: { providerOverride?: string; modelOverride?: string; apiKeyEnvOverride?: string; apiKeyInline?: string; maxCost?: number } = {};
  const npmArgs: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "--force-install") {
      forceInstall = true;
      continue;
    }

    if (arg === "--force-fresh-audit") {
      forceFreshAudit = true;
      continue;
    }

    if (arg === "--audit-deps" || arg === "--dependencies") {
      auditDependencies = true;
      continue;
    }

    if (arg === "--no-audit-deps") {
      auditDependencies = false;
      continue;
    }

    const eqIndex = arg.indexOf("=");
    const flagName = eqIndex === -1 ? arg : arg.slice(0, eqIndex);
    const overrideKey = valueOverrideFlags.get(flagName);

    if (overrideKey) {
      let value: string | undefined;

      if (eqIndex === -1) {
        value = argv[index + 1];
        index += 1;
      } else {
        value = arg.slice(eqIndex + 1);
      }

      if (!value) {
        throw new Error(`${flagName} requires a value.`);
      }

      if (overrideKey === "maxCost") {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error("--max-cost requires a non-negative number (USD).");
        }
        overrides.maxCost = parsed;
      } else {
        overrides[overrideKey] = value;
      }

      continue;
    }

    npmArgs.push(arg);
  }

  const commandIndex = findNpmCommandIndex(npmArgs);

  if (commandIndex === undefined || !npmInstallCommands.has(npmArgs[commandIndex] ?? "")) {
    return undefined;
  }

  const packageSpecs = collectPackageSpecs(npmArgs.slice(commandIndex + 1));

  if (packageSpecs.length === 0) {
    return undefined;
  }

  return {
    npmArgs,
    packageSpecs,
    forceInstall,
    forceFreshAudit,
    providerOverride: overrides.providerOverride,
    modelOverride: overrides.modelOverride,
    apiKeyEnvOverride: overrides.apiKeyEnvOverride,
    apiKeyInline: overrides.apiKeyInline,
    auditDependencies,
    maxCost: overrides.maxCost
  };
}

function findNpmCommandIndex(args: string[]): number | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    if (arg === "--") {
      return undefined;
    }

    if (arg.startsWith("--")) {
      if (!arg.includes("=") && valueOptions.has(arg)) {
        index += 1;
      }

      continue;
    }

    if (arg.startsWith("-") && arg !== "-") {
      if (valueOptions.has(arg)) {
        index += 1;
      }

      continue;
    }

    return index;
  }

  return undefined;
}

function collectPackageSpecs(args: string[]): string[] {
  const packageSpecs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    if (arg === "--") {
      break;
    }

    if (arg.startsWith("--")) {
      if (!arg.includes("=") && valueOptions.has(arg)) {
        index += 1;
      }

      continue;
    }

    if (arg.startsWith("-") && arg !== "-") {
      if (valueOptions.has(arg)) {
        index += 1;
      }

      continue;
    }

    if (isRegistryPackageSpec(arg)) {
      packageSpecs.push(arg);
    }
  }

  return packageSpecs;
}

function isRegistryPackageSpec(value: string): boolean {
  if (value === "." || value.startsWith("./") || value.startsWith("../") || value.startsWith("/") || value.startsWith("~/")) {
    return false;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.includes("://")) {
    return false;
  }

  return true;
}