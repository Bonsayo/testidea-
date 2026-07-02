import { chromium, Page } from 'playwright';
import { Parser } from './parser';
import { Metrics } from './metrics';

export class Extractor {
    private page: Page | null = null;
    private browser: any = null;
    private targetEndpoints: string[] = [];
    private discoveryMode: boolean = true;
    private readonly get1x2Api: string;

    constructor() {
        const endpointsStr = process.env.TARGET_ENDPOINTS || '';
        this.targetEndpoints = endpointsStr.split(',').map(e => e.trim()).filter(e => e.length > 0);
        this.discoveryMode = process.env.DISCOVERY_MODE === 'true';
        this.get1x2Api = process.env.GET1X2_API_URL || 'https://mel-bet.et/service-api/LiveFeed/Get1x2_VZip';
    }

    private processMelbetResponse(body: string, source: string) {
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
                                Metrics.recordNormalizedMatch();
                                matchCount++;

                                // Extract odds from MelBet format
                                const odds: { home?: number; away?: number; over_under?: number } = {};
                                if (item.E && Array.isArray(item.E)) {
                                    for (const m of item.E) {
                                        const typeId = m.T ?? m.Type ?? m.type ?? m.marketId;
                                        const coeff = m.C ?? m.coefficient ?? m.odd ?? m.price ?? m.value;
                                        const param = m.P ?? m.param ?? m.line ?? m.Parameter;
                                        console.log(`[OddsDebug] Market keys=${Object.keys(m).join(',')} T=${typeId} C=${coeff} P=${param}`);
                                        if (typeId != null && coeff != null) {
                                            const tid = Number(typeId);
                                            if (tid === 1) odds.home = Number(coeff);
                                            else if (tid === 2) odds.away = Number(coeff);
                                            else if (tid === 17) odds.over_under = param != null ? Number(param) : Number(coeff);
                                        }
                                    }
                                } else {
                                    for (const k of ['odds', 'kf', 'coefficients', 'prices', 'markets']) {
                                        if (item[k]) console.log(`[OddsDebug] Odds in '${k}': ${JSON.stringify(item[k]).substring(0,300)}`);
                                    }
                                }
                                if (odds.home != null || odds.away != null) {
                                    console.log(`[Odds] ${item.I} | home=${odds.home} away=${odds.away} ou=${odds.over_under}`);
                                } else {
                                    console.log(`[OddsDebug] No odds extracted for match ${item.I}`);
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
                        if (results.length > 0) return results;
                        return [];
                    }
                    return [];
                });
                if (excludedCount > 0) console.log(`[${source}] Excluded ${excludedCount} non-basketball matches`);
                if (matchCount > 0) console.log(`[${source}] Cyber matches found: ${matchCount}`);
                finalBody = JSON.stringify({ ...jsonObj, Value: mappedValue });
            }
        } catch(e) {
            console.error(`[${source}] Normalizer error:`, e);
        }
        Parser.parseResponse(source, finalBody);
    }

    private async pollApi() {
        const params = '?sports=3&champs=2935701&count=80&lng=en&gr=882&mode=4&country=213&partner=8&getEmpty=true&virtualSports=true&noFilterBlockEvent=true';
        try {
            const response = await fetch(this.get1x2Api + params, {
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
                console.log(`[DIRECT_API] Fetched ${body.length} bytes from Get1x2_VZip`);
                await this.processMelbetResponse(body, 'DIRECT_API');
            }
        } catch (e) {
            console.error('[DIRECT_API] Poll error:', e);
        }
    }

    async start(url: string) {
        console.log(`Starting Extractor for URL: ${url}`);

        // Start direct API polling FIRST (doesn't need browser — works on Railway)
        console.log('[Extractor] Starting direct API polling...');
        await this.pollApi();
        setInterval(() => this.pollApi(), 15_000);

        // Launch browser for interception (best-effort, can fail on Railway)
        try {
            this.browser = await chromium.launch({
                headless: true,
                executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
            });

            const context = await this.browser.newContext({
                locale: 'en-ET',
                timezoneId: 'Africa/Addis_Ababa',
                geolocation: { latitude: 9.0320, longitude: 38.7469 },
                permissions: ['geolocation'],
            });

            const setupPage = async () => {
                this.page = await context.newPage();

                this.page.on('crash', async () => {
                    console.log('[Extractor] Page crashed! Recreating...');
                    try { await this.page?.close(); } catch (_) {}
                    await setupPage();
                });

                this.page.on('response', async (response) => {
                const reqUrl = response.url();

                // Filter by resource type (only XHR/fetch)
                if (response.request().resourceType() === 'xhr' || response.request().resourceType() === 'fetch') {
                    Metrics.recordInterception();

                    // Payload Inspection Logic
                    const inspectionEndpoints = ['GetSportsShortZip', 'Get1x2_VZip', 'GetTopGamesStatZip', 'sys-welcome-app-front', 'sys-office-app-front', 'sys-platform-apps-front', 'fatman-api', 'service-api/games'];
                    const isInspectionTarget = inspectionEndpoints.some(ep => reqUrl.includes(ep));

                    let decodedString = '';
                    let isDecoded = false;

                    if (isInspectionTarget) {
                        try {
                            const headers = response.headers();
                            const contentType = headers['content-type'] || 'unknown';
                            const contentEncoding = headers['content-encoding'] || 'none';

                            let payloadBuffer: Buffer;
                            try {
                                payloadBuffer = await response.body();
                            } catch (e) {
                                console.log(`[INSPECTION] Failed to read body for ${reqUrl}: ${e}`);
                                return;
                            }

                            // Type Detection & Decoding
                            if (contentType.includes('application/json') || reqUrl.includes('Zip')) {
                                decodedString = payloadBuffer.toString('utf-8');
                                isDecoded = true;
                                try {
                                    const jsonObj = JSON.parse(decodedString);

                                    if (reqUrl.includes('Get1x2_VZip') && jsonObj.Value && jsonObj.Value.length > 0) {
                                        console.log(`\n==================================================`);
                                        console.log(`ENDPOINT: Get1x2_VZip FULL MATCH OBJECT`);
                                        console.log(JSON.stringify(jsonObj.Value[0], null, 2));
                                        console.log(`==================================================\n`);
                                    }
                                } catch {
                                    decodedString = "[Attempted JSON parse failed] " + decodedString;
                                }
                            } else if (contentType.includes('application/protobuf') || contentType.includes('application/x-protobuf')) {
                                decodedString = "[Protobuf Binary] " + payloadBuffer.toString('hex').substring(0, 1000);
                            } else {
                                const textProbe = payloadBuffer.toString('utf-8');
                                if (/[\x00-\x08\x0E-\x1F]/.test(textProbe.substring(0, 100))) {
                                    decodedString = "[Unknown Binary] " + payloadBuffer.toString('hex').substring(0, 1000);
                                } else {
                                    decodedString = "[Assumed Text] " + textProbe;
                                    isDecoded = true;
                                }
                            }

                            console.log(`\n==================================================`);
                            console.log(`ENDPOINT: ${inspectionEndpoints.find(ep => reqUrl.includes(ep)) || reqUrl}`);
                            console.log(`Content-Type: ${contentType}`);
                            console.log(`Encoding: ${contentEncoding}`);
                            console.log(`\nDecoded Payload Sample:`);
                            console.log(decodedString.substring(0, 1000));
                            if (decodedString.length > 1000) console.log('... [truncated]');
                            console.log(`==================================================\n`);

                        } catch (e) {
                            console.error(`[INSPECTION ERROR] ${reqUrl}: ${e}`);
                        }
                    }

                    if (!this.discoveryMode && this.targetEndpoints.length > 0) {
                        const matches = this.targetEndpoints.some(ep => reqUrl.includes(ep));
                        if (!matches) return;
                    }

                    try {
                        let body = '';
                        if (isInspectionTarget && isDecoded) {
                            body = decodedString;
                        } else {
                            try {
                                body = await response.text();
                            } catch (e) {
                                return;
                            }
                        }

                        if (this.discoveryMode && !isInspectionTarget) {
                            console.log(`[DISCOVERY] Intercepted: ${reqUrl} (${body.length} bytes)`);
                        }

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
                                                Metrics.recordNormalizedMatch();
                                                matchCount++;

                                                const odds: { home?: number; away?: number; over_under?: number } = {};
                                                if (item.E && Array.isArray(item.E)) {
                                                    for (const m of item.E) {
                                                        const typeId = m.T ?? m.Type ?? m.type ?? m.marketId;
                                                        const coeff = m.C ?? m.coefficient ?? m.odd ?? m.price ?? m.value;
                                                        const param = m.P ?? m.param ?? m.line ?? m.Parameter;
                                                        console.log(`[OddsDebug] Market keys=${Object.keys(m).join(',')} T=${typeId} C=${coeff} P=${param}`);
                                                        if (typeId != null && coeff != null) {
                                                            const tid = Number(typeId);
                                                            if (tid === 1) odds.home = Number(coeff);
                                                            else if (tid === 2) odds.away = Number(coeff);
                                                            else if (tid === 17) odds.over_under = param != null ? Number(param) : Number(coeff);
                                                        }
                                                    }
                                                } else {
                                                    for (const k of ['odds', 'kf', 'coefficients', 'prices', 'markets']) {
                                                        if (item[k]) console.log(`[OddsDebug] Odds in '${k}': ${JSON.stringify(item[k]).substring(0,300)}`);
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
                                        if (results.length > 0) return results;
                                        return [];
                                    }
                                    return [];
                                });
                                if (excludedCount > 0) console.log(`[DEBUG] Excluded ${excludedCount} non-basketball matches`);
                                finalBody = JSON.stringify({ ...jsonObj, Value: mappedValue });
                                if (isInspectionTarget) {
                                    console.log(`[DEBUG] Array size: ${jsonObj.Value.length}, Normalized items: ${matchCount}`);
                                }
                            }
                        } catch(e) {
                            console.error(`[DEBUG] Normalizer error:`, e);
                        }

                        Parser.parseResponse(reqUrl, finalBody);

                    } catch (e) {
                        // Ignore errors
                    }
                }
            });

                try {
                    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
                    console.log('Page loaded, listening for live events...');
                } catch (e) {
                    console.log('Page goto timeout/error (normal for live sites), continuing interception...');
                }
            };

            await setupPage();

            setInterval(async () => {
                console.log('[Extractor] Navigating to re-trigger API calls...');
                try {
                    await this.page?.goto(url, { waitUntil: 'domcontentloaded' });
                    console.log('[Extractor] Navigation successful.');
                } catch (e) {
                    console.log('[Extractor] Navigation error, will retry on next interval.');
                }
            }, 120_000);

        } catch (e) {
            console.log(`[Extractor] Browser setup failed (non-critical — direct polling active): ${e}`);
        }

        // Keep the process alive
        await new Promise(() => {});
    }

    async stop() {
        if (this.browser) {
            await this.browser.close();
        }
    }
}
