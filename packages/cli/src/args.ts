import { parsePackageSpec } from "betternpm-core";

export type CliMode = "config" | "inspect" | "run";

export interface CliArgs {
  mode: CliMode;
  packageSpec: string;
  commandArgs: string[];
  json: boolean;
  yes: boolean;
  forceInstall: boolean;
  forceFreshAudit: boolean;
  includeOsv: boolean;
  help: boolean;
  version: boolean;
  configSet?: string;
  configValue?: string;
  providerOverride?: string;
  modelOverride?: string;
  apiKeyEnvOverride?: string;
  apiKeyInline?: string;
  auditDependencies?: boolean;
  maxCost?: number;
}

export function parseCliArgs(argv: string[]): CliArgs {
  let mode: CliMode = "run";
  let packageSpecFromFlag: string | undefined;
  let json = false;
  let yes = false;
  let forceInstall = false;
  let forceFreshAudit = false;
  let includeOsv = true;
  let help = false;
  let version = false;
  let providerOverride: string | undefined;
  let modelOverride: string | undefined;
  let apiKeyEnvOverride: string | undefined;
  let apiKeyInline: string | undefined;
  let auditDependencies: boolean | undefined;
  let maxCost: number | undefined;
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (mode === "run" && positionals.length === 0 && arg === "inspect") {
      mode = "inspect";
      continue;
    }

    if (mode === "run" && positionals.length === 0 && arg === "config") {
      mode = "config";
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--yes" || arg === "-y") {
      yes = true;
      continue;
    }

    if (arg === "--force") {
      throw new Error("Use --force-install to bypass install blocking, or --force-fresh-audit to rerun the server audit.");
    }

    if (arg === "--force-install") {
      forceInstall = true;
      continue;
    }

    if (arg === "--force-fresh-audit") {
      forceFreshAudit = true;
      continue;
    }

    if (arg === "--no-audit") {
      includeOsv = false;
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

    if (arg === "--provider" || arg.startsWith("--provider=")) {
      providerOverride = readOptionValue(arg, argv, index, "--provider");
      if (!arg.includes("=")) {
        index += 1;
      }
      continue;
    }

    if (arg === "--model" || arg.startsWith("--model=")) {
      modelOverride = readOptionValue(arg, argv, index, "--model");
      if (!arg.includes("=")) {
        index += 1;
      }
      continue;
    }

    if (arg === "--api-key-env" || arg.startsWith("--api-key-env=")) {
      apiKeyEnvOverride = readOptionValue(arg, argv, index, "--api-key-env");
      if (!arg.includes("=")) {
        index += 1;
      }
      continue;
    }

    if (arg === "--api-key" || arg.startsWith("--api-key=")) {
      apiKeyInline = readOptionValue(arg, argv, index, "--api-key");
      if (!arg.includes("=")) {
        index += 1;
      }
      continue;
    }

    if (arg === "--max-cost" || arg.startsWith("--max-cost=")) {
      const raw = readOptionValue(arg, argv, index, "--max-cost");
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error("--max-cost requires a non-negative number (USD).");
      }
      maxCost = parsed;
      if (!arg.includes("=")) {
        index += 1;
      }
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--version" || arg === "-v") {
      version = true;
      continue;
    }

    if (mode === "config" && arg === "set") {
      const key = argv[index + 1];
      const value = argv[index + 2];

      if (!key || value === undefined) {
        throw new Error("config set requires a key and value.");
      }

      return {
        mode: "config",
        packageSpec: "",
        commandArgs: [],
        json,
        yes,
        forceInstall,
        forceFreshAudit,
        includeOsv,
        help,
        version,
        configSet: key,
        configValue: value
      };
    }

    if (arg === "--package" || arg === "-p") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error(`${arg} requires a package spec.`);
      }

      packageSpecFromFlag = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--package=")) {
      const value = arg.slice("--package=".length);

      if (!value) {
        throw new Error("--package requires a package spec.");
      }

      packageSpecFromFlag = value;
      continue;
    }

    positionals.push(arg);

    if (mode === "run" && !packageSpecFromFlag && positionals.length === 1) {
      positionals.push(...argv.slice(index + 1));
      break;
    }
  }

  if (help || version) {
    return {
      mode,
      packageSpec: packageSpecFromFlag ?? positionals[0] ?? "",
      commandArgs: [],
      json,
      yes,
      forceInstall,
      forceFreshAudit,
      includeOsv,
      help,
      version,
      configSet: undefined,
      configValue: undefined
    };
  }

  if (mode === "config") {
    return {
      mode,
      packageSpec: "",
      commandArgs: [],
      json,
      yes,
      forceInstall,
      forceFreshAudit,
      includeOsv,
      help,
      version
    };
  }

  const packageSpec = packageSpecFromFlag ?? positionals[0];

  if (!packageSpec) {
    throw new Error("Package spec is required. Try `betternpx inspect create-next-app`.");
  }

  if (mode === "inspect") {
    return {
      mode,
      packageSpec,
      commandArgs: [],
      json,
      yes,
      forceInstall,
      forceFreshAudit,
      includeOsv,
      help,
      version,
      configSet: undefined,
      configValue: undefined,
      providerOverride,
      modelOverride,
      apiKeyEnvOverride,
      apiKeyInline,
      auditDependencies,
      maxCost
    };
  }

  const commandArgs = packageSpecFromFlag
    ? positionals.length > 0 ? positionals : [inferCommandName(packageSpec)]
    : [inferCommandName(packageSpec), ...positionals.slice(1)];

  return {
    mode,
    packageSpec,
    commandArgs,
    json,
    yes,
    forceInstall,
    forceFreshAudit,
    includeOsv,
    help,
    version,
    configSet: undefined,
    configValue: undefined,
    providerOverride,
    modelOverride,
    apiKeyEnvOverride,
    apiKeyInline,
    auditDependencies,
    maxCost
  };
}

function readOptionValue(arg: string, argv: string[], index: number, flag: string): string {
  if (arg.startsWith(`${flag}=`)) {
    const value = arg.slice(flag.length + 1);
    if (!value) {
      throw new Error(`${flag} requires a value.`);
    }
    return value;
  }

  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

export function inferCommandName(packageSpec: string): string {
  const parsed = parsePackageSpec(packageSpec);

  if (!parsed.name.startsWith("@")) {
    return parsed.name;
  }

  const [, packageName] = parsed.name.split("/");
  return packageName ?? parsed.name;
}
