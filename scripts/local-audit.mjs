#!/usr/bin/env node
//
// Local audit runner (operator-only). Inspects an npm package with betternpm-core,
// asks a LOCAL OpenAI-compatible model endpoint (e.g. a Copilot proxy on
// localhost:4141) for a security verdict, and uploads the finished, verified audit
// to the server's admin-only ingest endpoint.
//
// Custom model endpoints are intentionally NOT a public product feature (SSRF /
// abuse). This runs locally, operated by the platform, to seed demo audits.
//
// Usage:
//   INGEST_TOKEN=... node scripts/local-audit.mjs left-pad is-odd ms
//
// Env:
//   MODEL_ENDPOINT  OpenAI-compatible base URL   (default http://localhost:4141)
//   MODEL_ID        model id served by the proxy (default gpt-5-mini)
//   API_URL         betternpm API base           (default https://api.betternpm.org)
//   INGEST_TOKEN    must match the Worker's INGEST_TOKEN secret (required)

import { inspectPackage } from "betternpm-core";

const MODEL_ENDPOINT = (process.env.MODEL_ENDPOINT || "http://localhost:4141").replace(/\/$/, "");
const MODEL_ID = process.env.MODEL_ID || "gpt-5-mini";
const API_URL = (process.env.API_URL || "https://api.betternpm.org").replace(/\/$/, "");
const INGEST_TOKEN = process.env.INGEST_TOKEN;

const packages = process.argv.slice(2);

if (packages.length === 0) {
  console.error("usage: INGEST_TOKEN=... node scripts/local-audit.mjs <package...>");
  process.exit(1);
}
if (!INGEST_TOKEN) {
  console.error("Set INGEST_TOKEN (must match the Worker's INGEST_TOKEN secret).");
  process.exit(1);
}

const SYSTEM = [
  "You are a security auditor for npm packages. Assess supply-chain risk from the",
  "provided evidence: package metadata, lifecycle scripts, dependencies, OSV",
  "vulnerabilities, a static source scan, and a typosquat signal. Be evidence-based",
  "and concise.",
  "",
  "Reply with ONLY a JSON object (no prose, no markdown fences):",
  '{"riskLevel":"low|medium|high|blocked","score":0-100,"confidence":"low|medium|high",',
  '"summary":"one or two sentences","findings":[{"severity":"info|low|medium|high|blocked",',
  '"code":"short-kebab-code","title":"short title","detail":"optional detail"}]}',
  "",
  "Scoring: 100 = clearly safe, 0 = clearly malicious. Known OSV vulnerabilities or",
  "malicious install scripts imply high or blocked."
].join("\n");

function evidenceFor(inspection) {
  const f = inspection.facts;
  return JSON.stringify({
    name: f.name,
    version: f.version,
    description: f.description,
    license: f.license,
    repository: f.repository,
    publishedAt: f.publishedAt,
    weeklyDownloads: f.downloads?.weekly,
    runtimeDependencyCount: f.runtimeDependencyCount,
    bin: f.bin,
    lifecycleScripts: f.scripts,
    typosquat: f.typosquat,
    osvVulnerabilities: (f.vulnerabilities || []).slice(0, 10).map((v) => ({ id: v.id, summary: v.summary })),
    sourceScanFindings: (f.sourceScan?.findings || []).slice(0, 40).map((x) => ({ severity: x.severity, code: x.code, title: x.title, file: x.evidence?.[0]?.file })),
    deterministicFindings: (inspection.risk?.findings || []).slice(0, 40).map((x) => ({ severity: x.severity, code: x.code, title: x.title }))
  }, null, 2);
}

function parseVerdict(content) {
  let s = String(content).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  const v = JSON.parse(s);
  return {
    level: v.riskLevel ?? v.level,
    score: typeof v.score === "number" ? v.score : Number(v.score),
    confidence: v.confidence,
    summary: v.summary,
    findings: Array.isArray(v.findings) ? v.findings : []
  };
}

async function callModel(evidence) {
  const res = await fetch(`${MODEL_ENDPOINT}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL_ID,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Audit this package. Evidence:\n${evidence}` }
      ],
      max_tokens: 8000,
      response_format: { type: "json_object" }
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`model ${res.status}: ${text.slice(0, 300)}`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`model returned a non-JSON envelope: ${text.slice(0, 200)}`);
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`model returned no content: ${text.slice(0, 200)}`);
  return parseVerdict(content);
}

async function upload(facts, verdict) {
  const res = await fetch(`${API_URL}/v1/audits/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ingest-token": INGEST_TOKEN },
    body: JSON.stringify({
      target: "npm-install",
      packageName: facts.name,
      version: facts.version,
      provider: "github",
      model: MODEL_ID,
      risk: verdict
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ingest ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

for (const pkg of packages) {
  process.stdout.write(`\n=== ${pkg} ===\n`);
  try {
    const inspection = await inspectPackage(pkg, { target: "npm-install", includeOsv: true, inspectTarball: true });
    process.stdout.write(`  inspected ${inspection.facts.name}@${inspection.facts.version}\n`);
    const verdict = await callModel(evidenceFor(inspection));
    process.stdout.write(`  verdict: ${verdict.level} ${verdict.score} — ${(verdict.summary || "").slice(0, 140)}\n`);
    const result = await upload(inspection.facts, verdict);
    const a = result.audit;
    process.stdout.write(`  uploaded: ${a?.identity?.packageName}@${a?.identity?.version} -> ${a?.risk?.level} ${a?.risk?.score}\n`);
  } catch (err) {
    process.stdout.write(`  ERROR: ${err.message}\n`);
  }
}
