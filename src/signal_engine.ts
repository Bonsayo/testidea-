import { Analyzer } from './analyzer';
import { ScoreEvent, OddsEvent } from './db';

export interface SignalScores {
    pattern_confidence_score: number;
    anomaly_score: number;
    risk_score: number;
}

export class SignalEngine {
    
    /**
     * Evaluates a match timeline and calculates actionable signals.
     */
    static evaluateMatch(scores: ScoreEvent[], odds: OddsEvent[]): SignalScores {
        let pattern_confidence_score = 0;
        let anomaly_score = 0;
        let risk_score = 0;

        // 1. Calculate Anomaly Score (0-100)
        // Base it on odds anomalies and unusual score clusters
        const oddsAnomalyRatio = Analyzer.detectOddsAnomalies(odds);
        
        let scoreAnomalies = 0;
        if (scores.length > 5) {
            const homeScores = scores.map(s => s.home_score);
            const meanScore = Analyzer.calculateMean(homeScores);
            const varianceScore = Analyzer.calculateVariance(homeScores, meanScore);
            const stdDevScore = Analyzer.calculateStandardDeviation(varianceScore);
            
            // Check latest score against moving baseline
            const currentScore = homeScores[homeScores.length - 1];
            const zScore = Math.abs(Analyzer.calculateZScore(currentScore, meanScore, stdDevScore));
            if (zScore > 2) {
                scoreAnomalies += 0.5; // High jump in points compared to average
            }
        }
        
        anomaly_score = Math.min(100, Math.round((oddsAnomalyRatio * 100) + (scoreAnomalies * 20)));

        // 2. Calculate Pattern Confidence Score (0-100)
        // Based on detected cycles and streaks
        const cycleRatio = Analyzer.detectCycles(scores);
        const { home_streak, away_streak } = Analyzer.detectStreaks(scores);
        
        let streakConfidence = 0;
        if (home_streak >= 10 || away_streak >= 10) {
            streakConfidence = 30; // Strong streak pattern
        } else if (home_streak >= 5 || away_streak >= 5) {
            streakConfidence = 15;
        }

        pattern_confidence_score = Math.min(100, Math.round((cycleRatio * 70) + streakConfidence));

        // 3. Calculate Risk Score (0-100)
        // High risk if there's both high anomaly and strong patterns detected
        risk_score = Math.round((anomaly_score * 0.6) + (pattern_confidence_score * 0.4));

        return {
            pattern_confidence_score,
            anomaly_score,
            risk_score
        };
    }
}
