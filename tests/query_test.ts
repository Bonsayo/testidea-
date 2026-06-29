import { ConvexHttpClient } from "convex/browser";
import dotenv from "dotenv";
import fs from "fs";

if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
} else {
  dotenv.config();
}

const client = new ConvexHttpClient(process.env.CONVEX_URL || "");

async function runQueryTest() {
  console.log("=== QUERY TEST SCRIPT ===");
  try {
    const MATCH_ID = "test-match-123";

    console.log("\nTesting getMatchHistory...");
    const history = await client.query("queries:getMatchHistory");
    console.log(JSON.stringify(history.slice(0, 1), null, 2));

    console.log("\nTesting getQuarterScores...");
    const quarterScores = await client.query("queries:getQuarterScores", { matchId: MATCH_ID });
    console.log(JSON.stringify(quarterScores, null, 2));

    console.log("\nTesting getFinalScore...");
    const finalScore = await client.query("queries:getFinalScore", { matchId: MATCH_ID });
    console.log(JSON.stringify(finalScore, null, 2));

    console.log("\nTesting getScoringDiffs...");
    const diffs = await client.query("queries:getScoringDiffs", { matchId: MATCH_ID });
    console.log(JSON.stringify(diffs, null, 2));

    console.log("\nTesting getFinalScores...");
    const finalScores = await client.query("queries:getFinalScores");
    console.log(JSON.stringify(finalScores.slice(0, 1), null, 2));

    console.log("\nTesting getOddsHistory...");
    const oddsHistory = await client.query("queries:getOddsHistory", { matchId: MATCH_ID });
    console.log(JSON.stringify(oddsHistory.slice(-1), null, 2));

    console.log("\nAll queries completed successfully.");
  } catch (error) {
    console.error("Query test failed:", error);
  }
}

runQueryTest();
