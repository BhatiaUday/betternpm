# betternpm — Launch Checklist

Living checklist toward a basic public launch. Owned by the agent; updated as work lands.

_Last updated: 2026-06-30 (CLI published to npm; launch day)._

## ✅ Done (shipped / deployed)
- **AI audit engine** — agentic tarball exploration (`list_files`/`read_file`/`search_code`/`submit_audit`) for `npm install` + `npx`, cached in D1. Deployed.
- **Flagship models @ high thinking** — Anthropic `claude-opus-4-8` (adaptive thinking + `effort: high`), OpenAI `gpt-5.5` (`reasoning_effort: high`), no manual temperature. Deployed.
- **Queue + cache** — Cloudflare Queue `betternpm-audit-requests`, D1 `betternpm-audits`. Deployed.
- **Infra** — `api.betternpm.org` is a direct Worker custom domain (no Vercel compute). DNS on Cloudflare.
- **Leaderboard + search** — username-based leaderboard (CLI `config set username`), package search. Request IP logged. Deployed.
- **Endpoints** — `/v1/audit-requests`, `/v1/audits`, `/v1/packages/:name/versions`, `/v1/leaderboard`, `/v1/search`. Live.
- **Web pages built** — holding page `/`, audit console `/audit` (shows model + thinking), `/leaderboard`. (Deploy status below.)
- [x] **CLI published** — `betternpm`/`bnpm` + `betternpx`/`bnpx`, `login`/`logout` (local key, chmod 600), `config set username`, static-analysis fallback warning. Live on npm as `betternpm-cli@0.0.1` (+ `betternpm-core@0.0.1`); install via `npm i -g betternpm-cli`.

## � Done this session (2026-06-24)
- [x] **Site nav** — header (Home / Audit / Leaderboard / Sponsor) + privacy footer, on every page.
- [x] **Privacy/disclaimer** — footer: BYOK key never stored, results cached & public, request IPs logged.
- [x] **Web DEPLOYED to Vercel production** — live at `https://www.betternpm.org` (apex `betternpm.org` 308 → www). `/audit` (console shows model + thinking), `/leaderboard` (ranking + search), holding `/` all return 200.
- [x] **Validated** — workspace typecheck + tests green; CLI builds + runs (`--help` OK).
- [x] **Verdict flooring** (deployed) — install scripts running shell/network, or OSV vulns, can only RAISE the AI verdict (anti-injection + anti-fooled-LLM backstop). 40-step ceiling; injection-hardened prompt.
- [x] **Pipeline verified without credits** — bad-key smoke: enqueue → consume → tarball download → workspace build → provider call → graceful retry/fail. Only the model's *output quality* is unverified (needs a funded key).
- [~] **CLI** — builds cleanly for the installer, but not yet reachable by users (see Blocked).

## 🛠️ Done this session (2026-06-29) — feature build ("build all of it")
- [x] **Typosquat detection** (core) — Damerau-Levenshtein + homoglyph normalization vs a curated popular-package list; raises a `possible-typosquat` finding. 11 unit tests.
- [x] **Recursive dependency auditing** (core) — depth-1 direct-dependency audit: a compact semver resolver (`semver.ts`) resolves exact/caret/tilde/comparator ranges to the real installed version, then OSV-batch + typosquat per dependency. New `--audit-deps` flag. Findings `vulnerable-dependency` / `typosquat-dependency`. Live-verified (cowsay, debug install path).
- [x] **Cost guardrails** (CLI) — pre-charge estimate (`pricing.ts`) + interactive confirm before any fresh BYOK audit, `--max-cost` cap and `confirmAuditCost` config; gates *before* the provider is charged.
- [x] **Fast failure UX** (CLI) — provider credit/quota/401/429 errors map to short, actionable messages instead of a 90s hang or raw status dump.
- [x] **Per-run override flags** — `--provider`, `--model`, `--api-key-env`, `--api-key`, `--max-cost`, `--audit-deps` on both npx and install paths.
- [x] **CI** — `.github/workflows/ci.yml`: ubuntu+macOS × Node 20/22, `npm ci` → typecheck → test → build CLI.
- [x] **API rate limiting** — Cloudflare `[[ratelimits]]` bindings (general 120/min, audit-create 20/min), fail-open, keyed by IP + collapsed route. Validated with `wrangler deploy --dry-run`.
- [x] **Web per-package permalink** — `/p/<name>[/<version>]` renders the latest cached audit (new API `GET /v1/packages/:name/:version/audit`); leaderboard search results now deep-link to it.
- Validation: core 37 + CLI 19 tests green; full workspace typecheck clean; API typecheck + wrangler dry-run clean; web typecheck clean. `SCANNER_PROFILE_VERSION` bumped to `local-heuristics-v9`.
- ⚠️ Redeploy needed for the API (new endpoint + rate limits) and web (permalink) to go live.


## 🔴 Blocked on you (cannot do autonomously)
- [ ] **Funded audit run** — no credits on Anthropic/OpenAI, so the model's verdict quality is unverified. Pipeline + failure path already confirmed with a bad key; flooring covers dangerous packages regardless. Verify quality on first funded run.
- [x] **Publish the CLI — DONE (2026-06-30)** — published to npm: **`betternpm-cli@0.0.1`** + **`betternpm-core@0.0.1`** (public access). Verified end-to-end: a clean `npm i betternpm-cli` in a fresh temp dir pulls both from the registry, installs all four bins (`betternpm`/`bnpm`/`betternpx`/`bnpx`), and `betternpx --help` runs the inspector. **Naming note:** used unscoped names because the `@betternpm` scope has no npm org and `betternpm`/`bnpm`/`bnpx` are already taken by other maintainers (`betternpm-core`/`betternpm-cli` were free). To adopt scoped `@betternpm/*` later: create a free `betternpm` org at npmjs.com/org/create, restore the scoped names, then re-run `npm run publish:alpha`. The `curl betternpm.org/latest | sh` installer still needs the code on GitHub `main` (workspace is not yet a git repo) — that's a separate, optional distribution path now that npm install works.

## ⏭️ Remaining before a credible launch (prioritized)
1. Real-key end-to-end audit test (above).
2. ~~Get CLI onto npm~~ — **DONE**: `betternpm-cli@0.0.1`. Optionally also push to GitHub `main` so the `curl | sh` installer path works.
3. Verify failure path: bad/insufficient-credit key returns a clear message (CLI + web), not a 90s timeout.
4. Sanity-check audit output quality on ~3 real packages (clean / install-scripts / sketchy).

## 🟢 Deferred (post-launch)
- Rate limiting / abuse protection on open GET endpoints (IP logging groundwork in).
- Cost guardrails (Opus 4.8 high-effort × up to 16 agent steps can be a non-trivial spend on the user's key).
- Recursive dependency auditing.
- Richer docs / usage guide.

## Notes
- Launch date is **June 30th** (holding page deployed). Flip `/` from holding page to live product when the audit is verified.
- WorkOS/login was intentionally removed; leaderboard is CLI-username only.
- Agent loop: runs until `submit_audit` (ceiling 40 steps = Worker subrequest safety cap, not a quality cap). System prompt hardened against package prompt-injection (untrusted-input rule). Verdict-flooring backstop still TODO.
