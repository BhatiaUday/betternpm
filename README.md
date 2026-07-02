# betternpm

**`npx` runs code before you can read it. `betternpx` reads it first.**

betternpm is a trust layer over npm: it inspects the package you are about to run or
install — typosquats, install scripts, known vulnerabilities, suspicious source — shows
you the evidence, and only then hands off to the normal npm ecosystem.

```bash
npm i -g betternpm-cli

betternpx cowsay hello          # inspect, then run (npx replacement)
betternpm install left-pad      # inspect, then install (npm replacement)
betternpm inspect create-next-app --json   # machine-readable, for agents
betternpm setup                 # optional: AI audits + GitHub sign-in
```

Everything works with **no account and no API key**. Try it in the browser at
[betternpm.org/search](https://www.betternpm.org/search).

## What it checks (free, before anything executes)

| Check | How |
| --- | --- |
| Known vulnerabilities | [OSV.dev](https://osv.dev) query for the exact version — hits **block** execution |
| Typosquats | Edit distance + homoglyph normalization (`l0dash`, `rеact`) against ~200 popular names |
| Install scripts | `preinstall` / `install` / `postinstall` flagged high — the #1 supply-chain vector |
| Source scan | Tarball downloaded (integrity-verified), scanned for credential access, env harvesting, `child_process`, `eval`, network calls, obfuscation |
| Metadata | Version age, weekly downloads, missing repo/license, optional direct-dependency audit |

The inspected tarball is **never executed**. Execution is delegated to `npm exec` /
`npm install` only after you approve; high-risk or vulnerable packages require
`--force-install`.

## AI audits (optional, bring your own key)

Add an Anthropic or OpenAI key (`betternpm login anthropic`) and betternpm runs a deep
agentic audit on the server: the model explores the actual tarball with read-only tools and
returns a scored verdict with evidence. Results are cached publicly by exact
`package@version+integrity`, so one person's audit benefits everyone — browse them at
[betternpm.org/search](https://www.betternpm.org/search). Sign in with GitHub
(`betternpm login github`) to get credited on the [leaderboard](https://www.betternpm.org/leaderboard).

Your key is sent only to run your audit and is never stored.

## What it does NOT do (yet)

No tool catches everything, and pretending otherwise is how trust dies:

- Novel, well-hidden malware can evade both heuristics and AI review.
- Only the target package (and optionally direct deps) is inspected — not the full tree.
- Analysis is static; runtime-only behavior (time bombs, C2 triggers) can pass.
- AI verdicts can be wrong in both directions — findings link to evidence so you can judge.

Full details: [betternpm.org/security](https://www.betternpm.org/security).

## Badge for your README

Show your package's community audit status:

```markdown
![betternpm audit](https://api.betternpm.org/v1/badge/YOUR-PACKAGE.svg)
```

The badge reflects the latest community audit (AI audits outrank quick scans) and is
cached for an hour.

## Platform notes

- **Windows:** use `npm i -g betternpm-cli` — the `curl | sh` installer is macOS/Linux only.
- **Name collisions:** unrelated npm packages own the names `betternpm` and `bnpm`. This
  project's CLI installs global *bins* with those names from `betternpm-cli`; if you have the
  unrelated packages installed globally, uninstall them first or the bins will conflict.

## Current MVP

- Resolve packages from the public npm registry.
- Show package metadata before execution.
- Query OSV for known vulnerabilities.
- Score risk with deterministic local heuristics.
- Cache exact package-version inspection results locally.
- Execute through `npm exec` only after approval.
- Provide `--json` output for agents and automation.
- Pass ordinary `betternpm`/`bnpm` commands through to `npm`, while inspecting direct registry package specs for `install`/`i`/`add` before npm runs.
- Queue server-side BYOK AI audits with shared public caching, GitHub-verified attribution, and a community leaderboard.

## Local Development

```bash
npm install
npm run inspect -- create-next-app
npm run dev -- create-next-app --help
npm run check
npm run link:cli
betternpm --help
bnpm --help
betternpx --help
```

`Bun` is the preferred future runtime for packaging, but this repository currently runs with Node/npm because Bun is not installed in this workspace.

## Commands

```bash
npm run inspect -- react
npm run dev -- create-next-app
npm run dev -- --json create-next-app
npm run dev -- --yes cowsay hello
npm run link:cli
betternpx create-next-app my-app
bnpx create-next-app my-app
betternpm install
betternpm install is-number
bnpm i -D typescript
bnpm run check
betternpm inspect create-next-app
```

## Direct install from GitHub source

The npm package is the recommended install (`npm i -g betternpm-cli`). Alternatively, the
installer builds and links the CLI directly from GitHub source:

```bash
curl -fsSL https://betternpm.org/latest | sh
```

To run the installer from a checked-out repo instead:

```bash
BETTERNPM_REPO=BhatiaUday/betternpm BETTERNPM_REF=main ./scripts/install.sh
```

The installer requires Node.js 20+, npm, curl, and tar. It installs the global bins `betternpm`, `bnpm`, `betternpx`, and `bnpx` using `npm link`. Use `betternpx`/`bnpx` where you would use `npx`, and `betternpm`/`bnpm` where you would use `npm`.

## Server-side audit cache

The local CLI can do fast deterministic preflight checks, but canonical cached audits should happen on Better npm infrastructure. The Worker resolves package metadata from npm, downloads the tarball from npm, verifies the registry integrity, scans bounded source snippets on the server, and then optionally calls the user's Anthropic/OpenAI key directly from the Worker.

The client never sends source code for cached audits. It can send a package name, version/range, optional integrity, target, provider, model, and one request-scoped API key. For BYOK provider audits, the CLI first asks the server for a cache hit without sending the key; the key is sent only for a cache miss or a forced refresh, and is never stored in D1.

Local Worker flow:

```bash
npm -w @betternpm/api run db:init:local
npm -w @betternpm/api run dev
```

Create or read a cached deterministic audit:

```bash
curl -X POST http://localhost:8787/v1/audits \
	-H 'content-type: application/json' \
	-d '{"target":"npx","packageName":"create-next-app","version":"latest","provider":"local"}'
```

Run a BYOK provider audit on the server:

```bash
curl -X POST http://localhost:8787/v1/audits \
	-H 'content-type: application/json' \
	-d '{"target":"npx","packageName":"create-next-app","version":"latest","provider":"anthropic","model":"claude-sonnet-4-20250514","apiKey":"'$ANTHROPIC_API_KEY'"}'
```

Force a server-side re-audit for the same exact npm artifact:

```bash
curl -X POST http://localhost:8787/v1/audits \
	-H 'content-type: application/json' \
	-d '{"target":"npx","packageName":"create-next-app","version":"latest","provider":"anthropic","model":"claude-sonnet-4-20250514","forceRefresh":true,"apiKey":"'$ANTHROPIC_API_KEY'"}'
```

Fetch the latest cached summary for a resolved version:

```bash
curl http://localhost:8787/v1/packages/create-next-app/16.2.9/summary
```

The cache key is content-addressed by target (`npx` today, `npm-install` later), package name, resolved version, npm registry integrity, scanner profile, provider, and model. Package name and version are the human-readable identity, but integrity is what identifies the exact tarball artifact. If the caller sends an integrity value that does not match npm registry metadata, the Worker rejects the audit instead of caching it.

Audit records store the provider, model, risk output, facts, findings, source evidence, and audit timestamp. The schema also has a nullable `requested_by_user_id` column so authenticated usernames/users can be attached later without changing the audit identity.

For an existing local D1 created before target-aware cache keys, run:

```bash
npm -w @betternpm/api run db:migrate:local
```

For an existing local D1 created before audit-user attribution, run:

```bash
npm -w @betternpm/api run db:migrate:requested-by:local
```

## API deployment

BYOK audits need the Worker deployed before the default CLI URL can work. The CLI defaults to `https://api.betternpm.org` for server audits.

The Worker runs on Cloudflare and serves `https://api.betternpm.org` directly as a Worker custom domain. The public website can still run on Vercel through separate DNS records for `betternpm.org` and `www.betternpm.org`.

One-time setup:

```bash
cd apps/api
npx wrangler login
npm run db:create
```

Copy the returned D1 `database_id` into `apps/api/wrangler.toml`, then initialize and deploy:

```bash
npm run db:init:remote
npm run db:migrate:audit-requests:remote
npx wrangler queues create betternpm-audit-requests
npm run deploy
```

Smoke test health and enqueue an AI audit request:

```bash
curl https://api.betternpm.org/health

curl -X POST https://api.betternpm.org/v1/audit-requests \
	-H 'content-type: application/json' \
	-d '{"target":"npm-install","packageName":"left-pad","version":"latest","provider":"anthropic","apiKey":"'$ANTHROPIC_API_KEY'","forceRefresh":true}'
```

`/v1/audit-requests` is the audit entrypoint: it enqueues an AI-backed audit and can be polled at `/v1/audit-requests/:id` until it returns `completed` with an `audit`. `/v1/audits` is cache lookup only for exact package/version/integrity/provider/model identities. Provider keys are held only in the queue message long enough to run the audit and are not stored in D1.

Use the `workers.dev` URL printed by `wrangler deploy` only for Cloudflare-side debugging. Product and CLI traffic should use `https://api.betternpm.org`.

## Security Boundaries

- The inspector never executes downloaded package contents.
- Execution is delegated to `npm exec` after inspection.
- AI audit findings drive the server safety score. OSV data, tarball snippets, package metadata, and source evidence are audit inputs, not standalone server verdicts.
- `--force-fresh-audit` re-runs the configured server audit instead of reading the server audit cache.
- Local cache keys include package name, version, integrity, and scanner profile.

## Name Notes

`betternpm` and `bnpm` are already published on npm by other maintainers, so those are CLI bin aliases exposed by the `betternpm-cli` package rather than package reservations. `bnpx` is also a CLI bin alias; npm refused the unscoped `bnpx` package name as too similar to existing packages. The CLI ships as `betternpm-cli` (with `betternpm-core` as its engine), and `betternpx` remains claimed as a public reservation package. The scoped `@betternpm/*` names can be adopted later once a `betternpm` npm org exists.

Alias intent: `betternpx` and `bnpx` replace `npx`; `betternpm` and `bnpm` replace `npm`. Today the npm replacement path passes through ordinary npm commands and inspects direct registry package specs for `install`/`i`/`add`. Full dependency graph inspection comes next.
