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

import { initStorage } from './db';
import { ServiceRunner } from './service';
import { Metrics } from './metrics';

const port = parseInt(process.env.PORT || '3000', 10);
http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    } else {
        res.writeHead(404);
        res.end();
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
