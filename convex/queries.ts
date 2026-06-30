import { query } from "./_generated/server";
import { v } from "convex/values";

// ─── Match History ──────────────────────────────────────────
// Returns all matches, most recent first.

export const getMatchHistory = query({
  args: {},
  handler: async (ctx) => {
    const results = await ctx.db
      .query("matches")
      .withIndex("by_matchId")
      .collect();
    return results;
  },
});

// ─── Quarter Scores ─────────────────────────────────────────
// Returns all quarter-end + final snapshots for a match.

export const getQuarterScores = query({
  args: { matchId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("quarterSnapshots")
      .withIndex("by_matchId", (q) => q.eq("matchId", args.matchId))
      .collect();
  },
});

// ─── Final Score ────────────────────────────────────────────
// Returns the final snapshot for a match (snapshotType = "final").

export const getFinalScore = query({
  args: { matchId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("quarterSnapshots")
      .withIndex("by_matchId_quarter", (q) =>
        q.eq("matchId", args.matchId).eq("quarter", "FINAL")
      )
      .first();
  },
});

// ─── Scoring Diffs (per-quarter totals) ─────────────────────
// Returns each quarter's period scores (points scored in that
// quarter only). homeTotal + awayTotal = combined points for
// the quarter.

export const getScoringDiffs = query({
  args: { matchId: v.string() },
  handler: async (ctx, args) => {
    const snapshots = await ctx.db
      .query("quarterSnapshots")
      .withIndex("by_matchId", (q) => q.eq("matchId", args.matchId))
      .collect();

    const order = ["Q1", "Q2", "Q3", "Q4", "FINAL"];
    snapshots.sort(
      (a, b) => order.indexOf(a.quarter) - order.indexOf(b.quarter),
    );

    return snapshots.map((s) => ({
      quarter: s.quarter,
      homeScore: s.homeScore,
      awayScore: s.awayScore,
      total: s.homeScore + s.awayScore,
    }));
  },
});

// ─── Final Scores (finished matches) ────────────────────────

export const getFinalScores = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("matches")
      .filter((q) => q.neq(q.field("finishedAt"), undefined))
      .collect();
  },
});

// ─── Odds History ───────────────────────────────────────────

export const getOddsHistory = query({
  args: { matchId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("oddsTimeline")
      .withIndex("by_matchId_timestamp", (q) =>
        q.eq("matchId", args.matchId)
      )
      .collect();
  },
});
