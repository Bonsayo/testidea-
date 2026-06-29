import { ScoreEvent, OddsEvent } from './db';

export class Analyzer {
    // Basic Statistical Math
    static calculateMean(values: number[]): number {
        if (values.length === 0) return 0;
        return values.reduce((a, b) => a + b, 0) / values.length;
    }

    static calculateVariance(values: number[], mean: number): number {
        if (values.length === 0) return 0;
        return values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
    }

    static calculateStandardDeviation(variance: number): number {
        return Math.sqrt(variance);
    }

    static calculateZScore(value: number, mean: number, stdDev: number): number {
        if (stdDev === 0) return 0;
        return (value - mean) / stdDev;
    }

    static calculateMovingAverage(values: number[], windowSize: number): number[] {
        let result = [];
        for (let i = 0; i < values.length; i++) {
            if (i < windowSize - 1) {
                result.push(0); // Not enough data points
                continue;
            }
            const window = values.slice(i - windowSize + 1, i + 1);
            result.push(this.calculateMean(window));
        }
        return result;
    }

    // Pattern Analysis Methods
    static detectStreaks(scores: ScoreEvent[]): { home_streak: number, away_streak: number } {
        let home_streak = 0;
        let away_streak = 0;
        let current_home_streak = 0;
        let current_away_streak = 0;
        
        let prev_home = 0;
        let prev_away = 0;

        for (const event of scores) {
            const home_diff = event.home_score - prev_home;
            const away_diff = event.away_score - prev_away;

            if (home_diff > 0 && away_diff === 0) {
                current_home_streak += home_diff;
                current_away_streak = 0;
                if (current_home_streak > home_streak) home_streak = current_home_streak;
            } else if (away_diff > 0 && home_diff === 0) {
                current_away_streak += away_diff;
                current_home_streak = 0;
                if (current_away_streak > away_streak) away_streak = current_away_streak;
            } else {
                // Both scored (unlikely in atomic events, but resets streaks if it happens)
                current_home_streak = 0;
                current_away_streak = 0;
            }

            prev_home = event.home_score;
            prev_away = event.away_score;
        }

        return { home_streak, away_streak };
    }

    static detectOddsAnomalies(odds: OddsEvent[]): number {
        if (odds.length < 5) return 0; // Need some baseline
        
        const homeOdds = odds.map(o => o.home_odds);
        const mean = this.calculateMean(homeOdds);
        const variance = this.calculateVariance(homeOdds, mean);
        const stdDev = this.calculateStandardDeviation(variance);

        let anomalyCount = 0;
        for (const odd of homeOdds) {
            const zScore = Math.abs(this.calculateZScore(odd, mean, stdDev));
            if (zScore > 2.5) { // Threshold for anomaly
                anomalyCount++;
            }
        }
        
        // Return ratio of anomalies (0 to 1)
        return anomalyCount / odds.length;
    }

    static detectCycles(scores: ScoreEvent[]): number {
        // A naive cycle detection: counting repeated sequence patterns 
        // e.g., +2 home, +2 away, +2 home, +2 away
        let cycles = 0;
        if (scores.length < 4) return 0;

        for (let i = 0; i < scores.length - 3; i++) {
            const diff1 = scores[i+1].home_score - scores[i].home_score;
            const diff2 = scores[i+2].away_score - scores[i+1].away_score;
            const diff3 = scores[i+3].home_score - scores[i+2].home_score;
            
            if (diff1 > 0 && diff2 > 0 && diff1 === diff3) {
                cycles++;
            }
        }
        return cycles > 5 ? 1 : cycles / 5; // Cap at 1
    }
}
