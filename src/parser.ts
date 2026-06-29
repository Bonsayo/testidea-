import { DB, Match, ScoreEvent, OddsEvent } from './db';

export class Parser {
    
    static parseResponse(url: string, body: string) {
        try {
            const data = JSON.parse(body);
            this.recursiveFindMatches(data);
        } catch (e) {
            // Not a JSON response or unparseable, ignore
        }
    }

    private static recursiveFindMatches(obj: any) {
        if (!obj || typeof obj !== 'object') return;

        // Heuristic detection of a match object
        if (this.looksLikeMatch(obj)) {
            const matchId = String(obj.id || obj.match_id || obj.fixture_id);
            if (!matchId) return;

            const match: Match = {
                id: matchId,
                home_team: obj.home_team || obj.home?.name || 'Unknown Home',
                away_team: obj.away_team || obj.away?.name || 'Unknown Away',
                status: obj.status || obj.match_status || 'LIVE',
                startedAt: obj.U ? obj.U * 1000 : undefined,
            };

            DB.upsertMatch(match);

            // Extract Score
            if (obj.home_score !== undefined && obj.away_score !== undefined) {
                const scoreEvent: ScoreEvent = {
                    match_id: match.id,
                    event_time: obj.U ? obj.U * 1000 : Date.now(),
                    home_score: Number(obj.home_score),
                    away_score: Number(obj.away_score),
                    quarter: obj.quarter || obj.period,
                    remaining_clock: obj.clock || obj.remaining_time
                };

                // Only insert if score changed or it's the first time
                const history = DB.getMatchScores(match.id);
                if (history.length === 0 || 
                    history[history.length - 1].home_score !== scoreEvent.home_score || 
                    history[history.length - 1].away_score !== scoreEvent.away_score) {
                    DB.insertScoreEvent(scoreEvent);
                }
            }

            // Extract Odds
            if (obj.odds && obj.odds.home && obj.odds.away && obj.odds.over_under) {
                const oddsEvent: OddsEvent = {
                    match_id: match.id,
                    timestamp: Date.now(),
                    home_odds: Number(obj.odds.home),
                    away_odds: Number(obj.odds.away),
                    over_under_line: Number(obj.odds.over_under)
                };
                
                // Only insert if odds changed
                const oddsHistory = DB.getMatchOdds(match.id);
                if (oddsHistory.length === 0 || 
                    oddsHistory[oddsHistory.length - 1].home_odds !== oddsEvent.home_odds || 
                    oddsHistory[oddsHistory.length - 1].away_odds !== oddsEvent.away_odds ||
                    oddsHistory[oddsHistory.length - 1].over_under_line !== oddsEvent.over_under_line) {
                    DB.insertOddsEvent(oddsEvent);
                }
            }
        }

        // Recursively search children
        if (Array.isArray(obj)) {
            for (const item of obj) {
                this.recursiveFindMatches(item);
            }
        } else {
            for (const key of Object.keys(obj)) {
                this.recursiveFindMatches(obj[key]);
            }
        }
    }

    private static looksLikeMatch(obj: any): boolean {
        return (obj.hasOwnProperty('home_team') || obj.hasOwnProperty('home')) &&
               (obj.hasOwnProperty('away_team') || obj.hasOwnProperty('away')) &&
               (obj.hasOwnProperty('home_score') || obj.hasOwnProperty('score'));
    }
}
