// Free, deterministic "quick scan" support for the API: typosquat detection
// (ported from betternpm-core, kept dependency-free) and a transparent local
// risk scorer over the facts + source-scan findings. No AI, no key — results are
// cached in the shared audit table under provider "local".

import type { Finding, FindingSeverity, PackageFacts, RiskAssessment, RiskLevel } from "./types.js";

export interface TyposquatAssessment {
  suspected: boolean;
  candidate: string;
  nearest?: string;
  distance?: number;
  reason?: string;
}

/** Curated popular npm names — typosquats almost always imitate one of these. */
const POPULAR_PACKAGES: readonly string[] = [
  "lodash", "react", "react-dom", "express", "chalk", "commander", "axios", "request",
  "moment", "underscore", "async", "bluebird", "debug", "webpack", "babel-core",
  "typescript", "eslint", "prettier", "vue", "angular", "jquery", "next", "nuxt",
  "vite", "rollup", "esbuild", "jest", "mocha", "chai", "vitest", "tslib",
  "rxjs", "redux", "react-redux", "styled-components", "tailwindcss", "postcss",
  "autoprefixer", "dotenv", "cors", "body-parser", "cookie-parser", "passport",
  "mongoose", "mongodb", "mysql", "mysql2", "pg", "sequelize", "knex", "redis",
  "ioredis", "socket.io", "ws", "node-fetch", "got", "undici", "form-data",
  "uuid", "nanoid", "classnames", "prop-types", "immer", "zod", "yup", "joi",
  "validator", "bcrypt", "bcryptjs", "jsonwebtoken", "crypto-js", "helmet",
  "winston", "pino", "morgan", "nodemon", "ts-node", "tsx", "concurrently",
  "rimraf", "glob", "fs-extra", "chokidar", "minimist", "yargs", "inquirer",
  "ora", "boxen", "figlet", "cli-progress", "kleur", "picocolors", "ansi-styles",
  "semver", "execa", "cross-env", "husky", "lint-staged", "dayjs", "date-fns",
  "luxon", "ramda", "immutable", "graphql", "apollo-server", "apollo-client",
  "@apollo/client", "prisma", "@prisma/client", "drizzle-orm", "typeorm",
  "puppeteer", "playwright", "cheerio", "jsdom", "sharp", "jimp", "multer",
  "nodemailer", "stripe", "aws-sdk", "@aws-sdk/client-s3", "firebase",
  "firebase-admin", "googleapis", "openai", "@anthropic-ai/sdk", "node-sass",
  "sass", "less", "stylus", "handlebars", "ejs", "pug", "marked", "markdown-it",
  "highlight.js", "prismjs", "three", "d3", "chart.js", "leaflet", "mapbox-gl",
  "framer-motion", "react-router", "react-router-dom", "react-query",
  "@tanstack/react-query", "swr", "formik", "react-hook-form", "@reduxjs/toolkit",
  "@mui/material", "antd", "bootstrap", "react-bootstrap", "@emotion/react",
  "create-react-app", "create-next-app", "create-vite", "create-vue",
  "cowsay", "npm", "npx", "pnpm", "yarn", "typescript-eslint",
  "@types/node", "@types/react", "regenerator-runtime", "core-js", "object-assign",
  "left-pad", "is-number", "is-odd", "kind-of", "readable-stream", "string-width",
  "strip-ansi", "wrap-ansi", "supports-color", "color-convert", "color-name"
];

const HOMOGLYPHS: Record<string, string> = {
  "0": "o",
  "1": "l",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "$": "s",
  "@": "a",
  "\u0430": "a",
  "\u0435": "e",
  "\u043e": "o",
  "\u0440": "p",
  "\u0441": "c",
  "\u0445": "x",
  "\u0443": "y"
};

const popularSet = new Set(POPULAR_PACKAGES);
const normalizedPopular = new Map<string, string>();
for (const name of POPULAR_PACKAGES) {
  normalizedPopular.set(normalizeName(name), name);
}

function normalizeName(name: string): string {
  const lower = name.toLowerCase();
  let result = "";

  for (const char of lower) {
    result += HOMOGLYPHS[char] ?? char;
  }

  return result;
}

export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  const lenA = a.length;
  const lenB = b.length;

  if (lenA === 0) {
    return lenB;
  }

  if (lenB === 0) {
    return lenA;
  }

  const matrix: number[][] = Array.from({ length: lenA + 1 }, () => new Array<number>(lenB + 1).fill(0));

  for (let i = 0; i <= lenA; i += 1) {
    matrix[i]![0] = i;
  }

  for (let j = 0; j <= lenB; j += 1) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= lenA; i += 1) {
    for (let j = 1; j <= lenB; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost
      );

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        matrix[i]![j] = Math.min(matrix[i]![j]!, matrix[i - 2]![j - 2]! + 1);
      }
    }
  }

  return matrix[lenA]![lenB]!;
}

function bareName(name: string): { scope?: string; bare: string } {
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");

    if (slash !== -1) {
      return { scope: name.slice(0, slash), bare: name.slice(slash + 1) };
    }
  }

  return { bare: name };
}

export function detectTyposquat(name: string): TyposquatAssessment {
  const candidate = name.trim();
  const { scope, bare } = bareName(candidate);

  if (popularSet.has(candidate) || popularSet.has(bare)) {
    return { suspected: false, candidate };
  }

  const normalizedCandidate = normalizeName(bare);
  const homoglyphTarget = normalizedPopular.get(normalizedCandidate);

  if (homoglyphTarget && homoglyphTarget !== bare && normalizedCandidate !== bare) {
    return {
      suspected: true,
      candidate,
      nearest: scope ? `${scope}/${homoglyphTarget}` : homoglyphTarget,
      distance: 0,
      reason: `Name resolves to "${homoglyphTarget}" after substituting look-alike characters.`
    };
  }

  if (bare.length < 4) {
    return { suspected: false, candidate };
  }

  let nearest: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const popular of POPULAR_PACKAGES) {
    if (popular.length < 4) {
      continue;
    }

    const distance = damerauLevenshtein(normalizedCandidate, normalizeName(popular));

    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = popular;
    }

    if (bestDistance === 1) {
      break;
    }
  }

  if (!nearest || bestDistance === 0) {
    return { suspected: false, candidate };
  }

  const longestComparable = Math.max(bare.length, nearest.length);
  const suspected = bestDistance === 1 || (bestDistance === 2 && longestComparable >= 7);

  if (!suspected) {
    return { suspected: false, candidate, nearest, distance: bestDistance };
  }

  return {
    suspected: true,
    candidate,
    nearest: scope ? `${scope}/${nearest}` : nearest,
    distance: bestDistance,
    reason: `Differs from the popular package "${nearest}" by ${bestDistance} character${bestDistance === 1 ? "" : "s"}.`
  };
}

const SEVERITY_PENALTY: Record<FindingSeverity, number> = {
  info: 0,
  low: 4,
  medium: 12,
  high: 30,
  blocked: 60
};

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  blocked: 4
};

/**
 * Deterministic risk verdict for the free quick scan. Aggregates the source-scan
 * findings with metadata checks (install scripts, OSV, typosquat, very-new
 * version); score = 100 minus severity penalties, level = worst severity seen.
 * No model involved — every finding is mechanically explainable.
 */
export function assessLocalRisk(facts: PackageFacts, requestedName: string): RiskAssessment {
  const findings: Finding[] = [...(facts.sourceScan?.findings ?? [])];

  if (facts.vulnerabilities.length > 0) {
    findings.push({
      severity: "blocked",
      code: "dependency-risk",
      title: "Known vulnerabilities found in OSV",
      detail: facts.vulnerabilities.slice(0, 3).map((vuln) => vuln.id).join(", ")
    });
  }

  const typosquat = detectTyposquat(requestedName);

  if (typosquat.suspected) {
    findings.push({
      severity: "high",
      code: "metadata-risk",
      title: "Package name resembles a popular package",
      detail: typosquat.reason ?? (typosquat.nearest ? `Closest popular package: ${typosquat.nearest}.` : undefined)
    });
  }

  const scripts = facts.scripts ?? {};
  const installScripts = ["preinstall", "install", "postinstall"].filter((name) => scripts[name]);

  if (installScripts.length > 0) {
    findings.push({
      severity: "high",
      code: "install-script",
      title: "Package defines install lifecycle scripts",
      detail: installScripts.map((name) => `${name}: ${scripts[name]}`).join(" | ").slice(0, 400)
    });
  }

  if (facts.publishedAt) {
    const ageHours = (Date.now() - Date.parse(facts.publishedAt)) / 3_600_000;

    if (Number.isFinite(ageHours) && ageHours >= 0 && ageHours < 24) {
      findings.push({
        severity: ageHours < 6 ? "high" : "medium",
        code: "metadata-risk",
        title: "Version was published very recently",
        detail: `Published ${ageHours.toFixed(1)} hours ago.`
      });
    }
  }

  if (!facts.repository) {
    findings.push({
      severity: "info",
      code: "metadata-risk",
      title: "No repository listed in package metadata"
    });
  }

  let worst: FindingSeverity = "info";
  let score = 100;

  for (const finding of findings) {
    score -= SEVERITY_PENALTY[finding.severity] ?? 0;

    if ((SEVERITY_RANK[finding.severity] ?? 0) > SEVERITY_RANK[worst]) {
      worst = finding.severity;
    }
  }

  const level: RiskLevel = worst === "info" ? "low" : worst === "blocked" ? "blocked" : worst;

  return {
    level,
    score: Math.max(0, Math.min(100, score)),
    findings,
    confidence: "high",
    summary: findings.length === 0
      ? "No deterministic risk signals: no known vulnerabilities, install scripts, typosquat match, or suspicious source patterns."
      : `Deterministic scan raised ${findings.length} signal${findings.length === 1 ? "" : "s"}; strongest severity: ${worst}. This is a pattern-based scan, not an AI review.`
  };
}

const BADGE_COLORS: Record<string, string> = {
  low: "#1e7152",
  medium: "#b07310",
  high: "#a4451f",
  blocked: "#9a2020",
  none: "#6d675d"
};

/** Shields-style flat SVG badge: `betternpm | low 92` (or `not audited`). */
export function renderBadgeSvg(status: { riskLevel: string; score: number } | undefined): string {
  const label = "betternpm";
  const value = status ? `${status.riskLevel} ${status.score}` : "not audited";
  const color = BADGE_COLORS[status?.riskLevel ?? "none"] ?? BADGE_COLORS.none;
  const labelWidth = 10 + label.length * 6.5;
  const valueWidth = 10 + value.length * 6.5;
  const width = Math.round(labelWidth + valueWidth);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${label}: ${value}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${Math.round(labelWidth)}" height="20" fill="#2f2c28"/>
    <rect x="${Math.round(labelWidth)}" width="${Math.round(valueWidth)}" height="20" fill="${color}"/>
    <rect width="${width}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${Math.round(labelWidth / 2)}" y="14">${label}</text>
    <text x="${Math.round(labelWidth + valueWidth / 2)}" y="14">${value}</text>
  </g>
</svg>`;
}
