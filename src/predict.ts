import { ConvexHttpClient } from "convex/browser";
import dotenv from "dotenv";
import fs from "fs";

if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
} else {
  dotenv.config();
}

const CONVEX_URL = process.env.CONVEX_URL || "";
const client = new ConvexHttpClient(CONVEX_URL);

interface QuarterScore {
  quarter: string;
  homeScore: number;
  awayScore: number;
  total: number;
}

interface MatchData {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  quarters: QuarterScore[];
  cumulativeTotal?: number;
}

async function fetchAllData(): Promise<MatchData[]> {
  const history: any[] = await client.query("queries:getMatchHistory");
  const cyber = history.filter((m: any) =>
    m.matchName.toLowerCase().includes("cyber"),
  );
  const results: MatchData[] = [];
  for (const m of cyber) {
    const qs: any[] = await client.query("queries:getQuarterScores", {
      matchId: m.matchId,
    });
    const parts = m.matchName.split(" vs ");
    const homeTeam = parts[0]?.trim() ?? "";
    const awayTeam = parts[1]?.trim() ?? "";
    const quarters = qs
      .filter((q: any) => q.quarter !== "FINAL")
      .map((q: any) => ({
        quarter: q.quarter,
        homeScore: q.homeScore,
        awayScore: q.awayScore,
        total: q.homeScore + q.awayScore,
      }));
    const cumulativeTotal = quarters.reduce(
      (s: number, q: QuarterScore) => s + q.homeScore + q.awayScore,
      0,
    );
    results.push({ matchId: m.matchId, homeTeam, awayTeam, quarters, cumulativeTotal });
  }
  return results;
}

interface TeamStats {
  name: string;
  q1home: number[];
  q1away: number[];
  q2home: number[];
  q2away: number[];
  q3home: number[];
  q3away: number[];
  q4home: number[];
  q4away: number[];
  q1total: number[];
  q2total: number[];
  q3total: number[];
  q4total: number[];
  totalScores: number[];
  wins: number;
  losses: number;
}

function buildTeamStats(data: MatchData[]): Map<string, TeamStats> {
  const map = new Map<string, TeamStats>();

  function getTeam(name: string): TeamStats {
    if (!map.has(name)) {
      map.set(name, {
        name,
        q1home: [],
        q1away: [],
        q2home: [],
        q2away: [],
        q3home: [],
        q3away: [],
        q4home: [],
        q4away: [],
        q1total: [],
        q2total: [],
        q3total: [],
        q4total: [],
        totalScores: [],
        wins: 0,
        losses: 0,
      });
    }
    return map.get(name)!;
  }

  for (const m of data) {
    const home = getTeam(m.homeTeam);
    const away = getTeam(m.awayTeam);

    for (const q of m.quarters) {
      if (q.quarter === "Q1") {
        home.q1home.push(q.homeScore);
        home.q1total.push(q.total);
        away.q1away.push(q.awayScore);
        away.q1total.push(q.total);
      } else if (q.quarter === "Q2") {
        home.q2home.push(q.homeScore);
        home.q2total.push(q.total);
        away.q2away.push(q.awayScore);
        away.q2total.push(q.total);
      } else if (q.quarter === "Q3") {
        home.q3home.push(q.homeScore);
        home.q3total.push(q.total);
        away.q3away.push(q.awayScore);
        away.q3total.push(q.total);
      } else if (q.quarter === "Q4") {
        home.q4home.push(q.homeScore);
        home.q4total.push(q.total);
        away.q4away.push(q.awayScore);
        away.q4total.push(q.total);
      }
    }

    // Win/loss by cumulative total
    const homeTotal = m.quarters.reduce((s, q) => s + q.homeScore, 0);
    const awayTotal = m.quarters.reduce((s, q) => s + q.awayScore, 0);
    if (homeTotal > awayTotal) {
      home.wins++;
      away.losses++;
    } else if (awayTotal > homeTotal) {
      away.wins++;
      home.losses++;
    }
  }

  return map;
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function bayesianEstimate(
  teamAvg: number,
  teamN: number,
  globalAvg: number,
  globalN: number,
  weight = 5,
): number {
  return (teamAvg * teamN + globalAvg * weight) / (teamN + weight);
}

interface GlobalAverages {
  q1Home: number;
  q1Away: number;
  q1Total: number;
  q2Home: number;
  q2Away: number;
  q2Total: number;
  q3Home: number;
  q3Away: number;
  q3Total: number;
  q4Home: number;
  q4Away: number;
  q4Total: number;
}

function computeGlobalAverages(data: MatchData[]): GlobalAverages {
  const q1h: number[] = [],
    q1a: number[] = [],
    q1t: number[] = [];
  const q2h: number[] = [],
    q2a: number[] = [],
    q2t: number[] = [];
  const q3h: number[] = [],
    q3a: number[] = [],
    q3t: number[] = [];
  const q4h: number[] = [],
    q4a: number[] = [],
    q4t: number[] = [];

  for (const m of data) {
    for (const q of m.quarters) {
      if (q.quarter === "Q1") {
        q1h.push(q.homeScore);
        q1a.push(q.awayScore);
        q1t.push(q.total);
      } else if (q.quarter === "Q2") {
        q2h.push(q.homeScore);
        q2a.push(q.awayScore);
        q2t.push(q.total);
      } else if (q.quarter === "Q3") {
        q3h.push(q.homeScore);
        q3a.push(q.awayScore);
        q3t.push(q.total);
      } else if (q.quarter === "Q4") {
        q4h.push(q.homeScore);
        q4a.push(q.awayScore);
        q4t.push(q.total);
      }
    }
  }

  return {
    q1Home: avg(q1h),
    q1Away: avg(q1a),
    q1Total: avg(q1t),
    q2Home: avg(q2h),
    q2Away: avg(q2a),
    q2Total: avg(q2t),
    q3Home: avg(q3h),
    q3Away: avg(q3a),
    q3Total: avg(q3t),
    q4Home: avg(q4h),
    q4Away: avg(q4a),
    q4Total: avg(q4t),
  };
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return arr.length === 1 ? arr[0]! * 0.3 : 0;
  const m = avg(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

interface QuarterPrediction {
  homeScore: number;
  awayScore: number;
  total: number;
  homeWinPct: number;
  awayWinPct: number;
  overPct: number;
  underPct: number;
  confidence: number;
  patternConfidence: number;
  riskScore: number;
  overUnderLine: number;
}

function predictQ1(
  homeTeam: string,
  awayTeam: string,
  stats: Map<string, TeamStats>,
  global: GlobalAverages,
): QuarterPrediction {
  const h = stats.get(homeTeam);
  const a = stats.get(awayTeam);

  const homeAvg = h
    ? bayesianEstimate(avg(h.q1home), h.q1home.length, global.q1Home, 0)
    : global.q1Home;
  const awayAvg = a
    ? bayesianEstimate(avg(a.q1away), a.q1away.length, global.q1Away, 0)
    : global.q1Away;

  const homeN = h?.q1home.length ?? 0;
  const awayN = a?.q1away.length ?? 0;
  const patternConfidence = Math.min(
    ((homeN + awayN) / 10) * 100,
    85,
  );

  const homeScore = Math.round(homeAvg);
  const awayScore = Math.round(awayAvg);
  const total = homeScore + awayScore;

  const allQ1Totals: number[] = [];
  for (const [, s] of stats) {
    allQ1Totals.push(...s.q1total);
  }
  const sd = stddev(allQ1Totals.length > 0 ? allQ1Totals : [global.q1Total]);

  const overUnderLine = Math.round(global.q1Total);
  const zScore = (total - overUnderLine) / (sd || 1);
  const overPct = Math.round((0.5 + Math.atan(zScore) / Math.PI) * 100);

  const confidence = Math.min(
    30 + homeN * 10 + awayN * 10 + patternConfidence * 0.3,
    90,
  );
  const riskScore = Math.max(
    10,
    100 - confidence - (homeN + awayN) * 3,
  );

  return {
    homeScore,
    awayScore,
    total,
    homeWinPct: Math.round(
      homeScore > awayScore
        ? 50 + (homeScore - awayScore) * 3
        : 50 - (awayScore - homeScore) * 3,
    ),
    awayWinPct: Math.round(
      awayScore > homeScore
        ? 50 + (awayScore - homeScore) * 3
        : 50 - (homeScore - awayScore) * 3,
    ),
    overPct,
    underPct: 100 - overPct,
    confidence: Math.round(confidence),
    patternConfidence: Math.round(patternConfidence),
    riskScore: Math.round(Math.min(riskScore, 100)),
    overUnderLine,
  };
}

function predictQ2(
  homeTeam: string,
  awayTeam: string,
  stats: Map<string, TeamStats>,
  global: GlobalAverages,
): QuarterPrediction {
  const h = stats.get(homeTeam);
  const a = stats.get(awayTeam);

  const homeAvg = h
    ? bayesianEstimate(avg(h.q2home), h.q2home.length, global.q2Home, 0)
    : global.q2Home;
  const awayAvg = a
    ? bayesianEstimate(avg(a.q2away), a.q2away.length, global.q2Away, 0)
    : global.q2Away;

  const homeN = h?.q2home.length ?? 0;
  const awayN = a?.q2away.length ?? 0;
  const patternConfidence = Math.min(
    ((homeN + awayN) / 10) * 100,
    85,
  );

  const homeScore = Math.round(homeAvg);
  const awayScore = Math.round(awayAvg);
  const total = homeScore + awayScore;

  const allQ2Totals: number[] = [];
  for (const [, s] of stats) {
    allQ2Totals.push(...s.q2total);
  }
  const sd = stddev(allQ2Totals.length > 0 ? allQ2Totals : [global.q2Total]);
  const overUnderLine = Math.round(global.q2Total);
  const zScore = (total - overUnderLine) / (sd || 1);
  const overPct = Math.round((0.5 + Math.atan(zScore) / Math.PI) * 100);

  const confidence = Math.min(30 + homeN * 10 + awayN * 10 + patternConfidence * 0.3, 90);
  const riskScore = Math.max(10, 100 - confidence - (homeN + awayN) * 3);

  return {
    homeScore,
    awayScore,
    total,
    homeWinPct: Math.round(homeScore > awayScore ? 50 + (homeScore - awayScore) * 3 : 50 - (awayScore - homeScore) * 3),
    awayWinPct: Math.round(awayScore > homeScore ? 50 + (awayScore - homeScore) * 3 : 50 - (homeScore - awayScore) * 3),
    overPct,
    underPct: 100 - overPct,
    confidence: Math.round(confidence),
    patternConfidence: Math.round(patternConfidence),
    riskScore: Math.round(Math.min(riskScore, 100)),
    overUnderLine,
  };
}

function predictQ3(
  homeTeam: string,
  awayTeam: string,
  stats: Map<string, TeamStats>,
  global: GlobalAverages,
): QuarterPrediction {
  const h = stats.get(homeTeam);
  const a = stats.get(awayTeam);

  const homeAvg = h
    ? bayesianEstimate(avg(h.q3home), h.q3home.length, global.q3Home, 0)
    : global.q3Home;
  const awayAvg = a
    ? bayesianEstimate(avg(a.q3away), a.q3away.length, global.q3Away, 0)
    : global.q3Away;

  const homeN = h?.q3home.length ?? 0;
  const awayN = a?.q3away.length ?? 0;
  const patternConfidence = Math.min(((homeN + awayN) / 10) * 100, 85);

  const homeScore = Math.round(homeAvg);
  const awayScore = Math.round(awayAvg);
  const total = homeScore + awayScore;

  const allQ3Totals: number[] = [];
  for (const [, s] of stats) {
    allQ3Totals.push(...s.q3total);
  }
  const sd = stddev(allQ3Totals.length > 0 ? allQ3Totals : [global.q3Total]);
  const overUnderLine = Math.round(global.q3Total);
  const zScore = (total - overUnderLine) / (sd || 1);
  const overPct = Math.round((0.5 + Math.atan(zScore) / Math.PI) * 100);

  const confidence = Math.min(30 + homeN * 10 + awayN * 10 + patternConfidence * 0.3, 90);
  const riskScore = Math.max(10, 100 - confidence - (homeN + awayN) * 3);

  return {
    homeScore,
    awayScore,
    total,
    homeWinPct: Math.round(homeScore > awayScore ? 50 + (homeScore - awayScore) * 3 : 50 - (awayScore - homeScore) * 3),
    awayWinPct: Math.round(awayScore > homeScore ? 50 + (awayScore - homeScore) * 3 : 50 - (homeScore - awayScore) * 3),
    overPct,
    underPct: 100 - overPct,
    confidence: Math.round(confidence),
    patternConfidence: Math.round(patternConfidence),
    riskScore: Math.round(Math.min(riskScore, 100)),
    overUnderLine,
  };
}

function predictQ4(
  homeTeam: string,
  awayTeam: string,
  stats: Map<string, TeamStats>,
  global: GlobalAverages,
): QuarterPrediction {
  const h = stats.get(homeTeam);
  const a = stats.get(awayTeam);

  const homeAvg = h
    ? bayesianEstimate(avg(h.q4home), h.q4home.length, global.q4Home, 0)
    : global.q4Home;
  const awayAvg = a
    ? bayesianEstimate(avg(a.q4away), a.q4away.length, global.q4Away, 0)
    : global.q4Away;

  const homeN = h?.q4home.length ?? 0;
  const awayN = a?.q4away.length ?? 0;
  const patternConfidence = Math.min(((homeN + awayN) / 10) * 100, 85);

  const homeScore = Math.round(homeAvg);
  const awayScore = Math.round(awayAvg);
  const total = homeScore + awayScore;

  const allQ4Totals: number[] = [];
  for (const [, s] of stats) {
    allQ4Totals.push(...s.q4total);
  }
  const sd = stddev(allQ4Totals.length > 0 ? allQ4Totals : [global.q4Total]);
  const overUnderLine = Math.round(global.q4Total);
  const zScore = (total - overUnderLine) / (sd || 1);
  const overPct = Math.round((0.5 + Math.atan(zScore) / Math.PI) * 100);

  const confidence = Math.min(30 + homeN * 10 + awayN * 10 + patternConfidence * 0.3, 90);
  const riskScore = Math.max(10, 100 - confidence - (homeN + awayN) * 3);

  return {
    homeScore,
    awayScore,
    total,
    homeWinPct: Math.round(homeScore > awayScore ? 50 + (homeScore - awayScore) * 3 : 50 - (awayScore - homeScore) * 3),
    awayWinPct: Math.round(awayScore > homeScore ? 50 + (awayScore - homeScore) * 3 : 50 - (homeScore - awayScore) * 3),
    overPct,
    underPct: 100 - overPct,
    confidence: Math.round(confidence),
    patternConfidence: Math.round(patternConfidence),
    riskScore: Math.round(Math.min(riskScore, 100)),
    overUnderLine,
  };
}

function predictFullGame(
  homeTeam: string,
  awayTeam: string,
  stats: Map<string, TeamStats>,
): QuarterPrediction {
  const h = stats.get(homeTeam);
  const a = stats.get(awayTeam);

  const homeTotalScores = h?.totalScores ?? [];
  const awayTotalScores = a?.totalScores ?? [];
  const globalHomeTotal = 0;
  const globalAwayTotal = 0;

  const homeGameAvg = homeTotalScores.length > 0
    ? avg(homeTotalScores)
    : 0;
  const awayGameAvg = awayTotalScores.length > 0
    ? avg(awayTotalScores)
    : 0;

  const homeN = h?.totalScores.length ?? 0;
  const awayN = a?.totalScores.length ?? 0;

  const homeScore = Math.round(homeGameAvg || 95);
  const awayScore = Math.round(awayGameAvg || 95);
  const total = homeScore + awayScore;

  const patternConfidence = Math.min(((homeN + awayN) / 10) * 100, 80);
  const confidence = Math.min(25 + homeN * 8 + awayN * 8 + patternConfidence * 0.3, 85);
  const riskScore = Math.max(15, 100 - confidence - (homeN + awayN) * 2);

  return {
    homeScore,
    awayScore,
    total,
    homeWinPct: Math.round(homeScore > awayScore ? 50 + (homeScore - awayScore) * 2 : 50 - (awayScore - homeScore) * 2),
    awayWinPct: Math.round(awayScore > homeScore ? 50 + (awayScore - homeScore) * 2 : 50 - (homeScore - awayScore) * 2),
    overPct: 50,
    underPct: 50,
    confidence: Math.round(confidence),
    patternConfidence: Math.round(patternConfidence),
    riskScore: Math.round(Math.min(riskScore, 100)),
    overUnderLine: Math.round(total),
  };
}

async function run() {
  const args = process.argv.slice(2);
  const homeTeam = args[0] || "Denver Nuggets (cyber)";
  const awayTeam = args[1] || "Cleveland Cavaliers (cyber)";
  const targetQuarter = (args[2] || "Q1").toUpperCase();

  const data = await fetchAllData();
  const stats = buildTeamStats(data);
  const global = computeGlobalAverages(data);

  let pred: QuarterPrediction;
  let quarterLabel: string;

  switch (targetQuarter) {
    case "Q1":
      pred = predictQ1(homeTeam, awayTeam, stats, global);
      quarterLabel = "Q1 (First Quarter)";
      break;
    case "Q2":
      pred = predictQ2(homeTeam, awayTeam, stats, global);
      quarterLabel = "Q2 (Second Quarter)";
      break;
    case "Q3":
      pred = predictQ3(homeTeam, awayTeam, stats, global);
      quarterLabel = "Q3 (Third Quarter)";
      break;
    case "Q4":
      pred = predictQ4(homeTeam, awayTeam, stats, global);
      quarterLabel = "Q4 (Fourth Quarter)";
      break;
    case "FULL_GAME":
      pred = predictFullGame(homeTeam, awayTeam, stats);
      quarterLabel = "FULL GAME";
      break;
    default:
      console.error(`Unknown quarter: ${targetQuarter}. Use Q1, Q2, Q3, Q4, or FULL_GAME`);
      process.exit(1);
  }

  const winner =
    pred.homeWinPct > pred.awayWinPct
      ? homeTeam
      : pred.awayWinPct > pred.homeWinPct
        ? awayTeam
        : "Uncertain";

  console.log(`
MATCH:
${homeTeam} vs ${awayTeam}

Target:
${quarterLabel}

Prediction:
Predicted Winner: ${winner}
Predicted Quarter Score: ${pred.homeScore} - ${pred.awayScore}
Predicted Total Points: ${pred.total}
Over/Under Line: ${pred.overUnderLine}

Probabilities:
Home Win: ${pred.homeWinPct}%
Away Win: ${pred.awayWinPct}%
Over: ${pred.overPct}%
Under: ${pred.underPct}%

Confidence:
Prediction Confidence: ${pred.confidence}/100
Pattern Confidence: ${pred.patternConfidence}/100
Risk Score: ${pred.riskScore}/100
`);
}

run().catch(console.error);
