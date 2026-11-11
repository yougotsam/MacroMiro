# Run MacroMiro somewhere else

## One project, one official release

Repository: [MacroMiro](https://github.com/yougotsam/MacroMiro).

The official release target is `main`. A development branch or pull request is not automatically part of `main` or a deployed website.

Consolidation checkpoint, November 8, 2026 (not a completed release):

- `main`: `fee153a82d1b8a260cdf8597d3f162263227b144`.
- [PR #18](https://github.com/yougotsam/MacroMiro/pull/18): `54123d5ab365a390818be4e3a6ff97a692707177`.
- Additional reviewed working changes are not yet committed or shipped.
- PR #18 and those working changes are not included in a `main` ZIP.

Do not treat this checkpoint's `main` download as the completed consolidation. After approval and shipment, record the actual release commit and verify a fresh download against that immutable commit. Do not use a moving branch name as proof of which version was tested.

## Included source

- Prediction engine: `src/lib/desk/` and `src/lib/signal/`.
- Perpetual engine and transport: `src/lib/perps/`.
- Application screens: `src/components/` and `src/routes/`.
- MiroFish backend/frontend source: `mirofish/`.
- MiroFish upstream and local-patch provenance: `mirofish/UPSTREAM.md`.
- Dependency lockfiles, tests, migrations and operating documentation.

Included data files are historical snapshots, not proof of current account state, fresh market history or a running service.

## Not included as a working environment

A source download does not carry installed dependencies, browser sessions, private credentials, running services or installed schedules.

Ignored material includes `.grok/secrets/`, private `.env` configuration, dependency environments, MiroFish uploads/logs and generated data listed in `.gitignore`. The large live `decisions.jsonl` stream is excluded; an archived snapshot does not replace the current account/order journal.

Restore private configuration through a secure process. Never restore live/arm/begin switches as enabled automatically. Never commit credentials.

## Runtime prerequisites

The desk checks were run with Node.js 24.22.1 and Bun 1.4.4. These are tested versions, not a claim that every other version is supported or that a fresh installation has been proved.

MiroFish requires Python `>=3.11,<3.13`, uv, Node.js and npm. Its dependencies and services must be installed separately.

## Install and verify source

From the repository root:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run lint
bun test
node scripts/with-app-env.mjs node_modules/.bin/vite build
bun scripts/ops/no-orders-check.ts
```

The safe build command deliberately excludes database migration. Passing these checks is not permission to trade. The current checks used an existing package-and-lock-matched dependency installation; a clean-machine install is a separate reproducibility check.

For MiroFish, the existing setup command is:

```sh
cd mirofish
npm run setup:all
```

That script uses `npm install` and `uv sync`; it is a convenience setup, not a demonstrated frozen-lock reproducibility guarantee.

Configure MiroFish privately using `mirofish/.env.example` and `mirofish/SETUP.md`. Its backend defaults to loopback port 5001. Installing dependencies does not start services or demonstrate a successful simulation. Model/Zep usage requires the owner's spending approval.

## Database and application configuration

Review the target environment before starting the application.

`npm run build` appends `npm run db:migrate`. With `DATABASE_URL` configured, that migration command writes to the selected database. Run migration only after reviewing the target and approving the change. Without `DATABASE_URL`, that migration script skips; local PGLite has separate startup behavior. See `scripts/migrate.mjs`.

Desk runtime data defaults to `/workspace/data/desk`; `DESK_DATA_DIR` can override it. Other components have their own configuration and paths. Review them before moving machines; changing one variable does not relocate every component.

## Services and schedules

MiroFish remains a separately operated service despite source inclusion.

`ops/crontab` is a schedule template, not an installed schedule. It currently names `/workspace/mm-main` and New York scheduling time. Review its paths, time zone, API usage and supervision before installation.

Do not run `startup.sh` or launch an order engine merely to preview the UI.

## Trading release gate

Keep existing production locks unchanged.

Before a trading release, finish lifecycle ownership and supervised fill/reconnect handling, authoritative risk accounting, isolated confirmed Kalshi demo configuration, the complete demo sequence, secret scanning, independent quality review and explicit shipment approval.

A green build is not proof that either trading product is ready.
