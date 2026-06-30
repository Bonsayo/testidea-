import http from 'http';
import { config } from 'dotenv';
import fs from 'fs';

// ── Load env files in order ────────────────────────────────
// .env.local  → cloud CONVEX_URL (takes priority)
// .env        → TARGET_URL, DISCOVERY_MODE, TARGET_ENDPOINTS
//
// dotenv.config() does NOT override already-set vars, so the
// cloud CONVEX_URL from .env.local survives the second load.

if (fs.existsSync('.env.local')) {
    config({ path: '.env.local' });
}
config(); // load .env — fills in TARGET_URL etc. without overwriting

import { initStorage, DB } from './db';
import { ServiceRunner } from './service';
import { Metrics } from './metrics';

const port = parseInt(process.env.PORT || '3000', 10);
http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    } else if (req.url === '/api/matches') {
        const matches = DB.getLiveMatches();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(matches.map(m => ({
            id: m.id,
            home: m.home_team,
            away: m.away_team,
            status: m.status,
            scores: DB.getMatchScores(m.id).slice(-10),
            odds: DB.getMatchOdds(m.id).slice(-5),
        }))));
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Cyber Basketball Pipeline</title>
<style>body{font-family:system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;background:#0d1117;color:#c9d1d9}
h1{color:#58a6ff}.match{border:1px solid #30363d;border-radius:8px;padding:1rem;margin:1rem 0;background:#161b22}
.match h3{margin:0 0 .5rem}.live{color:#3fb950}.finished{color:#8b949e}.score{font-size:1.5rem;font-weight:700;color:#f0f6fc}
.quarter{color:#8b949e;font-size:.9rem}.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.8rem;font-weight:600}
.badge-live{background:#3fb95022;color:#3fb950;border:1px solid #3fb950}.badge-finished{background:#8b949e22;color:#8b949e;border:1px solid #8b949e}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin:1rem 0}
.metric{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:1rem;text-align:center}
.metric .value{font-size:2rem;font-weight:700;color:#58a6ff}.metric .label{font-size:.8rem;color:#8b949e;margin-top:.25rem}
a{color:#58a6ff}</style></head>
<body>
<h1>🏀 Cyber Basketball Pipeline</h1>
<p>Scraping Melbet live cyber games → Convex (<code>${process.env.CONVEX_URL || '(not set)'}</code>)</p>
<div class="metrics">
<div class="metric"><div class="value">${Metrics.getElapsedTime()}</div><div class="label">Uptime</div></div>
<div class="metric"><div class="value">${Metrics.totalNormalizedMatches}</div><div class="label">Matches Captured</div></div>
<div class="metric"><div class="value">${Metrics.totalFailedMutations}</div><div class="label">Failed Mutations</div></div>
</div>
${DB.getLiveMatches().map(m => {
    const isFinished = m.status === 'FINISHED' || m.status === 'COMPLETED';
    const scores = DB.getMatchScores(m.id);
    const lastScore = scores.length > 0 ? scores[scores.length - 1] : null;
    return `<div class="match">
<h3>${m.home_team} vs ${m.away_team}</h3>
<span class="badge ${isFinished ? 'badge-finished' : 'badge-live'}">${isFinished ? 'FINISHED' : 'LIVE'}</span>
${lastScore ? `<div class="score">${lastScore.home_score} - ${lastScore.away_score}</div>` : '<div class="score">0 - 0</div>'}
<div class="quarter">${lastScore?.quarter || '—'} ${lastScore?.remaining_clock || ''}</div>
</div>`;
}).join('') || '<p>No matches in cache yet. Waiting for live data...</p>'}
<p style="margin-top:2rem;color:#8b949e;font-size:.9rem">
Pipeline refreshes every 15s · Convex: <a href="https://dashboard.convex.dev/t/mnkald-uonoto/met-bet/clear-finch-529" target="_blank">clear-finch-529</a>
</p>
</body>
</html>`);
    }
}).listen(port, () => console.log(`[Health] Server listening on port ${port}`));

const convexUrl = process.env.CONVEX_URL || '(not set)';
const targetUrl = process.env.TARGET_URL || '(not set)';
console.log(`[Startup] CONVEX_URL=${convexUrl}`);
console.log(`[Startup] TARGET_URL=${targetUrl}`);

// Initialize the storage adapter before anything else
initStorage(process.env.CONVEX_URL);

// Print metrics snapshot every 30 seconds during burn-in
const METRICS_INTERVAL_MS = 30_000;
setInterval(() => {
    Metrics.printSnapshot();
}, METRICS_INTERVAL_MS);

const runner = new ServiceRunner();
runner.start().catch(console.error);
