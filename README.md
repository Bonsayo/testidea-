# Cyber Basketball Pipeline

Scrapes live cyber basketball data from MelBet and stores it in [Convex](https://convex.dev).

## Architecture

- **Pipeline** (Node.js/TypeScript) — scrapes MelBet API via Playwright + direct HTTP polling, normalizes match data, runs a state machine for quarter progression, persists to Convex
- **Convex** — backend database with match records, quarter snapshots, and odds timeline
- **Dashboard** — [GitHub Pages site](https://bonsayo.github.io/testidea-/) that queries Convex directly

## Running locally

```bash
npm install
npx convex dev        # starts Convex dev deployment
npx tsx src/index.ts  # starts the pipeline
```

## Deploying

- **Pipeline** — deployed on Render using the `Dockerfile`
- **Site** — auto-deploys to GitHub Pages via `.github/workflows/deploy-site.yml`
- **Convex functions** — deploy with `npx convex deploy`
