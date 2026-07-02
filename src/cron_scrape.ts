import { config } from 'dotenv';
import fs from 'fs';

if (fs.existsSync('.env.local')) {
    config({ path: '.env.local' });
}
config();

import { initStorage } from './db';
import { Parser } from './parser';
import { Metrics } from './metrics';

const GET1X2_API = process.env.GET1X2_API_URL || 'https://mel-bet.et/service-api/LiveFeed/Get1x2_VZip';
const PARAMS = '?sports=3&count=80&lng=en&gr=882&mode=4&country=213&partner=8&getEmpty=true&virtualSports=true&noFilterBlockEvent=true';

function logItemStructure(item: any): void {
    const keys: string[] = [];
    for (const k of Object.keys(item)) {
        const v = item[k];
        const type = Array.isArray(v) ? `array[${v.length}]` : typeof v;
        keys.push(`${k}:${type}`);
    }
    console.log('[Cron] Raw item keys:', keys.join(', '));

    if (item.SC && typeof item.SC === 'object') {
        const scKeys = Object.keys(item.SC).map(k => `${k}:${typeof item.SC[k]}`);
        console.log('[Cron] SC keys:', scKeys.join(', '));
    }

    for (const k of Object.keys(item)) {
        const v = item[k];
        if (typeof v === 'number' && v > 1000000000) {
            console.log(`[Cron] Timestamp candidate: ${k}=${v} (date: ${new Date(v * 1000).toISOString()})`);
        }
    }
    if (item.SC && typeof item.SC.SD === 'number') {
        console.log(`[Cron] SC.SD=${item.SC.SD} (date: ${new Date(item.SC.SD * 1000).toISOString()})`);
    }

    // Dump full E structure for odds discovery
    if (item.E && Array.isArray(item.E)) {
        console.log(`[Cron] E array length: ${item.E.length}`);
        if (item.E.length > 0) {
            console.log('[Cron] E[0] keys:', Object.keys(item.E[0]).join(', '));
            console.log('[Cron] E[0] full:', JSON.stringify(item.E[0]));
        }
    } else {
        console.log('[Cron] No E array found — checking for odds-like fields...');
        for (const k of Object.keys(item)) {
            if (k.toLowerCase().includes('odd') || k.toLowerCase().includes('kf') || k.toLowerCase().includes('price') || k.toLowerCase().includes('coef')) {
                console.log(`[Cron] Odds candidate field: ${k}=${JSON.stringify(item[k]).substring(0, 200)}`);
            }
        }
    }
}

function normalizeResponse(body: string): string {
    let finalBody = '{}';
    try {
        const jsonObj = JSON.parse(body);
        if (jsonObj && jsonObj.Value && Array.isArray(jsonObj.Value)) {
            let matchCount = 0;
            let excludedCount = 0;
            const mappedValue = jsonObj.Value.flatMap((item: any) => {
                if (item.O1 && item.O2 && item.SC && item.SC.FS) {
                    const results: any[] = [];
                    if (item.SC.PS && Array.isArray(item.SC.PS)) {
                        const isBasketball = item.SC.PS.some((p: any) =>
                            (p.Value?.NF || '').toLowerCase().includes('quarter'),
                        );
                        if (isBasketball) {
                            const isCyber = (item.O1 && item.O1.toLowerCase().includes('(cyber)')) || (item.O2 && item.O2.toLowerCase().includes('(cyber)'));
                            const NBA_TEAMS = ['hawks', 'celtics', 'nets', 'hornets', 'bulls', 'cavaliers', 'mavericks', 'nuggets', 'pistons', 'warriors', 'rockets', 'pacers', 'clippers', 'lakers', 'grizzlies', 'heat', 'bucks', 'timberwolves', 'pelicans', 'knicks', 'thunder', 'magic', '76ers', 'sixers', 'suns', 'trail blazers', 'blazers', 'kings', 'spurs', 'raptors', 'jazz', 'wizards'];
                            const team1 = (item.O1 || '').toLowerCase();
                            const team2 = (item.O2 || '').toLowerCase();
                            const isNbaCyber = isCyber && NBA_TEAMS.some(t => team1.includes(t)) && NBA_TEAMS.some(t => team2.includes(t));
                            if (!isNbaCyber) {
                                excludedCount++;
                                return [];
                            }
                            matchCount++;

                            const odds: { home?: number; away?: number; over_under?: number } = {};
                            if (item.E && Array.isArray(item.E)) {
                                for (const m of item.E) {
                                    const typeId = m.T ?? m.Type ?? m.type ?? m.marketId;
                                    const coeff = m.C ?? m.coefficient ?? m.odd ?? m.price ?? m.value;
                                    const param = m.P ?? m.param ?? m.line ?? m.Parameter;
                                    console.log(`[Cron] Market: keys=${Object.keys(m).join(',')} T=${typeId} C=${coeff} P=${param}`);
                                    if (typeId != null && coeff != null) {
                                        const tid = Number(typeId);
                                        if (tid === 1) odds.home = Number(coeff);
                                        else if (tid === 2) odds.away = Number(coeff);
                                        else if (tid === 17) odds.over_under = param != null ? Number(param) : Number(coeff);
                                    }
                                }
                            } else {
                                for (const k of ['odds', 'kf', 'coefficients', 'prices', 'markets']) {
                                    if (item[k]) console.log(`[Cron] Odds in '${k}': ${JSON.stringify(item[k]).substring(0,300)}`);
                                }
                            }

                            for (const period of item.SC.PS) {
                                const pv = period.Value || {};
                                const periodName = pv.NF || `Quarter ${period.Key || 1}`;
                                results.push({
                                    ...item,
                                    id: item.I,
                                    home_team: item.O1,
                                    away_team: item.O2,
                                    home_score: pv.S1 ?? 0,
                                    away_score: pv.S2 ?? 0,
                                    quarter: periodName,
                                    clock: item.SC.SLS || '',
                                    status: 'LIVE',
                                    odds,
                                });
                            }
                            const hasAllQuarters = item.SC.PS.length >= 4;
                            if (item.F || hasAllQuarters) {
                                results.push({
                                    ...item,
                                    id: item.I,
                                    home_team: item.O1,
                                    away_team: item.O2,
                                    home_score: item.SC.FS.S1,
                                    away_score: item.SC.FS.S2,
                                    quarter: 'FT',
                                    clock: '0:00',
                                    status: 'FINISHED',
                                    odds,
                                });
                            }
                        } else {
                            excludedCount++;
                        }
                    }
                    return results;
                }
                return [];
            });
            if (excludedCount > 0) console.log(`[Cron] Excluded ${excludedCount} non-basketball matches`);
            if (matchCount > 0) {
                console.log(`[Cron] Cyber matches found: ${matchCount}`);
                logItemStructure(jsonObj.Value[0]);
            }
            finalBody = JSON.stringify({ ...jsonObj, Value: mappedValue });
        }
    } catch (e) {
        console.error('[Cron] Normalizer error:', e);
    }
    return finalBody;
}

async function run() {
    const convexUrl = process.env.CONVEX_URL;
    if (!convexUrl) {
        console.error('[Cron] CONVEX_URL not set');
        process.exit(1);
    }

    initStorage(convexUrl);
    console.log(`[Cron] Scrape started — Convex: ${convexUrl}`);

    try {
        const response = await fetch(GET1X2_API + PARAMS, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'https://mel-bet.et/',
                'Origin': 'https://mel-bet.et',
            },
            signal: AbortSignal.timeout(15000),
        });
        const body = await response.text();
        if (body && body.length > 2) {
            console.log(`[Cron] Fetched ${body.length} bytes`);
            const normalized = normalizeResponse(body);
            Parser.parseResponse('cron', normalized);
            Metrics.printSnapshot();
            console.log('[Cron] Done');
        } else {
            console.log('[Cron] Empty response');
        }
    } catch (e) {
        console.error('[Cron] Fetch error:', e);
    }

    // Allow queue to drain
    await new Promise(r => setTimeout(r, 5000));
    process.exit(0);
}

run().catch(e => {
    console.error('[Cron] Fatal:', e);
    process.exit(1);
});
