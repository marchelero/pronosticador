#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { predictMatch } from "../core/index.mjs";
import { auditSnapshot, findTeam, findMatchState, readJson, dataVersionFromSources } from "./audit-input.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const dataPath = resolve(scriptDir, "../assets/sample-data/worldcup-2026.json");
const snapshot = auditSnapshot(readJson(dataPath));

const completedMatches = snapshot.matchStates.filter((m) => m.status === "final" && m.stage === "group");

// Track per-team stats: own xG, opponent xG, goals for, goals against
const teamStats = {};

for (const ms of completedMatches) {
  const ht = findTeam(snapshot.teams, ms.homeTeamId);
  const at = findTeam(snapshot.teams, ms.awayTeamId);

  const pred = predictMatch({
    matchId: ms.matchId,
    homeTeam: ht,
    awayTeam: at,
    stage: "group",
    modelVersion: snapshot.metadata.modelVersion,
    dataVersion: snapshot.metadata.dataVersion,
    generatedAt: snapshot.metadata.generatedAt,
    venueCountryCode: ms.venueCountryCode,
    contextAdjustments: snapshot.contextAdjustments,
  });

  const actualH = ms.actualScore90min.home;
  const actualA = ms.actualScore90min.away;

  // Home team: own xG = pred.expectedGoalsHome, opp xG = pred.expectedGoalsAway
  for (const [code, ownXG, oppXG, gf, ga] of [
    [ms.homeTeamId, pred.expectedGoalsHome, pred.expectedGoalsAway, actualH, actualA],
    [ms.awayTeamId, pred.expectedGoalsAway, pred.expectedGoalsHome, actualA, actualH],
  ]) {
    if (!teamStats[code]) {
      teamStats[code] = { ownXG: 0, oppXG: 0, gf: 0, ga: 0, matches: 0 };
    }
    const s = teamStats[code];
    s.ownXG += ownXG;
    s.oppXG += oppXG;
    s.gf += gf;
    s.ga += ga;
    s.matches += 1;
  }
}

// Recalibrate teams
const newStrengthVersion = "wc2026-calibrated-v0.2";
const adjustments = [];

for (const team of snapshot.teams) {
  const s = teamStats[team.id];
  if (!s || s.matches === 0) continue;

  const xGpm = s.ownXG / s.matches;
  const gfpm = s.gf / s.matches;
  const gapm = s.ga / s.matches;
  const oppXGpm = s.oppXG / s.matches;

  // Attack: how efficient was the team at scoring vs their own xG?
  const attackFactor = xGpm > 0.3 ? gfpm / xGpm : 1;
  // Defense: how many goals conceded vs opponent's xG?
  const defenseFactor = oppXGpm > 0.3 ? gapm / oppXGpm : 1;

  const lr = 0.25;
  const newAttack = team.attackStrength * (1 + (attackFactor - 1) * lr);
  const newDefense = team.defenseStrength * Math.exp(-(defenseFactor - 1) * lr * 0.5);

  const oldAttack = team.attackStrength;
  const oldDefense = team.defenseStrength;
  const oldForm = team.formScore;
  const oldRating = team.ratingValue;

  team.attackStrength = Math.max(0.78, Math.min(1.35, +newAttack.toFixed(4)));
  team.defenseStrength = Math.max(0.78, Math.min(1.35, +newDefense.toFixed(4)));
  team.formScore = Math.round(Math.min(90, Math.max(30, team.formScore * 0.6 + (gfpm * 8 + 50) * 0.4)));
  team.ratingValue = Math.round(team.ratingValue + (gfpm - gapm) * 12);

  if (Math.abs(attackFactor - 1) > 0.15 || Math.abs(defenseFactor - 1) > 0.15) {
    adjustments.push({
      id: `cal-md1-${team.id.toLowerCase()}`,
      derivation: "manual_review",
      scope: "team",
      type: "manual",
      target: "home",
      teamCode: team.id,
      title:
        `MD1: GF ${s.gf} (xG ${s.ownXG.toFixed(1)}) GA ${s.ga} (opp xG ${s.oppXG.toFixed(1)}) ` +
        `→ atk ${(oldAttack).toFixed(3)}→${team.attackStrength.toFixed(3)} def ${(oldDefense).toFixed(3)}→${team.defenseStrength.toFixed(3)}`,
      impact: {
        attackStrengthDelta: +(team.attackStrength - oldAttack).toFixed(4),
        defenseStrengthDelta: +(team.defenseStrength - oldDefense).toFixed(4),
        formScoreDelta: team.formScore - oldForm,
      },
    });
  }
}

const sourceVersions = {
  ...snapshot.metadata.sourceVersions,
  "fifa-calendar-2026": "wc2026-calibrated-v0.2",
};
const dataVersion = dataVersionFromSources(sourceVersions, newStrengthVersion);

snapshot.metadata.dataVersion = dataVersion;
snapshot.metadata.sourceVersions = sourceVersions;
snapshot.metadata.strengthSnapshotVersion = newStrengthVersion;
snapshot.metadata.generatedAt = "2026-06-15T12:00:00.000Z";
snapshot.metadata.name = "World Cup 2026 - Recalibrated 48-Team Snapshot (post-MD1)";

snapshot.contextAdjustments = [
  ...snapshot.contextAdjustments.filter((a) => a.derivation !== "manual_review"),
  ...adjustments,
];

for (const team of snapshot.teams) {
  team.strengthVersion = newStrengthVersion;
}

const outPath = resolve(scriptDir, "../assets/sample-data/worldcup-2026.json");
writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

console.log("=== Recalibration Complete ===");
console.log(`New dataVersion: ${dataVersion}`);
console.log(`Teams calibrated: ${Object.keys(teamStats).length}`);
console.log(`Adjustments added: ${adjustments.length}`);
console.log("");
for (const [code, s] of Object.entries(teamStats)) {
  const team = snapshot.teams.find((t) => t.id === code);
  const attackFactor = s.ownXG > 0.3 ? (s.gf / s.ownXG).toFixed(2) : "N/A";
  const defenseFactor = s.oppXG > 0.3 ? (s.ga / s.oppXG).toFixed(2) : "N/A";
  console.log(
    `  ${code}: GF ${s.gf}/${s.ownXG.toFixed(1)}xG (eff ${attackFactor}) ` +
    `GA ${s.ga}/${s.oppXG.toFixed(1)}opp (eff ${defenseFactor}) ` +
    `→ atk ${team.attackStrength.toFixed(3)} def ${team.defenseStrength.toFixed(3)}`,
  );
}
