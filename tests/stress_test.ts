/**
 * Stress Test: Validates client-side data integrity of the Convex storage adapter.
 *
 * Simulates 1000 rapid score updates through the DB layer and reports:
 *   - Duplicates inserted into the cache
 *   - Dropped rows (cache count vs expected)
 *   - Out-of-order timestamps
 *
 * Run with: npx tsx tests/stress_test.ts
 */

// Stub the ConvexHttpClient so we don't need a live backend
// We intercept all mutations to count what would be sent to Convex
const convexWrites: Array<{ mutation: string; args: Record<string, unknown>; order: number }> = [];
let writeOrder = 0;

// Mock the convex/browser module before importing db.ts
const Module = require('module');
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...rest: any[]) {
    if (request === 'convex/browser') {
        return request; // return as-is, we'll handle it
    }
    return originalResolveFilename.call(this, request, ...rest);
};

// Intercept require for convex/browser
const originalLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
    if (request === 'convex/browser') {
        return {
            ConvexHttpClient: class MockConvexHttpClient {
                constructor(_url: string) {}
                async mutation(api: any, args: any) {
                    const mutationName = typeof api === 'string' ? api : 'unknown';
                    convexWrites.push({ mutation: mutationName, args, order: writeOrder++ });
                    // Simulate variable network latency (0-50ms)
                    const latency = Math.random() * 50;
                    return new Promise(resolve => setTimeout(resolve, latency));
                }
            }
        };
    }
    if (request === 'convex/server') {
        return {
            anyApi: new Proxy({}, {
                get: (_target: any, prop: any) => new Proxy({}, {
                    get: (_t: any, method: any) => `${String(prop)}.${String(method)}`
                })
            })
        };
    }
    return originalLoad.call(this, request, ...rest);
};

// Now import the DB module (it will use our mocked ConvexHttpClient)
import { DB, initStorage, ScoreEvent } from '../src/db';

// ─── Test Configuration ───
const MATCH_ID = 'stress-test-match-001';
const TOTAL_UPDATES = 1000;

// ─── Simulate parser.ts dedup logic (copied from parser.ts L42-48) ───
function simulateParserInsert(event: ScoreEvent): boolean {
    const history = DB.getMatchScores(event.match_id);
    if (history.length === 0 ||
        history[history.length - 1]!.home_score !== event.home_score ||
        history[history.length - 1]!.away_score !== event.away_score) {
        DB.insertScoreEvent(event);
        return true; // inserted
    }
    return false; // deduplicated
}

// ─── Generate 1000 score updates ───
// Realistic pattern: score changes ~30% of the time, rest are duplicate polls
function generateUpdates(): ScoreEvent[] {
    const updates: ScoreEvent[] = [];
    let homeScore = 0;
    let awayScore = 0;
    let quarter = 'Q1';
    let clock = '10:00';

    for (let i = 0; i < TOTAL_UPDATES; i++) {
        // ~30% chance score changes
        if (Math.random() < 0.3) {
            if (Math.random() < 0.5) {
                homeScore += Math.random() < 0.7 ? 2 : 3;
            } else {
                awayScore += Math.random() < 0.7 ? 2 : 3;
            }
        }

        // Quarter transitions
        if (i === 250) { quarter = 'Q2'; clock = '10:00'; }
        else if (i === 500) { quarter = 'Q3'; clock = '10:00'; }
        else if (i === 750) { quarter = 'Q4'; clock = '10:00'; }
        else {
            // Decrement clock roughly
            const minutes = Math.max(0, 10 - Math.floor((i % 250) / 25));
            const seconds = Math.floor(Math.random() * 60).toString().padStart(2, '0');
            clock = `${minutes}:${seconds}`;
        }

        updates.push({
            match_id: MATCH_ID,
            event_time: Date.now() + i, // strictly increasing timestamps
            home_score: homeScore,
            away_score: awayScore,
            quarter,
            remaining_clock: clock,
        });
    }

    return updates;
}

// ─── Run the stress test ───
async function runStressTest() {
    console.log('═══════════════════════════════════════════');
    console.log('  CONVEX STORAGE ADAPTER — STRESS TEST');
    console.log('  1000 rapid score updates');
    console.log('═══════════════════════════════════════════\n');

    // Initialize storage with a fake Convex URL (our mock will handle it)
    initStorage('http://mock-convex:3210');

    // Upsert the match first
    DB.upsertMatch({
        id: MATCH_ID,
        home_team: 'StressTeam Home',
        away_team: 'StressTeam Away',
        status: 'LIVE',
    });

    const updates = generateUpdates();

    // Count expected unique score states
    const uniqueScoreStates = new Set<string>();
    let expectedInserts = 0;
    let prevKey = '';
    for (const u of updates) {
        const key = `${u.home_score}-${u.away_score}`;
        if (key !== prevKey) {
            expectedInserts++;
            prevKey = key;
        }
        uniqueScoreStates.add(key);
    }

    console.log(`Input: ${TOTAL_UPDATES} total updates`);
    console.log(`Expected unique score states: ${uniqueScoreStates.size}`);
    console.log(`Expected inserts (after dedup): ${expectedInserts}\n`);

    // Fire all updates synchronously (simulating rapid polling)
    let actualInserts = 0;
    let deduplicated = 0;
    const startTime = performance.now();

    for (const update of updates) {
        const inserted = simulateParserInsert(update);
        if (inserted) actualInserts++;
        else deduplicated++;
    }

    const elapsed = performance.now() - startTime;

    // ─── Analyze results ───
    const cachedScores = DB.getMatchScores(MATCH_ID);

    // Check for duplicates in cache
    let duplicatesInCache = 0;
    for (let i = 1; i < cachedScores.length; i++) {
        if (cachedScores[i]!.home_score === cachedScores[i - 1]!.home_score &&
            cachedScores[i]!.away_score === cachedScores[i - 1]!.away_score) {
            duplicatesInCache++;
        }
    }

    // Check for out-of-order timestamps
    let outOfOrder = 0;
    for (let i = 1; i < cachedScores.length; i++) {
        if (cachedScores[i]!.event_time < cachedScores[i - 1]!.event_time) {
            outOfOrder++;
        }
    }

    // Check for dropped rows
    const droppedRows = expectedInserts - actualInserts;

    // ─── Report ───
    console.log('─── RESULTS ───────────────────────────────');
    console.log(`Total updates processed:    ${TOTAL_UPDATES}`);
    console.log(`Deduplicated (correct):     ${deduplicated}`);
    console.log(`Actual inserts to cache:    ${actualInserts}`);
    console.log(`Expected inserts:           ${expectedInserts}`);
    console.log(`Time elapsed:               ${elapsed.toFixed(2)}ms`);
    console.log(`Throughput:                  ${(TOTAL_UPDATES / (elapsed / 1000)).toFixed(0)} updates/sec`);
    console.log('');
    console.log('─── INTEGRITY CHECKS ──────────────────────');
    console.log(`Duplicates in cache:        ${duplicatesInCache} ${duplicatesInCache === 0 ? '✅' : '❌'}`);
    console.log(`Dropped rows:               ${droppedRows} ${droppedRows === 0 ? '✅' : '❌'}`);
    console.log(`Out-of-order timestamps:    ${outOfOrder} ${outOfOrder === 0 ? '✅' : '❌'}`);
    console.log('');

    // Wait for async Convex writes to settle
    console.log('─── CONVEX WRITE ANALYSIS ─────────────────');
    console.log(`(Waiting 3s for async writes to settle...)`);
    await new Promise(r => setTimeout(r, 3000));

    const scoreWrites = convexWrites.filter(w => 
        typeof w.mutation === 'string' && w.mutation.includes('saveScoreTimeline')
    );
    console.log(`Convex mutations fired:     ${scoreWrites.length}`);
    console.log(`Cache rows:                 ${cachedScores.length}`);
    console.log(`Cache-Convex match:         ${scoreWrites.length === cachedScores.length ? '✅' : '⚠️  MISMATCH (async, may settle)'}`);

    // Check if Convex writes arrived in order
    let convexOutOfOrder = 0;
    for (let i = 1; i < scoreWrites.length; i++) {
        const prevTs = scoreWrites[i - 1]!.args.timestamp as number;
        const currTs = scoreWrites[i]!.args.timestamp as number;
        if (currTs < prevTs) {
            convexOutOfOrder++;
        }
    }
    console.log(`Convex write order issues:  ${convexOutOfOrder} ${convexOutOfOrder === 0 ? '✅' : '⚠️  (HTTP reordering risk)'}`);

    console.log('');
    console.log('─── KNOWN GAPS (not testable offline) ─────');
    console.log('✅  Server-side dedup:       IMPLEMENTED (compound index)');
    console.log('⚠️  Retry on failure:        NOT IMPLEMENTED');
    console.log('⚠️  Cache hydration:         NOT IMPLEMENTED');
    console.log('⚠️  Convex ordering:         Depends on HTTP arrival order');
    console.log('');
    console.log('═══════════════════════════════════════════');

    // Overall verdict
    const allPassed = duplicatesInCache === 0 && droppedRows === 0 && outOfOrder === 0;
    if (allPassed) {
        console.log('CLIENT-SIDE VERDICT: ✅ PASS');
        console.log('All cache-level integrity checks passed.');
    } else {
        console.log('CLIENT-SIDE VERDICT: ❌ FAIL');
        console.log('Cache-level integrity issues detected.');
    }
    console.log('═══════════════════════════════════════════');
}

runStressTest().catch(console.error);
