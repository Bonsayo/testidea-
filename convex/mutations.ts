import { mutation } from "./_generated/server";
import { v } from "convex/values";

// ─── saveMatch ──────────────────────────────────────────────
// Upserts a match record. If matchId already exists, patches the row
// instead of inserting a duplicate.

export const saveMatch = mutation({
  args: {
    matchId: v.string(),
    matchName: v.string(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    finalHomeScore: v.optional(v.number()),
    finalAwayScore: v.optional(v.number()),
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { apiKey: _, ...data } = args;
    if (_ !== "try-pipeline-secret-2026") { console.log("[Auth] Blocked unauthorized saveMatch call"); throw new Error("Unauthorized"); }
    const existing = await ctx.db
      .query("matches")
      .withIndex("by_matchId", (q) => q.eq("matchId", data.matchId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        matchName: data.matchName,
        startedAt: data.startedAt ?? existing.startedAt,
        finishedAt: data.finishedAt ?? existing.finishedAt,
        finalHomeScore: data.finalHomeScore ?? existing.finalHomeScore,
        finalAwayScore: data.finalAwayScore ?? existing.finalAwayScore,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("matches", data);
    }
  },
});

// ─── saveQuarterSnapshot ────────────────────────────────────
// Upserts a quarter-end or final snapshot for a match.
// Only one row per (matchId + quarter) — the last score seen
// during that quarter.  Used by the storage adapter when it
// detects a quarter transition or match-end.

export const saveQuarterSnapshot = mutation({
  args: {
    matchId: v.string(),
    quarter: v.string(),
    homeScore: v.number(),
    awayScore: v.number(),
    timestamp: v.number(),
    snapshotType: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("quarterSnapshots")
      .withIndex("by_matchId_quarter", (q) =>
        q.eq("matchId", args.matchId).eq("quarter", args.quarter)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        homeScore: args.homeScore,
        awayScore: args.awayScore,
        timestamp: args.timestamp,
        snapshotType: args.snapshotType,
      });
      return { inserted: false, id: existing._id };
    }

    const id = await ctx.db.insert("quarterSnapshots", args);
    return { inserted: true, id };
  },
});

// ─── deleteMatch ─────────────────────────────────────────────
// Deletes a match and its quarter snapshots.

export const deleteMatch = mutation({
  args: { matchId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("matches")
      .withIndex("by_matchId", (q) => q.eq("matchId", args.matchId))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    const snapshots = await ctx.db
      .query("quarterSnapshots")
      .withIndex("by_matchId", (q) => q.eq("matchId", args.matchId))
      .collect();
    for (const snap of snapshots) {
      await ctx.db.delete(snap._id);
    }
  },
});

// ─── saveOddsTimeline ───────────────────────────────────────
// Appends an odds snapshot to the timeline.
// Deduplication by (matchId + timestamp) prevents exact-duplicate rows.

export const saveOddsTimeline = mutation({
  args: {
    matchId: v.string(),
    timestamp: v.number(),
    homeOdds: v.number(),
    awayOdds: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("oddsTimeline")
      .withIndex("by_matchId_timestamp", (q) =>
        q.eq("matchId", args.matchId).eq("timestamp", args.timestamp)
      )
      .first();

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("oddsTimeline", args);
  },
});


