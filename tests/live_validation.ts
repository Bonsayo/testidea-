import { Metrics } from '../src/metrics';
import { DB, initStorage } from '../src/db';
import { Parser } from '../src/parser';
import { ConvexHttpClient } from 'convex/browser';
import dotenv from 'dotenv';
import fs from 'fs';

if (fs.existsSync('.env.local')) {
  dotenv.config({ path: '.env.local' });
} else {
  dotenv.config();
}

const CONVEX_URL = process.env.CONVEX_URL || '';
const client = new ConvexHttpClient(CONVEX_URL);
const MATCH_ID = 'live-val-' + Date.now();

async function runConvexMutationTest() {
  console.log('\n--- Convex Mutation Test ---');
  try {
    await client.mutation('mutations:saveMatch', {
      matchId: MATCH_ID,
      matchName: 'Live Validation Test',
      startedAt: Date.now(),
    });
    Metrics.recordInterception();
    Metrics.recordNormalizedMatch();
    console.log('saveMatch: OK');
  } catch (e) {
    Metrics.recordFailedMutation();
    console.error('saveMatch: FAILED', e);
  }

  // Simulate Q1 end snapshot (period score)
  try {
    const r1: any = await client.mutation('mutations:saveQuarterSnapshot', {
      matchId: MATCH_ID,
      quarter: 'Q1',
      homeScore: 24,
      awayScore: 18,
      timestamp: Date.now(),
      snapshotType: 'quarter_end',
    });
    if (r1.inserted) { Metrics.recordScoreInsert(); } else { Metrics.recordDuplicatePrevented(); }
    console.log('saveQuarterSnapshot Q1: OK');
  } catch (e) {
    Metrics.recordFailedMutation();
    console.error('saveQuarterSnapshot Q1: FAILED', e);
  }

  // Duplicate Q1 → should be deduped
  try {
    const r2: any = await client.mutation('mutations:saveQuarterSnapshot', {
      matchId: MATCH_ID,
      quarter: 'Q1',
      homeScore: 24,
      awayScore: 18,
      timestamp: Date.now(),
      snapshotType: 'quarter_end',
    });
    if (!r2.inserted) {
      Metrics.recordDuplicatePrevented();
      console.log('Dedup Q1: OK');
    }
  } catch (e) {
    console.error('Dedup Q1: FAILED', e);
  }

  // Simulate Q2 end (period score)
  try {
    const r3: any = await client.mutation('mutations:saveQuarterSnapshot', {
      matchId: MATCH_ID,
      quarter: 'Q2',
      homeScore: 22,
      awayScore: 23,
      timestamp: Date.now(),
      snapshotType: 'quarter_end',
    });
    if (r3.inserted) { Metrics.recordScoreInsert(); } else { Metrics.recordDuplicatePrevented(); }
    console.log('saveQuarterSnapshot Q2: OK');
  } catch (e) {
    Metrics.recordFailedMutation();
    console.error('saveQuarterSnapshot Q2: FAILED', e);
  }

  // Simulate Q3 end (period score)
  try {
    const r4: any = await client.mutation('mutations:saveQuarterSnapshot', {
      matchId: MATCH_ID,
      quarter: 'Q3',
      homeScore: 22,
      awayScore: 20,
      timestamp: Date.now(),
      snapshotType: 'quarter_end',
    });
    if (r4.inserted) { Metrics.recordScoreInsert(); } else { Metrics.recordDuplicatePrevented(); }
    console.log('saveQuarterSnapshot Q3: OK');
  } catch (e) {
    Metrics.recordFailedMutation();
    console.error('saveQuarterSnapshot Q3: FAILED', e);
  }

  // Simulate Q4 end (period score)
  try {
    const r5: any = await client.mutation('mutations:saveQuarterSnapshot', {
      matchId: MATCH_ID,
      quarter: 'Q4',
      homeScore: 23,
      awayScore: 23,
      timestamp: Date.now(),
      snapshotType: 'quarter_end',
    });
    if (r5.inserted) { Metrics.recordScoreInsert(); } else { Metrics.recordDuplicatePrevented(); }
    console.log('saveQuarterSnapshot Q4: OK');
  } catch (e) {
    Metrics.recordFailedMutation();
    console.error('saveQuarterSnapshot Q4: FAILED', e);
  }

  // FINAL (cumulative total for the match)
  try {
    const r6: any = await client.mutation('mutations:saveQuarterSnapshot', {
      matchId: MATCH_ID,
      quarter: 'FINAL',
      homeScore: 91,
      awayScore: 84,
      timestamp: Date.now(),
      snapshotType: 'final',
    });
    if (r6.inserted) { Metrics.recordScoreInsert(); } else { Metrics.recordDuplicatePrevented(); }
    console.log('saveQuarterSnapshot FINAL: OK');
  } catch (e) {
    Metrics.recordFailedMutation();
    console.error('saveQuarterSnapshot FINAL: FAILED', e);
  }
}

/**
 * Build a JSON payload in the format that Parser.looksLikeMatch recognizes
 * (home_team, away_team, home_score, away_score, quarter, clock).
 */
function matchPayload(id: string, ht: string, at: string, hs: number, as: number, q: string, clk: string): string {
  return JSON.stringify({
    data: [{
      id, home_team: ht, away_team: at,
      home_score: hs, away_score: as,
      quarter: q, clock: clk, status: 'LIVE',
    }],
  });
}

function simulatePipelineProcessing() {
  console.log('\n--- Pipeline Simulation ---');

  DB._resetQuarterTracking();

  // Feed scores advancing through Q1 → Q2 → Q3 → Q4 → then match end
  // NOTE: scores are PERIOD scores (points in that quarter only), not cumulative.
  const payloads = [
    matchPayload('pipe-test-001', 'Home', 'Away', 10,  8,  'Q1', '02:00'),
    matchPayload('pipe-test-001', 'Home', 'Away', 24, 18,  'Q1', '00:00'),
    matchPayload('pipe-test-001', 'Home', 'Away', 22, 23,  'Q2', '10:00'),
    matchPayload('pipe-test-001', 'Home', 'Away', 22, 23,  'Q2', '00:00'),
    matchPayload('pipe-test-001', 'Home', 'Away', 22, 20,  'Q3', '10:00'),
    matchPayload('pipe-test-001', 'Home', 'Away', 22, 20,  'Q3', '00:00'),
    matchPayload('pipe-test-001', 'Home', 'Away', 23, 23,  'Q4', '10:00'),
    matchPayload('pipe-test-001', 'Home', 'Away', 23, 23,  'Q4', '00:00'),
  ];

  for (const p of payloads) {
    Metrics.recordInterception();
    Parser.parseResponse('https://test.com/Get1x2_VZip', p);
  }

  console.log(
    `[Test] After payloads – quarterState=${DB._getQuarterState('pipe-test-001')} persistedQuarters=[${DB._getPersistedQuarters('pipe-test-001').join(',')}]`,
  );

  // Now signal match end (quarter Q4 already reached)
  console.log('[Test] Triggering upsertMatch with FINISHED status');
  DB.upsertMatch({
    id: 'pipe-test-001',
    home_team: 'Home',
    away_team: 'Away',
    status: 'FINISHED',
  });

  console.log(
    `[Test] After finish – persistedQuarters=[${DB._getPersistedQuarters('pipe-test-001').join(',')}]`,
  );

  // ── Verify premature-finish BLOCK ─────────────────────────
  DB._resetQuarterTracking();

  const prematurePayloads = [
    matchPayload('block-test-001', 'H', 'A', 10, 8, 'Q1', '05:00'),
    matchPayload('block-test-001', 'H', 'A', 24, 18, 'Q2', '05:00'),
  ];
  for (const p of prematurePayloads) {
    Parser.parseResponse('https://test.com/Get1x2_VZip', p);
  }
  console.log(`[Test] block-test-001 at Q2, now trying upsertMatch FINISHED (should BLOCK)`);
  DB.upsertMatch({ id: 'block-test-001', home_team: 'H', away_team: 'A', status: 'FINISHED' });
  const blockedQuarters = DB._getPersistedQuarters('block-test-001');
  const hasFinal = blockedQuarters.includes('FINAL');
  console.log(`[Test] block-test-001 persistedQuarters=[${blockedQuarters.join(',')}] hasFinal=${hasFinal} ${hasFinal ? 'FAIL' : 'OK (blocked)'}`);

  // Keep sending Q3, Q4, then finish – should now get full chain
  Parser.parseResponse('https://test.com/Get1x2_VZip', matchPayload('block-test-001', 'H', 'A', 46, 41, 'Q3', '10:00'));
  Parser.parseResponse('https://test.com/Get1x2_VZip', matchPayload('block-test-001', 'H', 'A', 68, 61, 'Q4', '10:00'));
  DB.upsertMatch({ id: 'block-test-001', home_team: 'H', away_team: 'A', status: 'FINISHED' });
  const finalQuarters = DB._getPersistedQuarters('block-test-001');
  console.log(`[Test] block-test-001 after Q4+finish persistedQuarters=[${finalQuarters.join(',')}]`);
}

function printMetricsReport() {
  console.log('\n=== LIVE VALIDATION REPORT ===');
  console.log(`Total Intercepted Payloads:  ${Metrics.totalInterceptedPayloads}`);
  console.log(`Total Normalized Matches:    ${Metrics.totalNormalizedMatches}`);
  console.log(`Total QuarterSnapshot Inserts: ${Metrics.totalScoreInserts}`);
  console.log(`Duplicates Skipped:          ${Metrics.totalDuplicatesPrevented}`);
  console.log(`Failed Mutations:            ${Metrics.totalFailedMutations}`);
  console.log(`Retry Queue Size:            ${Metrics.retryQueueSize}`);
  console.log('==============================\n');
}

async function runQueriesTest() {
  console.log('\n--- Convex Query Test ---');
  try {
    const history = await client.query('queries:getMatchHistory');
    console.log(`getMatchHistory: ${history.length} matches`);
  } catch (e) {
    console.error('getMatchHistory: FAILED', e);
  }
  try {
    const qs = await client.query('queries:getQuarterScores', { matchId: MATCH_ID });
    console.log(`getQuarterScores: ${qs.length} snapshots`);
    for (const s of qs) {
      console.log(`  ${s.quarter}: ${s.homeScore}-${s.awayScore} (${s.snapshotType})`);
    }
  } catch (e) {
    console.error('getQuarterScores: FAILED', e);
  }
  try {
    const fs2 = await client.query('queries:getFinalScore', { matchId: MATCH_ID });
    console.log(`getFinalScore: ${JSON.stringify(fs2)}`);
  } catch (e) {
    console.error('getFinalScore: FAILED', e);
  }
  try {
    const diffs = await client.query('queries:getScoringDiffs', { matchId: MATCH_ID });
    console.log(`getScoringDiffs: ${JSON.stringify(diffs)}`);
  } catch (e) {
    console.error('getScoringDiffs: FAILED', e);
  }
}

async function main() {
  console.log('=== LIVE VALIDATION SCRIPT ===');

  initStorage(CONVEX_URL);

  await runConvexMutationTest();

  simulatePipelineProcessing();

  printMetricsReport();

  await runQueriesTest();

  console.log('\nLive validation complete.');
}

main().catch(console.error);
