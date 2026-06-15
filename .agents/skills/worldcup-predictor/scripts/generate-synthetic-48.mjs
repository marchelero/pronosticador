#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dataVersionFromSources } from "./audit-input.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const strengthVersion = "synthetic-48-strength-v0.2";

// Real 48 teams in actual 2026 World Cup groups, with realistic ratings
const groupDefs = {
  A: [
    { id: "MEX", name: "Mexico", fifaRank: 14, rating: 1835, host: true },
    { id: "KOR", name: "Korea Republic", fifaRank: 25, rating: 1782 },
    { id: "CZE", name: "Czech Republic", fifaRank: 40, rating: 1715 },
    { id: "RSA", name: "South Africa", fifaRank: 60, rating: 1648 },
  ],
  B: [
    { id: "SUI", name: "Switzerland", fifaRank: 19, rating: 1844 },
    { id: "CAN", name: "Canada", fifaRank: 30, rating: 1760, host: true },
    { id: "QAT", name: "Qatar", fifaRank: 56, rating: 1655 },
    { id: "BIH", name: "Bosnia and Herzegovina", fifaRank: 64, rating: 1628 },
  ],
  C: [
    { id: "SCO", name: "Scotland", fifaRank: 42, rating: 1722 },
    { id: "MAR", name: "Morocco", fifaRank: 7, rating: 1868 },
    { id: "BRA", name: "Brazil", fifaRank: 6, rating: 1972 },
    { id: "HAI", name: "Haiti", fifaRank: 83, rating: 1560 },
  ],
  D: [
    { id: "USA", name: "United States", fifaRank: 17, rating: 1835, host: true },
    { id: "AUS", name: "Australia", fifaRank: 27, rating: 1768 },
    { id: "TUR", name: "Turkey", fifaRank: 22, rating: 1790 },
    { id: "PAR", name: "Paraguay", fifaRank: 41, rating: 1700 },
  ],
  E: [
    { id: "GER", name: "Germany", fifaRank: 10, rating: 1930 },
    { id: "CIV", name: "Ivory Coast", fifaRank: 33, rating: 1740 },
    { id: "ECU", name: "Ecuador", fifaRank: 23, rating: 1785 },
    { id: "CUR", name: "Curaçao", fifaRank: 82, rating: 1530 },
  ],
  F: [
    { id: "SWE", name: "Sweden", fifaRank: 38, rating: 1710 },
    { id: "JPN", name: "Japan", fifaRank: 18, rating: 1848 },
    { id: "NED", name: "Netherlands", fifaRank: 8, rating: 1950 },
    { id: "TUN", name: "Tunisia", fifaRank: 45, rating: 1695 },
  ],
  G: [
    { id: "BEL", name: "Belgium", fifaRank: 9, rating: 1940 },
    { id: "EGY", name: "Egypt", fifaRank: 29, rating: 1750 },
    { id: "IRN", name: "Iran", fifaRank: 20, rating: 1805 },
    { id: "NZL", name: "New Zealand", fifaRank: 85, rating: 1540 },
  ],
  H: [
    { id: "ESP", name: "Spain", fifaRank: 2, rating: 2010 },
    { id: "CPV", name: "Cape Verde", fifaRank: 67, rating: 1610 },
    { id: "KSA", name: "Saudi Arabia", fifaRank: 61, rating: 1640 },
    { id: "URU", name: "Uruguay", fifaRank: 16, rating: 1855 },
  ],
  I: [
    { id: "FRA", name: "France", fifaRank: 3, rating: 2028 },
    { id: "SEN", name: "Senegal", fifaRank: 15, rating: 1860 },
    { id: "IRQ", name: "Iraq", fifaRank: 57, rating: 1650 },
    { id: "NOR", name: "Norway", fifaRank: 31, rating: 1755 },
  ],
  J: [
    { id: "ARG", name: "Argentina", fifaRank: 1, rating: 2045 },
    { id: "ALG", name: "Algeria", fifaRank: 28, rating: 1770 },
    { id: "AUT", name: "Austria", fifaRank: 24, rating: 1795 },
    { id: "JOR", name: "Jordan", fifaRank: 63, rating: 1635 },
  ],
  K: [
    { id: "POR", name: "Portugal", fifaRank: 5, rating: 1980 },
    { id: "COD", name: "DR Congo", fifaRank: 46, rating: 1690 },
    { id: "UZB", name: "Uzbekistan", fifaRank: 50, rating: 1675 },
    { id: "COL", name: "Colombia", fifaRank: 13, rating: 1875 },
  ],
  L: [
    { id: "ENG", name: "England", fifaRank: 4, rating: 1995 },
    { id: "CRO", name: "Croatia", fifaRank: 11, rating: 1920 },
    { id: "GHA", name: "Ghana", fifaRank: 73, rating: 1595 },
    { id: "PAN", name: "Panama", fifaRank: 34, rating: 1730 },
  ],
};

const groups = "ABCDEFGHIJKL";
const teams = [];

for (const gc of groups) {
  const list = groupDefs[gc];
  list.forEach((t) => {
    teams.push({
      id: t.id,
      code: t.id,
      name: t.name,
      countryCode: t.id,
      groupCode: gc,
      fifaRank: t.fifaRank,
      ratingValue: t.rating,
      ratingSource: "fifa_rank_fallback",
      strengthVersion,
      isHost: !!t.host,
      formScore: Math.round(40 + (100 - t.fifaRank) * 0.35),
      goalsPerMatch: 1.2,
      goalsAgainstPerMatch: 1.2,
    });
  });
}

// Generate 72 group matches (6 per group) + 1 knockout match = 73
const matchStates = [];
let matchNum = 1;

for (const gc of groups) {
  const gTeams = teams.filter((t) => t.groupCode === gc);
  if (gTeams.length !== 4) continue;

  const pairs = [
    [0, 1], [0, 2], [0, 3],
    [1, 2], [1, 3], [2, 3],
  ];
  for (const [h, a] of pairs) {
    matchStates.push({
      matchId: `synthetic-group-${gc.toLowerCase()}-${matchNum}`,
      matchNumber: matchNum,
      stage: "group",
      groupCode: gc,
      homeTeamId: gTeams[h].id,
      awayTeamId: gTeams[a].id,
      venueCountryCode: "USA",
      status: "final",
      actualScore90min: { home: 1, away: 0 },
    });
    matchNum += 1;
  }
}

// Add 1 round_of_32 match: Group B runner-up vs Group A runner-up
const gA = teams.filter((t) => t.groupCode === "A");
const gB = teams.filter((t) => t.groupCode === "B");
matchStates.push({
  matchId: "synthetic-rd32-1",
  matchNumber: 73,
  stage: "round_of_32",
  homeTeamId: gB[1].id,
  awayTeamId: gA[1].id,
  venueCountryCode: "USA",
  status: "final",
  actualScore90min: { home: 0, away: 0 },
  actualScoreExtraTime: { home: 1, away: 0 },
  advanceTeamId: gB[1].id,
});

const sourceVersions = {
  "sample-calendar": "synthetic-48-calendar-v0.2",
};

const dataVersion = dataVersionFromSources(sourceVersions, strengthVersion);

const snapshot = {
  metadata: {
    name: "World Cup Predictor synthetic 48-team audited sample",
    modelVersion: "model-v0.2-elo-dc",
    dataVersion,
    sourceVersions,
    strengthSnapshotVersion: strengthVersion,
    expectedTeamCount: 48,
    generatedAt: "2026-06-15T00:00:00.000Z",
    sampleScope:
      "Synthetic 48-team data for official-format and completed-result continuation tests. Uses real 2026 World Cup teams with synthetic strength ratings and artificial match results. Not an official data feed.",
  },
  format: {
    groupCount: 12,
    teamsPerGroup: 4,
    qualificationRule: "top_two_plus_best_eight_thirds",
    matchCount: 104,
  },
  teams,
  matchStates,
  contextAdjustments: [],
  officialFacts: [],
};

const outPath = resolve(scriptDir, "../assets/sample-data/synthetic-48-team.json");
writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
console.log(`Written to ${outPath}`);
console.log(`dataVersion: ${dataVersion}`);
console.log(`Teams: ${snapshot.teams.length}`);
console.log(`Completed matches: ${snapshot.matchStates.length}`);
