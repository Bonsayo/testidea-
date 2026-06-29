/**
 * Storage Adapter Layer
 * 
 * Abstracts all database logic behind a unified API.
 * The in-memory cache serves the synchronous read interface that parser.ts relies on.
 * The ConvexAdapter handles persistence to Convex backend.
 * 
 * To swap backends, replace ConvexAdapter with another implementation of StorageAdapter.
 */

import type { ConvexHttpClient as ConvexHttpClientType } from "convex/browser";
import { Metrics } from './metrics';

// ─── Domain Types ───────────────────────────────────────────

export interface Match {
    id: string;
    home_team: string;
    away_team: string;
    status: string;
    startedAt?: number;
}

export interface ScoreEvent {
    match_id: string;
    event_time: number;
    home_score: number;
    away_score: number;
    quarter?: string;
    remaining_clock?: string;
}

export interface OddsEvent {
    match_id: string;
    timestamp: number;
    home_odds: number;
    away_odds: number;
    over_under_line: number;
}

// ─── Quarter Snapshot Type ──────────────────────────────────

export interface QuarterSnapshot {
    matchId: string;
    quarter: string;
    homeScore: number;
    awayScore: number;
    timestamp: number;
    snapshotType: "quarter_end" | "final";
}

// ─── Storage Adapter Interface ──────────────────────────────

export interface StorageAdapter {
    persistMatch(match: Match, scores: ScoreEvent[]): Promise<void>;
    persistQuarterSnapshot(snapshot: QuarterSnapshot): Promise<void>;
    persistOddsEvent(event: OddsEvent): Promise<void>;
}

// ─── Convex Adapter ─────────────────────────────────────────

class ConvexAdapter implements StorageAdapter {
    private client: ConvexHttpClientType;
    private anyApi: any;
    private retryQueue: Array<() => Promise<void>> = [];
    private isProcessingQueue = false;

    constructor(convexUrl: string) {
        const { ConvexHttpClient } = require("convex/browser");
        const { anyApi } = require("convex/server");
        this.client = new ConvexHttpClient(convexUrl);
        this.anyApi = anyApi;

        setInterval(() => this.processQueue(), 5000);
    }

    private async enqueueMutation(mutationFn: () => Promise<void>) {
        this.retryQueue.push(mutationFn);
        Metrics.updateRetryQueueSize(this.retryQueue.length);
        this.processQueue();
    }

    private async processQueue() {
        if (this.isProcessingQueue || this.retryQueue.length === 0) return;
        this.isProcessingQueue = true;

        const currentQueue = [...this.retryQueue];
        this.retryQueue = [];
        Metrics.updateRetryQueueSize(this.retryQueue.length);

        for (const mutation of currentQueue) {
            const start = performance.now();
            try {
                await mutation();
                Metrics.recordMutationLatency(Math.round(performance.now() - start));
            } catch (err) {
                Metrics.recordFailedMutation();
                Metrics.recordMutationLatency(Math.round(performance.now() - start));
                console.error("[Storage] Mutation failed, requeuing...", err);
                this.retryQueue.push(mutation);
                Metrics.updateRetryQueueSize(this.retryQueue.length);
            }
        }

        this.isProcessingQueue = false;
    }

    async persistMatch(match: Match, scores: ScoreEvent[]): Promise<void> {
        let finishedAt: number | undefined;
        let finalHomeScore: number | undefined;
        let finalAwayScore: number | undefined;

        if (match.status === "FINISHED" || match.status === "COMPLETED") {
            finishedAt = Date.now();
            if (scores.length > 0) {
                const lastScore = scores[scores.length - 1]!;
                finalHomeScore = lastScore.home_score;
                finalAwayScore = lastScore.away_score;
            }
        }

        await this.enqueueMutation(async () => {
            await this.client.mutation(this.anyApi.mutations.saveMatch, {
                matchId: match.id,
                matchName: `${match.home_team} vs ${match.away_team}`,
                startedAt: match.startedAt ?? scores.length > 0 ? scores[0].event_time : Date.now(),
                finishedAt,
                finalHomeScore,
                finalAwayScore,
                apiKey: "try-pipeline-secret-2026",
            });
        });
    }

    async persistQuarterSnapshot(snapshot: QuarterSnapshot): Promise<void> {
        await this.enqueueMutation(async () => {
            const result: any = await this.client.mutation(
                this.anyApi.mutations.saveQuarterSnapshot,
                {
                    matchId: snapshot.matchId,
                    quarter: snapshot.quarter,
                    homeScore: snapshot.homeScore,
                    awayScore: snapshot.awayScore,
                    timestamp: snapshot.timestamp,
                    snapshotType: snapshot.snapshotType,
                },
            );
            if (result && result.inserted === false) {
                Metrics.recordDuplicatePrevented();
            } else {
                Metrics.recordScoreInsert();
            }
            console.log(
                `[QuarterSnapshot] ${snapshot.matchId} | ${snapshot.quarter} | ${snapshot.homeScore}-${snapshot.awayScore} | ${snapshot.snapshotType}`,
            );
        });
    }

    async persistOddsEvent(event: OddsEvent): Promise<void> {
        await this.enqueueMutation(async () => {
            await this.client.mutation(this.anyApi.mutations.saveOddsTimeline, {
                matchId: event.match_id,
                timestamp: event.timestamp,
                homeOdds: event.home_odds,
                awayOdds: event.away_odds,
            });
        });
    }
}

// ─── Null Adapter (no-op, for testing without a backend) ────

class NullAdapter implements StorageAdapter {
    async persistMatch(): Promise<void> {}
    async persistQuarterSnapshot(): Promise<void> {}
    async persistOddsEvent(): Promise<void> {}
}

// ═══════════════════════════════════════════════════════════════
//  Match State Machine – enforces strict quarter progression
//  LIVE → Q1 → Q2 → Q3 → Q4 → FINISHED
//
//  Rules:
//    • Quarters advance only forward (Q1→Q2→Q3→Q4).
//    • Backward / same-quarter payloads are ignored for storage.
//    • A FINAL snapshot is written ONLY when the state machine
//      has reached Q4 AND the payload explicitly marks the match
//      as FINISHED / COMPLETED.
//    • Any FINISHED signal received before Q4 is blocked and
//      logged – the in‑memory cache keeps ticking so quarters
//      can still be persisted once they arrive.
// ═══════════════════════════════════════════════════════════════

const VALID_QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'] as const;

/**
 * Normalize a raw quarter/period value from the Melbet feed to
 * a canonical form.  Handles common real‑world variants.
 */
function normalizeQuarter(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const s = raw.trim().toLowerCase();

    if (s === 'q1' || s === 'quarter 1' || s === '1st quarter' || s === '1st' || s === '1' || s === 'period 1') return 'Q1';
    if (s === 'q2' || s === 'quarter 2' || s === '2nd quarter' || s === '2nd' || s === '2' || s === 'period 2') return 'Q2';
    if (s === 'q3' || s === 'quarter 3' || s === '3rd quarter' || s === '3rd' || s === '3' || s === 'period 3') return 'Q3';
    if (s === 'q4' || s === 'quarter 4' || s === '4th quarter' || s === '4th' || s === '4' || s === 'period 4') return 'Q4';

    if (s === 'ht' || s === 'halftime' || s === 'half time' || s === 'half') return 'HT';
    if (s === 'ft' || s === 'full time' || s === 'fulltime' || s === 'match ended' || s === 'finished') return 'FT';

    return undefined;
}

// Per‑match state
const matchQuarterState: Record<string, string | undefined> = {};
const matchPersistedQuarters: Record<string, Set<string>> = {};
const matchFinalized: Record<string, boolean> = {};

// ─── In-Memory Cache + Unified DB API ───────────────────────

const matchScoresCache: Record<string, ScoreEvent[]> = {};
const matchOddsCache: Record<string, OddsEvent[]> = {};
const matchCache: Record<string, Match> = {};

let adapter: StorageAdapter = new NullAdapter();

/**
 * Initialize the storage adapter. Must be called before using DB operations
 * that need persistence. If not called, DB still works with in-memory cache only.
 */
export function initStorage(convexUrl?: string): void {
    if (convexUrl) {
        adapter = new ConvexAdapter(convexUrl);
        console.log(`[Storage] Convex adapter initialized → ${convexUrl}`);
    } else {
        adapter = new NullAdapter();
        console.log(`[Storage] No CONVEX_URL provided. Running with in-memory cache only.`);
    }
}

/**
 * Replace the storage adapter (useful for testing).
 */
export function setStorageAdapter(newAdapter: StorageAdapter): void {
    adapter = newAdapter;
}

// ─── Helpers ─────────────────────────────────────────────────

/** Find the last score in the cache that belongs to `quarter` (normalizes both sides). */
function lastScoreForQuarter(matchId: string, quarter: string): ScoreEvent | undefined {
    const scores = matchScoresCache[matchId];
    if (!scores) return undefined;
    for (let i = scores.length - 1; i >= 0; i--) {
        const raw = scores[i]!.quarter;
        if (!raw) continue;
        if (normalizeQuarter(raw) === quarter || raw === quarter) return scores[i];
    }
    return undefined;
}

/** Persist a quarter‑end snapshot – idempotent per (matchId, quarter). */
function persistQuarterEnd(matchId: string, quarter: string): void {
    // Guard: already persisted
    if (matchPersistedQuarters[matchId]?.has(quarter)) {
        console.log(`[StateMachine] ${matchId} | ${quarter} already persisted, skipped`);
        return;
    }

    const score = lastScoreForQuarter(matchId, quarter);
    // Fallback: use the very last score in cache
    const fallback = (matchScoresCache[matchId] ?? []).at(-1);

    if (!score && !fallback) {
        console.log(`[StateMachine] ${matchId} | cannot persist ${quarter}: no score data`);
        return;
    }

    const src = score ?? fallback!;
    const snapshot: QuarterSnapshot = {
        matchId,
        quarter,
        homeScore: src.home_score,
        awayScore: src.away_score,
        timestamp: src.event_time,
        snapshotType: "quarter_end",
    };

    adapter.persistQuarterSnapshot(snapshot).catch((err) =>
        console.error(`[Storage] Failed to persist quarter snapshot for ${matchId}:`, err),
    );

    if (!matchPersistedQuarters[matchId]) matchPersistedQuarters[matchId] = new Set();
    matchPersistedQuarters[matchId]!.add(quarter);
    console.log(`[StateMachine] ${matchId} | persisted ${quarter} snapshot: ${src.home_score}-${src.away_score}`);
}

/**
 * State‑machine transition handler.
 * Returns true when a quarter boundary was actually crossed.
 *
 * Understands these raw values (normalised internally):
 *   Q1‑Q4  → canonical quarter string
 *   HT     → half‑time (persists Q2 end, expects Q3 next)
 *   FT     → full‑time (persists last quarter + FINAL snapshot)
 */
function transitionQuarter(matchId: string, rawQuarter: string | undefined): boolean {
    const norm = normalizeQuarter(rawQuarter);

    if (!norm) {
        console.log(`[StateMachine] ${matchId} | ignoring unparseable quarter "${rawQuarter}"`);
        return false;
    }

    // ── FT (full time) → persist last quarter + FINAL ─────────
    if (norm === 'FT') {
        if (matchFinalized[matchId]) {
            console.log(`[StateMachine] ${matchId} | FT received but already finalized`);
            return false;
        }
        const current = matchQuarterState[matchId];
        const scores = matchScoresCache[matchId] ?? [];
        console.log(`[StateMachine] ${matchId} | FT detected, current=${current ?? '—'}, scores=${scores.length}`);

        if (scores.length > 0) {
            // Persist the last quarter we were in
            if (current && (VALID_QUARTERS as readonly string[]).includes(current)) {
                persistQuarterEnd(matchId, current);
            }
            // Always persist FINAL
            const final = scores[scores.length - 1]!;
            const snapshot: QuarterSnapshot = {
                matchId,
                quarter: 'FINAL',
                homeScore: final.home_score,
                awayScore: final.away_score,
                timestamp: Date.now(),
                snapshotType: 'final',
            };
            adapter.persistQuarterSnapshot(snapshot).catch((err) =>
                console.error(`[Storage] Failed to persist FINAL via FT for ${matchId}:`, err),
            );
            Metrics.recordScoreInsert();
            console.log(`[StateMachine] ${matchId} | FT → FINAL: ${final.home_score}-${final.away_score}`);
        }
        matchFinalized[matchId] = true;
        matchQuarterState[matchId] = 'FT';
        return true;
    }

    // ── HT (half time) → trigger Q2 end if applicable ────────
    if (norm === 'HT') {
        const current = matchQuarterState[matchId];
        if (current === 'Q2' || current === 'Q1') {
            console.log(`[StateMachine] ${matchId} | HT → persisting Q2 end`);
            persistQuarterEnd(matchId, 'Q2');
            matchQuarterState[matchId] = 'HT';
            return true;
        }
        console.log(`[StateMachine] ${matchId} | HT at ${current ?? '—'}, no action`);
        matchQuarterState[matchId] = 'HT';
        return false;
    }

    // ── Normal Q1‑Q4 progression ─────────────────────────────
    const current = matchQuarterState[matchId];

    // Coming from HT → treat as first quarter after half‑time
    if (current === 'HT') {
        console.log(`[StateMachine] ${matchId} | HT → ${norm}`);
        matchQuarterState[matchId] = norm;
        return true;
    }

    if (!current) {
        console.log(`[StateMachine] ${matchId} | LIVE → ${norm} (initial)`);
        matchQuarterState[matchId] = norm;
        return false;
    }

    const curIdx = VALID_QUARTERS.indexOf(current as typeof VALID_QUARTERS[number]);
    const newIdx = VALID_QUARTERS.indexOf(norm as typeof VALID_QUARTERS[number]);

    // If current is FT/HT/something not in VALID_QUARTERS, ignore stale quarters
    if (curIdx === -1) return false;

    if (newIdx > curIdx) {
        for (let i = curIdx; i < newIdx; i++) {
            const done = VALID_QUARTERS[i];
            console.log(`[StateMachine] ${matchId} | ${current} → ${norm} (completing ${done})`);
            persistQuarterEnd(matchId, done);
        }
        matchQuarterState[matchId] = norm;
        console.log(`[StateMachine] ${matchId} | state: ${current} → ${norm}`);
        return true;
    }

    if (newIdx === curIdx) return false;

    // Backward quarter — two scenarios:
    //
    // 1. No quarters persisted yet → initial‑sync batch (match was already live when
    //    first discovered). Reset state so the full Q1→Q2→Q3→Q4 chain runs.
    //
    // 2. Incoming quarter already persisted → replay from a new poll cycle.
    //    Reset state to the incoming quarter so the forward chain runs again;
    //    persistQuarterEnd skips already‑persisted quarters via its dedup check.
    if (!matchPersistedQuarters[matchId] || matchPersistedQuarters[matchId]!.size === 0) {
        console.log(`[StateMachine] ${matchId} | initial sync: resetting ${current} → ${norm}`);
        matchQuarterState[matchId] = norm;
        return false;
    }

    if (matchPersistedQuarters[matchId]!.has(norm)) {
        console.log(`[StateMachine] ${matchId} | replay detected: resetting ${current} → ${norm}`);
        matchQuarterState[matchId] = norm;
        return false;
    }

    console.log(`[StateMachine] ${matchId} | WARNING ignoring backward quarter ${current} → ${norm} (persisted=${matchPersistedQuarters[matchId]?.size ?? 0}, curIdx=${curIdx}, newIdx=${newIdx})`);
    return false;
}

export const DB = {
    upsertMatch(match: Match): void {
        matchCache[match.id] = match;
        const scores = matchScoresCache[match.id] ?? [];

        const isExplicitFinish = match.status === "FINISHED" || match.status === "COMPLETED";
        const quarter = matchQuarterState[match.id];
        const isAtQ4 = quarter === 'Q4';
        const alreadyFinalized = !!matchFinalized[match.id];

        console.log(
            `[StateMachine] ${match.id} | upsertMatch "${match.home_team} vs ${match.away_team}" status="${match.status}" quarter=${quarter ?? '—'} finalized=${alreadyFinalized}`,
        );

        // Skip if already finalized (e.g. by FT in transitionQuarter)
        if (alreadyFinalized) {
            adapter.persistMatch(match, scores).catch((err) =>
                console.error(`[Storage] Failed to persist match ${match.id}:`, err),
            );
            return;
        }

        // FT quarter state also means match is over
        const finishSignal = isExplicitFinish || quarter === 'FT';

        if (finishSignal) {
            if (!isAtQ4 && quarter !== 'FT') {
                console.log(
                    `[StateMachine] ${match.id} | BLOCKED: match marked ${match.status} at "${quarter ?? 'LIVE'}" but state machine has not reached Q4 yet`,
                );
            } else {
                console.log(`[StateMachine] ${match.id} | FINALIZING (Q4${quarter === 'FT' ? ' via FT' : ''} → FINISHED)`);

                if (scores.length > 0) {
                    persistQuarterEnd(match.id, 'Q4');

                    const final = scores[scores.length - 1]!;
                    const snapshot: QuarterSnapshot = {
                        matchId: match.id,
                        quarter: 'FINAL',
                        homeScore: final.home_score,
                        awayScore: final.away_score,
                        timestamp: Date.now(),
                        snapshotType: 'final',
                    };
                    adapter.persistQuarterSnapshot(snapshot).catch((err) =>
                        console.error(`[Storage] Failed to persist final snapshot for ${match.id}:`, err),
                    );
                    Metrics.recordScoreInsert();

                    console.log(`[StateMachine] ${match.id} | FINAL persisted: ${final.home_score}-${final.away_score}`);
                }
                matchFinalized[match.id] = true;
            }
        }

        adapter.persistMatch(match, scores).catch((err) =>
            console.error(`[Storage] Failed to persist match ${match.id}:`, err),
        );
    },

    insertScoreEvent(event: ScoreEvent): void {
        // 1. In-memory cache (always keep latest)
        if (!matchScoresCache[event.match_id]) {
            matchScoresCache[event.match_id] = [];
        }
        matchScoresCache[event.match_id]!.push(event);

        console.log(
            `[StateMachine] ${event.match_id} | scoreEvent quarter="${event.quarter ?? '—'}" score=${event.home_score}-${event.away_score}`,
        );

        // 2. Skip state machine if match is already finalized
        if (matchFinalized[event.match_id]) return;

        // 3. Continuity check
        Metrics.checkScoreContinuity({
            matchId: event.match_id,
            quarter: event.quarter,
            gameClock: event.remaining_clock,
            homeScore: event.home_score,
            awayScore: event.away_score,
            timestamp: event.event_time,
        });

        // 4. State machine – forward quarter progression
        transitionQuarter(event.match_id, event.quarter);
    },

    insertOddsEvent(event: OddsEvent): void {
        if (!matchOddsCache[event.match_id]) {
            matchOddsCache[event.match_id] = [];
        }
        matchOddsCache[event.match_id]!.push(event);

        adapter.persistOddsEvent(event).catch((err) =>
            console.error(`[Storage] Failed to persist odds event for ${event.match_id}:`, err),
        );
    },

    getMatchScores(matchId: string): ScoreEvent[] {
        return matchScoresCache[matchId] || [];
    },

    getMatchOdds(matchId: string): OddsEvent[] {
        return matchOddsCache[matchId] || [];
    },

    getMatch(matchId: string): Match | undefined {
        return matchCache[matchId];
    },

    getAllMatches(): Match[] {
        return Object.values(matchCache);
    },

    getLiveMatches(): Match[] {
        return Object.values(matchCache).filter(
            (m) => m.status !== 'FINISHED' && m.status !== 'COMPLETED',
        );
    },

    // Exposed for testing / debug
    _resetQuarterTracking(): void {
        for (const k of Object.keys(matchQuarterState)) delete matchQuarterState[k];
        for (const k of Object.keys(matchFinalized)) delete matchFinalized[k];
        for (const k of Object.keys(matchPersistedQuarters)) delete matchPersistedQuarters[k];
    },

    /** Read current state machine quarter for a match (debug). */
    _getQuarterState(matchId: string): string | undefined {
        return matchQuarterState[matchId];
    },

    /** Read persisted‑quarter set for a match (debug). */
    _getPersistedQuarters(matchId: string): string[] {
        return [...(matchPersistedQuarters[matchId] ?? [])];
    },
};
