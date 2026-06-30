import type { TyposquatAssessment } from "./types.js";

/**
 * A curated set of very popular npm package names and common CLI tools.
 * Typosquat attacks almost always imitate a name in a list like this, so a small,
 * high-signal list keeps false positives low while catching the common attacks.
 */
export const POPULAR_PACKAGES: readonly string[] = [
  // ecosystem heavyweights
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
  // common create-* / cli execs
  "create-react-app", "create-next-app", "create-vite", "create-vue",
  "cowsay", "npm", "npx", "pnpm", "yarn", "typescript-eslint",
  "@types/node", "@types/react", "regenerator-runtime", "core-js", "object-assign",
  "left-pad", "is-number", "is-odd", "kind-of", "readable-stream", "string-width",
  "strip-ansi", "wrap-ansi", "supports-color", "color-convert", "color-name"
];

/**
 * Characters frequently swapped in homoglyph/visual typosquats. Normalizing these
 * lets us catch tricks like `l0dash`, `reactt`, or `rеact` (cyrillic e).
 */
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
  // common cyrillic look-alikes
  "\u0430": "a", // а
  "\u0435": "e", // е
  "\u043e": "o", // о
  "\u0440": "p", // р
  "\u0441": "c", // с
  "\u0445": "x", // х
  "\u0443": "y"  // у
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

/**
 * Optimal string alignment distance (Damerau-Levenshtein restricted to adjacent
 * transpositions). Counts insertions, deletions, substitutions, and swaps of two
 * neighbouring characters as a single edit each.
 */
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

      if (
        i > 1
        && j > 1
        && a[i - 1] === b[j - 2]
        && a[i - 2] === b[j - 1]
      ) {
        matrix[i]![j] = Math.min(matrix[i]![j]!, matrix[i - 2]![j - 2]! + 1);
      }
    }
  }

  return matrix[lenA]![lenB]!;
}

/**
 * Strip an npm scope so `@scope/name` is compared on its bare name. Scoped packages
 * are namespaced by an org and are far less prone to typosquatting, but a scoped
 * name can still imitate a popular bare package, so we still compare the bare part.
 */
function bareName(name: string): { scope?: string; bare: string } {
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");

    if (slash !== -1) {
      return { scope: name.slice(0, slash), bare: name.slice(slash + 1) };
    }
  }

  return { bare: name };
}

/**
 * Decide whether a package name looks like a typosquat of a popular package.
 * Returns a structured assessment; `suspected` is false for exact matches and for
 * names too short or too far from anything popular to be a confident signal.
 */
export function detectTyposquat(name: string): TyposquatAssessment {
  const candidate = name.trim();
  const { scope, bare } = bareName(candidate);

  // Exact match against a known popular package is, by definition, not a squat.
  if (popularSet.has(candidate) || popularSet.has(bare)) {
    return { suspected: false, candidate };
  }

  const normalizedCandidate = normalizeName(bare);

  // A pure homoglyph disguise: normalizing the candidate yields a popular name.
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

  // Names shorter than 4 characters generate too many false positives.
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

  // Distance 1 is always suspicious for names >= 4 chars. Distance 2 is only
  // confident for longer names where two edits are less likely to be coincidence.
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
