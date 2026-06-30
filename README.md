# Better npm

Better npm starts as a trust layer over npm tooling: inspect the package you are about to execute, show concrete risk signals, then delegate to the normal npm ecosystem when you approve.

The first implementation splits command names by intent: `betternpx`/`bnpx` replace `npx`, while `betternpm`/`bnpm` replace `npm` as a drop-in passthrough first. Full package/install inspection is the next inspector build.

## Current MVP

- Resolve packages from the public npm registry.
- Show package metadata before execution.
- Query OSV for known vulnerabilities.
- Score risk with deterministic local heuristics.
- Cache exact package-version inspection results locally.
- Execute through `npm exec` only after approval.
- Provide `--json` output for agents and automation.
- Pass ordinary `betternpm`/`bnpm` commands through to `npm`, while inspecting direct registry package specs for `install`/`i`/`add` before npm runs.

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

Before npm publishing is polished, the installer can build and link the CLI directly from GitHub source:

```bash
curl -fsSL https://betternpm.org/latest | sh
```

Until `betternpm.org/latest` is wired up, run the script directly from a checked-out repo:

```bash
BETTERNPM_REPO=udaybhatia/betternpm BETTERNPM_REF=main ./scripts/install.sh
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
