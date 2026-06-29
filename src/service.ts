import { Extractor } from './extractor';
import { DB } from './db';
import { SignalEngine } from './signal_engine';

export class ServiceRunner {
    private extractor: Extractor;
    private targetUrl: string;
    private analysisInterval: NodeJS.Timeout | null = null;

    constructor() {
        this.extractor = new Extractor();
        this.targetUrl = process.env.TARGET_URL || 'https://example.com/sports/live';
    }

    async start() {
        console.log('--- Starting Cyber Basketball Service ---');
        console.log(`[Startup] TARGET_URL resolved to: ${this.targetUrl}`);
        
        // Start Analysis Loop
        this.startAnalysisLoop();

        // Start Extractor Loop
        let retryCount = 0;
        while (true) {
            try {
                await this.extractor.start(this.targetUrl);
                // Keep the process alive while extractor runs
                await new Promise(() => {}); 
            } catch (error) {
                console.error(`Extractor error: ${error}`);
                retryCount++;
                const backoff = Math.min(Math.pow(2, retryCount) * 1000, 60000); // Max 60s
                console.log(`Restarting in ${backoff}ms...`);
                await new Promise(r => setTimeout(r, backoff));
            }
        }
    }

    private startAnalysisLoop() {
        // Run signal engine periodically
        this.analysisInterval = setInterval(() => {
            this.runSignalEngine();
        }, 15000); // Every 15 seconds
    }

    private runSignalEngine() {
        // Get all live matches from in-memory cache
        const matches = DB.getLiveMatches();

        for (const match of matches) {
            const scores = DB.getMatchScores(match.id);
            const odds = DB.getMatchOdds(match.id);
            
            if (scores.length > 0 && odds.length > 0) {
                const signals = SignalEngine.evaluateMatch(scores, odds);
                console.log(`[SIGNAL] Match ${match.id} | Confidence: ${signals.pattern_confidence_score} | Anomaly: ${signals.anomaly_score} | Risk: ${signals.risk_score}`);
            }
        }
    }
}
