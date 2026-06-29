import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ─── Matches ──────────────────────────────────────────────
  matches: defineTable({
    matchId: v.string(),
    matchName: v.string(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    finalHomeScore: v.optional(v.number()),
    finalAwayScore: v.optional(v.number()),
  }).index("by_matchId", ["matchId"]),

  // ─── Quarter Snapshots ────────────────────────────────────
  // One row per quarter per match. Persisted only on quarter
  // changes or match end, not on every live score tick.
  quarterSnapshots: defineTable({
    matchId: v.string(),
    quarter: v.string(),
    homeScore: v.number(),
    awayScore: v.number(),
    timestamp: v.number(),
    snapshotType: v.string(),
  })
    .index("by_matchId", ["matchId"])
    .index("by_matchId_quarter", ["matchId", "quarter"]),

  // ─── Odds Timeline ────────────────────────────────────────
  oddsTimeline: defineTable({
    matchId: v.string(),
    timestamp: v.number(),
    homeOdds: v.number(),
    awayOdds: v.number(),
  })
    .index("by_matchId", ["matchId"])
    .index("by_matchId_timestamp", ["matchId", "timestamp"]),
});
