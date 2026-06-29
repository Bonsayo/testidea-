import { Parser } from "./src/parser";
import { DB, initStorage } from "./src/db";
import dotenv from "dotenv";
import fs from "fs";

if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
} else {
  dotenv.config();
}

async function testRealPayload() {
    console.log("Initializing storage...");
    initStorage(process.env.CONVEX_URL || "");

    const payload = {
        "Id": 0,
        "Success": true,
        "Error": "",
        "ErrorCode": 0,
        "Guid": "",
        "Value": [
            {
                "R": 49,
                "SC": {
                    "FS": {
                        "S1": 68,
                        "S2": 61
                    },
                    "PS": [
                        { "Key": 1, "Value": { "S1": 36, "S2": 18, "NF": "1st quarter" } },
                        { "Key": 2, "Value": { "S1": 21, "S2": 31, "NF": "2nd quarter" } },
                        { "Key": 3, "Value": { "S1": 11, "S2": 12, "NF": "3rd quarter" } }
                    ],
                    "CP": 3,
                    "CPS": "3rd quarter",
                    "TS": 1892,
                    "TR": -1,
                    "I": "",
                    "SLS": "31 minutes"
                },
                "VI": "xgame7_53191695",
                "VA": 1,
                "HMH": 1,
                "U": 1782565593,
                "I": 732274075,
                "N": 255551,
                "T": 49,
                "CO": 17,
                "O1": "Detroit Pistons (cyber)",
                "O2": "Denver Nuggets (cyber)"
            }
        ]
    };

    const body = JSON.stringify(payload);
    
    // Normalization logic from extractor.ts
    let finalBody = body;
    try {
        const jsonObj = JSON.parse(body);
        if (jsonObj && jsonObj.Value && Array.isArray(jsonObj.Value)) {
            const mappedValue = jsonObj.Value.map((item: any) => {
                if (item.O1 && item.O2 && item.SC && item.SC.FS) {
                    return {
                        ...item,
                        id: item.I,
                        home_team: item.O1,
                        away_team: item.O2,
                        home_score: item.SC.FS.S1,
                        away_score: item.SC.FS.S2,
                        quarter: item.SC.CPS,
                        clock: item.SC.SLS,
                        status: 'LIVE'
                    };
                }
                return item;
            });
            finalBody = JSON.stringify({ ...jsonObj, Value: mappedValue });
        }
    } catch(e) {}

    console.log("Feeding mapped payload to Parser...");
    Parser.parseResponse("https://mel-bet.et/Get1x2_VZip", finalBody);

    // Wait a bit for async db insert to trigger log
    await new Promise(r => setTimeout(r, 2000));
    console.log("Done.");
}

testRealPayload();
