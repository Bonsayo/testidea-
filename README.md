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

- **Pipeline (Render)** — deployed using the `Dockerfile`; sleeps on free tier
- **Pipeline (GitHub Actions)** — runs every 10 minutes via `.github/workflows/scrape.yml`; free, 24/7, no credit card needed
- **Site** — auto-deploys to GitHub Pages via `.github/workflows/deploy-site.yml`
- **Convex functions** — deploy with `npx convex deploy`

## 24/7 Scraping (no credit card)

The `.github/workflows/scrape.yml` workflow runs on GitHub's servers every 10 minutes.
It fetches the MelBet API, normalizes matches, and persists to Convex — no Playwright or browser needed.
The workflow is free for public repos (2000 min/month included). On average each run takes ~10-15 seconds,
so you use about 30-45 minutes per month — well within the free tier.
