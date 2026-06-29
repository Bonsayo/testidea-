import { ConvexHttpClient } from "convex/browser";
import dotenv from "dotenv";
import fs from "fs";

if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
} else {
  dotenv.config();
}

const client = new ConvexHttpClient(process.env.CONVEX_URL || "");

const MATCH_ID = "runtime-val-test-" + Date.now();

async function runValidation() {
  console.log("=== RUNTIME VALIDATION SCRIPT ===");
  console.log(`Using Convex URL: ${process.env.CONVEX_URL}`);

  try {
    // 1. Mutation Validation
    console.log("\n--- Running Mutations ---");

    await client.mutation("mutations:saveMatch", {
      matchId: MATCH_ID,
      matchName: "Runtime Validation Test",
      startedAt: Date.now(),
    });
    console.log("saveMatch: Success");

    // Simulate quarter 1 end
    const q1Result: any = await client.mutation("mutations:saveQuarterSnapshot", {
      matchId: MATCH_ID,
      quarter: "Q1",
      homeScore: 24,
      awayScore: 18,
      timestamp: Date.now(),
      snapshotType: "quarter_end",
    });
    console.log(`saveQuarterSnapshot Q1: ${q1Result.inserted ? "inserted" : "updated"}`);

    // Simulate quarter 2 end
    const q2Result: any = await client.mutation("mutations:saveQuarterSnapshot", {
      matchId: MATCH_ID,
      quarter: "Q2",
      homeScore: 46,
      awayScore: 41,
      timestamp: Date.now(),
      snapshotType: "quarter_end",
    });
    console.log(`saveQuarterSnapshot Q2: ${q2Result.inserted ? "inserted" : "updated"}`);

    // Simulate quarter 3 end
    const q3Result: any = await client.mutation("mutations:saveQuarterSnapshot", {
      matchId: MATCH_ID,
      quarter: "Q3",
      homeScore: 68,
      awayScore: 61,
      timestamp: Date.now(),
      snapshotType: "quarter_end",
    });
    console.log(`saveQuarterSnapshot Q3: ${q3Result.inserted ? "inserted" : "updated"}`);

    // Simulate quarter 4 end (final)
    const q4Result: any = await client.mutation("mutations:saveQuarterSnapshot", {
      matchId: MATCH_ID,
      quarter: "Q4",
      homeScore: 91,
      awayScore: 84,
      timestamp: Date.now(),
      snapshotType: "quarter_end",
    });
    console.log(`saveQuarterSnapshot Q4: ${q4Result.inserted ? "inserted" : "updated"}`);

    // Final snapshot
    const finalResult: any = await client.mutation("mutations:saveQuarterSnapshot", {
      matchId: MATCH_ID,
      quarter: "FINAL",
      homeScore: 91,
      awayScore: 84,
      timestamp: Date.now(),
      snapshotType: "final",
    });
    console.log(`saveQuarterSnapshot FINAL: ${finalResult.inserted ? "inserted" : "updated"}`);

    // Update match with final scores
    await client.mutation("mutations:saveMatch", {
      matchId: MATCH_ID,
      matchName: "Runtime Validation Test",
      startedAt: Date.now() - 3600000,
      finishedAt: Date.now(),
      finalHomeScore: 91,
      finalAwayScore: 84,
    });
    console.log("saveMatch (finalized): Success");

    await client.mutation("mutations:saveOddsTimeline", {
      matchId: MATCH_ID,
      timestamp: Date.now(),
      homeOdds: 1.5,
      awayOdds: 2.5,
    });
    console.log("saveOddsTimeline: Success");

    // 2. Query Validation
    console.log("\n--- Running Queries ---");

    const history = await client.query("queries:getMatchHistory");
    console.log("getMatchHistory:");
    console.log(JSON.stringify(history.slice(0, 1), null, 2));

    const quarterScores = await client.query("queries:getQuarterScores", { matchId: MATCH_ID });
    console.log("getQuarterScores:");
    console.log(JSON.stringify(quarterScores, null, 2));

    const finalScore = await client.query("queries:getFinalScore", { matchId: MATCH_ID });
    console.log("getFinalScore:");
    console.log(JSON.stringify(finalScore, null, 2));

    const diffs = await client.query("queries:getScoringDiffs", { matchId: MATCH_ID });
    console.log("getScoringDiffs:");
    console.log(JSON.stringify(diffs, null, 2));

    const finalScores = await client.query("queries:getFinalScores");
    console.log("getFinalScores:");
    console.log(JSON.stringify(finalScores.slice(0, 1), null, 2));

    const oddsHistory = await client.query("queries:getOddsHistory", { matchId: MATCH_ID });
    console.log("getOddsHistory:");
    console.log(JSON.stringify(oddsHistory.slice(-1), null, 2));

  } catch (error) {
    console.error("Validation failed:", error);
  }
}

runValidation();
