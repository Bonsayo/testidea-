import { chromium, Page } from 'playwright';
import { Parser } from './parser';
import { Metrics } from './metrics';

export class Extractor {
    private page: Page | null = null;
    private browser: any = null;
    private targetEndpoints: string[] = [];
    private discoveryMode: boolean = true;

    constructor() {
        const endpointsStr = process.env.TARGET_ENDPOINTS || '';
        this.targetEndpoints = endpointsStr.split(',').map(e => e.trim()).filter(e => e.length > 0);
        this.discoveryMode = process.env.DISCOVERY_MODE === 'true';
    }

    async start(url: string) {
        console.log(`Starting Extractor for URL: ${url}`);
        this.browser = await chromium.launch({ headless: true });

        const setupPage = async () => {
            this.page = await this.browser.newPage();

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
                            return; // Cannot inspect without body
                        }

                        

                        // 1. Decompression (Removed: Playwright automatically decompresses response bodies)
                        // payloadBuffer is already decompressed despite what content-encoding says.

                        // 2. Type Detection & Decoding
                        if (contentType.includes('application/json') || reqUrl.includes('Zip')) {
                            decodedString = payloadBuffer.toString('utf-8');
                            isDecoded = true;
                            try {
                                const jsonObj = JSON.parse(decodedString); // verify it's valid JSON
                                
                                // Specific logic for Get1x2_VZip
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
                            // Try to guess if it's text
                            const textProbe = payloadBuffer.toString('utf-8');
                            // simple heuristic for binary vs text
                            if (/[\x00-\x08\x0E-\x1F]/.test(textProbe.substring(0, 100))) {
                                decodedString = "[Unknown Binary] " + payloadBuffer.toString('hex').substring(0, 1000);
                            } else {
                                decodedString = "[Assumed Text] " + textProbe;
                                isDecoded = true;
                            }
                        }

                        // 3. Print Output
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

                // Normal Extraction Logic
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
                            // Can't read text, might be binary
                            return;
                        }
                    }
                    
                    if (this.discoveryMode && !isInspectionTarget) {
                        console.log(`[DISCOVERY] Intercepted: ${reqUrl} (${body.length} bytes)`);
                    }

                    // Feed to parser
                    // Since parser.ts expects 'home_team' and 'home_score', we must map Melbet's O1/O2 format 
                    // before feeding it in, because we were instructed to keep parser.ts unchanged.
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
                                            if (!isCyber) {
                                                excludedCount++;
                                                return [];
                                            }
                                            Metrics.recordNormalizedMatch();
                                            matchCount++;
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
                                                });
                                            }
                                            if (item.F) {
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

        const launchUrl = url;
        await setupPage();

        setInterval(async () => {
            console.log('[Extractor] Navigating to re-trigger API calls...');
            try {
                await this.page?.goto(launchUrl, { waitUntil: 'domcontentloaded' });
                console.log('[Extractor] Navigation successful.');
            } catch (e) {
                console.log('[Extractor] Navigation error, will retry on next interval.');
            }
        }, 120_000);
    }

    async stop() {
        if (this.browser) {
            await this.browser.close();
        }
    }
}
