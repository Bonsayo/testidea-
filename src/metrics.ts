/**
 * Runtime Metrics for Burn-In Validation
 * 
 * Centralized counters and latency tracking for the live pipeline.
 * All metrics are updated atomically from the extractor, parser, and adapter layers.
 * Periodically printed to console by the burn-in runner.
 */

export interface ScoreState {
    matchId: string;
    quarter?: string;
    gameClock?: string;
    homeScore: number;
    awayScore: number;
    timestamp: number;
}

export interface ScoreJumpAlert {
    matchId: string;
    from: ScoreState;
    to: ScoreState;
    homeDelta: number;
    awayDelta: number;
    reason: string;
}

// Maximum expected score change between consecutive timeline rows.
// Basketball: a single possession scores at most 4 points (3pt + foul free throw).
// We set a generous threshold per side to account for rapid polling gaps.
const MAX_EXPECTED_SCORE_DELTA = 6;

class MetricsCollector {
    // ── Counters ──────────────────────────────────────────────
    totalInterceptedPayloads = 0;
    totalNormalizedMatches = 0;
    totalScoreInserts = 0;
    totalDuplicatesPrevented = 0;
    totalFailedMutations = 0;
    retryQueueSize = 0;

    // ── Latency tracking ──────────────────────────────────────
    private mutationLatencies: number[] = [];

    // ── Score continuity ──────────────────────────────────────
    private lastScoreState: Record<string, ScoreState> = {};
    scoreJumpAlerts: ScoreJumpAlert[] = [];

    // ── Session timing ────────────────────────────────────────
    readonly sessionStartedAt = Date.now();

    // ── Methods ───────────────────────────────────────────────

    recordInterception(): void {
        this.totalInterceptedPayloads++;
    }

    recordNormalizedMatch(): void {
        this.totalNormalizedMatches++;
    }

    recordScoreInsert(): void {
        this.totalScoreInserts++;
    }

    recordDuplicatePrevented(): void {
        this.totalDuplicatesPrevented++;
    }

    recordFailedMutation(): void {
        this.totalFailedMutations++;
    }

    updateRetryQueueSize(size: number): void {
        this.retryQueueSize = size;
    }

    recordMutationLatency(ms: number): void {
        this.mutationLatencies.push(ms);
        // Keep only last 500 to avoid memory leak
        if (this.mutationLatencies.length > 500) {
            this.mutationLatencies = this.mutationLatencies.slice(-500);
        }
    }

    getAverageLatency(): number {
        if (this.mutationLatencies.length === 0) return 0;
        const sum = this.mutationLatencies.reduce((a, b) => a + b, 0);
        return Math.round(sum / this.mutationLatencies.length);
    }

    getP95Latency(): number {
        if (this.mutationLatencies.length === 0) return 0;
        const sorted = [...this.mutationLatencies].sort((a, b) => a - b);
        const idx = Math.floor(sorted.length * 0.95);
        return sorted[Math.min(idx, sorted.length - 1)];
    }

    /**
     * Check a new score state against the last known state for that match.
     * If the delta exceeds MAX_EXPECTED_SCORE_DELTA on either side, flag it.
     */
    checkScoreContinuity(state: ScoreState): void {
        const prev = this.lastScoreState[state.matchId];
        
        if (prev) {
            const homeDelta = state.homeScore - prev.homeScore;
            const awayDelta = state.awayScore - prev.awayScore;

            // Only flag if scores went UP (not a quarter reset or correction)
            if (homeDelta > MAX_EXPECTED_SCORE_DELTA || awayDelta > MAX_EXPECTED_SCORE_DELTA) {
                const alert: ScoreJumpAlert = {
                    matchId: state.matchId,
                    from: { ...prev },
                    to: { ...state },
                    homeDelta,
                    awayDelta,
                    reason: homeDelta > MAX_EXPECTED_SCORE_DELTA && awayDelta > MAX_EXPECTED_SCORE_DELTA
                        ? `Both sides jumped: home +${homeDelta}, away +${awayDelta}`
                        : homeDelta > MAX_EXPECTED_SCORE_DELTA
                            ? `Home score jumped by +${homeDelta}`
                            : `Away score jumped by +${awayDelta}`,
                };
                this.scoreJumpAlerts.push(alert);
                console.warn(`\n⚠️  [SCORE JUMP] Match ${state.matchId}: ${prev.homeScore}-${prev.awayScore} → ${state.homeScore}-${state.awayScore} | ${alert.reason}`);
            }
        }

        this.lastScoreState[state.matchId] = { ...state };
    }

    /** Elapsed session time in human-readable form */
    getElapsedTime(): string {
        const elapsed = Date.now() - this.sessionStartedAt;
        const mins = Math.floor(elapsed / 60000);
        const secs = Math.floor((elapsed % 60000) / 1000);
        return `${mins}m ${secs}s`;
    }

    /** Print a formatted metrics snapshot to console */
    printSnapshot(): void {
        const elapsed = this.getElapsedTime();
        const avgLat = this.getAverageLatency();
        const p95Lat = this.getP95Latency();

        console.log(`
╔══════════════════════════════════════════════════╗
║            BURN-IN METRICS SNAPSHOT              ║
╠══════════════════════════════════════════════════╣
║  Session Uptime:          ${elapsed.padStart(12)}       ║
║  Intercepted Payloads:    ${String(this.totalInterceptedPayloads).padStart(12)}       ║
║  Normalized Matches:      ${String(this.totalNormalizedMatches).padStart(12)}       ║
║  Score Inserts:           ${String(this.totalScoreInserts).padStart(12)}       ║
║  Duplicates Prevented:    ${String(this.totalDuplicatesPrevented).padStart(12)}       ║
║  Failed Mutations:        ${String(this.totalFailedMutations).padStart(12)}       ║
║  Retry Queue Size:        ${String(this.retryQueueSize).padStart(12)}       ║
║  Avg Mutation Latency:    ${(avgLat + 'ms').padStart(12)}       ║
║  P95 Mutation Latency:    ${(p95Lat + 'ms').padStart(12)}       ║
║  Score Jump Alerts:       ${String(this.scoreJumpAlerts.length).padStart(12)}       ║
╚══════════════════════════════════════════════════╝`);

        if (this.scoreJumpAlerts.length > 0) {
            console.log(`\n  Recent Score Jump Alerts:`);
            // Show last 5 alerts
            const recent = this.scoreJumpAlerts.slice(-5);
            for (const a of recent) {
                console.log(`    Match ${a.matchId}: ${a.from.homeScore}-${a.from.awayScore} → ${a.to.homeScore}-${a.to.awayScore} (${a.reason})`);
            }
        }
    }
}

/** Singleton metrics instance shared across the entire application */
export const Metrics = new MetricsCollector();
