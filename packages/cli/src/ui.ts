import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import type { Finding, PackageInspection } from "betternpm-core";
import type { ServerAuditResult } from "./server-audit.js";
import { formatCostRange, type AuditCostEstimate } from "./pricing.js";

export function renderInspection(inspection: PackageInspection): string {
  const { facts, risk } = inspection;
  const lines = [
    "Better npm inspection",
    "",
    `${facts.name}@${facts.version}`,
    facts.description ? `Description: ${facts.description}` : undefined,
    `Risk: ${risk.level.toUpperCase()} (${risk.score}/100)`,
    `Downloads: ${formatDownloads(facts.downloads.weekly)}`,
    `Published: ${facts.publishedAt ?? "unknown"}`,
    `License: ${facts.license ?? "unknown"}`,
    `Repository: ${facts.repository ?? "unknown"}`,
    `Maintainers: ${facts.maintainers.length}`,
    `Runtime dependencies: ${facts.runtimeDependencyCount}`,
    `Bin: ${formatBin(facts.bin)}`,
    `Lifecycle scripts: ${formatLifecycleScripts(facts.scripts)}`,
    facts.agePolicy ? `Age policy: ${formatAgePolicy(facts.agePolicy)}` : undefined,
    facts.sourceScan ? `Source scan: ${formatSourceScan(facts.sourceScan)}` : undefined,
    facts.typosquat?.suspected ? `Typosquat: possible (resembles ${facts.typosquat.nearest ?? "a popular package"})` : undefined,
    facts.dependencyAudit ? `Dependencies: ${formatDependencyAudit(facts.dependencyAudit)}` : undefined,
    `Cache: ${inspection.cacheHit ? "hit" : "miss"}`,
    ""
  ].filter((line): line is string => line !== undefined);

  if (risk.findings.length === 0) {
    lines.push("Findings: none");
    return lines.join("\n");
  }

  lines.push("Findings:");
  for (const finding of risk.findings) {
    lines.push(`- ${formatFinding(finding)}`);
  }

  return lines.join("\n");
}

export function getBlockingReason(inspection: PackageInspection, forceInstall: boolean): string | undefined {
  if (forceInstall) {
    return undefined;
  }

  if (inspection.risk.level === "blocked") {
    return "known vulnerabilities or blocking findings were found";
  }

  if (inspection.risk.level === "high") {
    return "high-risk findings require --force-install";
  }

  return undefined;
}

export function getServerAuditBlockingReason(serverAudit: ServerAuditResult | undefined, forceInstall: boolean): string | undefined {
  if (!serverAudit || forceInstall) {
    return undefined;
  }

  if (serverAudit.audit.risk.level === "blocked") {
    return "server audit returned blocking findings";
  }

  if (serverAudit.audit.risk.level === "high") {
    return "server audit returned high-risk findings requiring --force-install";
  }

  return undefined;
}

export function renderServerAudit(serverAudit: ServerAuditResult): string {
  const status = serverAudit.cached ? "cache hit" : serverAudit.refreshed ? "refreshed" : "created";
  const { identity, risk } = serverAudit.audit;
  const auditedAt = serverAudit.audit.auditedAt ?? serverAudit.audit.createdAt;

  return [
    "",
    `Server audit: ${status}`,
    `Provider: ${identity.provider}`,
    `Model: ${identity.model}`,
    `Audited: ${auditedAt}`,
    `Server risk: ${risk.level.toUpperCase()} (${risk.score}/100)`
  ].join("\n");
}

export function renderStaticOnlyWarning(
  reason: "provider-disabled" | "key-missing" | "declined",
  config: { llmProvider: string; apiKeyEnv?: string }
): string {
  if (reason === "declined") {
    return [
      "",
      "!  AI audit skipped - static analysis only.",
      "   You declined the BYOK audit cost (or it exceeded your --max-cost cap).",
      "   The results above are local heuristics, not a full AI review.",
      ""
    ].join("\n");
  }

  const cause = reason === "key-missing"
    ? `no ${config.llmProvider} API key was found${config.apiKeyEnv ? ` in $${config.apiKeyEnv}` : " locally"}`
    : "no AI provider is configured";

  return [
    "",
    "!  No AI audit was performed - static analysis only.",
    `   No community AI audit is cached for this package, and ${cause}.`,
    "   The results above are local heuristics, not a full AI review.",
    "   Add a key for a full AI audit, or proceed to install with caution:",
    "     betternpm config set llmProvider anthropic",
    "     betternpm config set apiKeyEnv ANTHROPIC_API_KEY",
    "     export ANTHROPIC_API_KEY=...",
    ""
  ].join("\n");
}

export async function confirmExecution(): Promise<boolean> {
  if (!input.isTTY) {
    return false;
  }

  const readline = createInterface({ input, output });

  try {
    const answer = await readline.question("Run this package now? [y/N] ");
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    readline.close();
  }
}

/** Ask a free-text question on an interactive terminal; returns "" when non-TTY. */
export async function promptLine(question: string): Promise<string> {
  if (!input.isTTY) {
    return "";
  }

  const readline = createInterface({ input, output });

  try {
    return (await readline.question(question)).trim();
  } finally {
    readline.close();
  }
}

export async function confirmAuditCharge(
  estimate: AuditCostEstimate | undefined,
  provider: string,
  model?: string
): Promise<boolean> {
  if (!input.isTTY) {
    return false;
  }

  const range = estimate ? formatCostRange(estimate) : "an unknown amount";
  const modelLabel = model ? ` (${model})` : "";
  const readline = createInterface({ input, output });

  try {
    const answer = await readline.question(
      `\nA fresh AI audit will call ${provider}${modelLabel} on your key (BYOK), est. ${range}. Proceed? [y/N] `
    );
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    readline.close();
  }
}

export function renderHelp(version: string, commandName = "betternpx"): string {
  return `${commandName} ${version}

Usage:
  ${commandName} setup
  ${commandName} inspect [options] <package>
  ${commandName} [options] <package> [...args]
  ${commandName} --package <package> -- <command> [...args]
  ${commandName} login github
  ${commandName} login [anthropic|openai]
  ${commandName} logout [github]
  ${commandName} whoami

Options:
  --json             Print inspection JSON and exit without executing
  --yes, -y          Skip the confirmation prompt for allowed risk levels
  --force-install     Allow high-risk or blocked packages to run after inspection
  --force-fresh-audit Re-run configured server audit instead of reading the server cache
  --no-audit         Skip OSV vulnerability lookup
  --audit-deps       Also audit direct dependencies (OSV + typosquat, no AI cost)
  --no-audit-deps    Disable dependency auditing for this run
  --provider <name>  Override the AI provider for this run (none|anthropic|openai)
  --model <name>     Override the AI model for this run
  --api-key-env <V>  Read the BYOK API key from environment variable V
  --api-key <key>    Pass a BYOK API key inline (prefer --api-key-env or login)
  --max-cost <usd>   Skip the AI audit if the estimated BYOK cost exceeds this cap
  --package, -p      Package to install for npm exec delegation
  --help, -h         Show this help
  --version, -v      Show the CLI version

Commands:
  setup              First-time guided setup (provider, BYOK key, GitHub sign-in)
  login github       Sign in with GitHub so audits are credited to your handle
  login <provider>   Save an Anthropic/OpenAI API key locally for BYOK audits
  logout [github]    Remove saved API keys (add 'github' to clear only the session)
  whoami             Show your GitHub sign-in and AI provider status
  inspect <package>  Inspect a package without running it
  config             Show Better npx config
  config set k v     Set config values

Examples:
  ${commandName} setup
  ${commandName} inspect create-next-app
  ${commandName} create-next-app my-app
  ${commandName} login github
  ${commandName} login anthropic
  ${commandName} whoami
  ${commandName} --force-fresh-audit inspect create-next-app
  ${commandName} --package typescript -- tsc --version
  ${commandName} config set llmProvider anthropic
  ${commandName} config set llmModel claude-sonnet-4-6
  ${commandName} config set apiKeyEnv ANTHROPIC_API_KEY`;
}

export function renderSetupIntro(): string {
  return [
    "",
    "betternpm setup",
    "Configure betternpm: pick an AI provider, optionally save a BYOK key, and sign in with GitHub.",
    "Everything is stored locally under ~/.config/betternpm. Press Enter to accept the default.",
    ""
  ].join("\n");
}

// First-run explainer: what each tier gets you, so "no key" is an informed choice
// rather than a silent degradation.
export function renderTierExplainer(commandName = "betternpm"): string {
  return [
    "",
    `Welcome to ${commandName} — inspect npm packages before they run.`,
    "",
    "What you get:",
    "  Free, no key      Full local inspection on every install/run: OSV known",
    "                    vulnerabilities, typosquat detection, install-script and",
    "                    source-scan findings — plus shared community AI audits",
    "                    when one is already cached.",
    "  + GitHub sign-in  Your audits are credited to your verified handle on the",
    "                    public leaderboard.",
    "  + your own AI key Deep agentic AI audit (Anthropic or OpenAI, you pay the",
    "                    provider directly) for packages nobody has audited yet.",
    ""
  ].join("\n");
}

export function renderSetupDone(commandName = "betternpm"): string {
  return [
    "",
    "Setup complete. Try:",
    `  ${commandName} inspect left-pad     inspect a package without running it`,
    `  betternpx cowsay              inspect, then run`,
    `  ${commandName} whoami              show your sign-in + provider`,
    `  ${commandName} --help              all commands`,
    ""
  ].join("\n");
}

function formatDownloads(downloads: number | undefined): string {
  return downloads === undefined ? "unknown" : downloads.toLocaleString();
}

function formatBin(bin: PackageInspection["facts"]["bin"]): string {
  if (!bin) {
    return "none";
  }

  if (typeof bin === "string") {
    return bin;
  }

  const names = Object.keys(bin);
  return names.length > 0 ? names.join(", ") : "none";
}

function formatLifecycleScripts(scripts: Record<string, string>): string {
  const lifecycleScripts = ["preinstall", "install", "postinstall", "prepublish", "prepublishOnly", "prepare"];
  const present = lifecycleScripts.filter((script) => scripts[script]);
  return present.length > 0 ? present.join(", ") : "none";
}

function formatAgePolicy(agePolicy: NonNullable<PackageInspection["facts"]["agePolicy"]>): string {
  const age = agePolicy.resolvedAgeHours === undefined ? "unknown" : `${agePolicy.resolvedAgeHours.toFixed(1)}h`;
  const recommendation = agePolicy.recommendedOlderVersion
    ? `; older candidate ${agePolicy.recommendedOlderVersion.version}`
    : "";
  return `min ${agePolicy.minimumAgeHours}h, current ${age}${recommendation}`;
}

function formatSourceScan(sourceScan: NonNullable<PackageInspection["facts"]["sourceScan"]>): string {
  if (!sourceScan.scanned) {
    return `unavailable${sourceScan.error ? ` (${sourceScan.error})` : ""}`;
  }

  return `${sourceScan.filesScanned} files, ${sourceScan.findings.length} findings`;
}

function formatDependencyAudit(dependencyAudit: NonNullable<PackageInspection["facts"]["dependencyAudit"]>): string {
  if (!dependencyAudit.scanned) {
    return `not scanned${dependencyAudit.error ? ` (${dependencyAudit.error})` : ""}`;
  }

  const vulnerable = dependencyAudit.entries.filter((entry) => entry.vulnerabilities.length > 0).length;
  const typosquats = dependencyAudit.entries.filter((entry) => entry.typosquat?.suspected).length;
  const scope = `${dependencyAudit.auditedCount}/${dependencyAudit.directDependencyCount} direct`;
  const truncated = dependencyAudit.truncated ? " (truncated)" : "";

  return `${scope}${truncated}; ${vulnerable} vulnerable, ${typosquats} typosquat`;
}

function formatFinding(finding: Finding): string {
  const detail = finding.detail ? `: ${finding.detail}` : "";
  const evidence = finding.evidence?.length
    ? `\n  Review: ${finding.evidence.map(formatEvidence).join("; ")}`
    : "";
  return `${finding.severity.toUpperCase()} ${finding.title}${detail}${evidence}`;
}

function formatEvidence(evidence: NonNullable<Finding["evidence"]>[number]): string {
  return evidence.sourceUrl ? `${evidence.file} -> ${evidence.sourceUrl}` : evidence.file;
}
