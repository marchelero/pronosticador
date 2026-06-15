#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dataVersionFromSources } from "./audit-input.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const dataPath = resolve(scriptDir, "../assets/sample-data/worldcup-2026.json");
const snap = JSON.parse(readFileSync(dataPath, "utf8"));

// Goal scorers per match (from Matchday 1 reports)
const scorers = {
  "wc2026-group-a-1": [
    { team: "MEX", player: "Julián Quiñones", min: 9 },
    { team: "MEX", player: "Raúl Jiménez", min: 67 },
  ],
  "wc2026-group-a-2": [
    { team: "CZE", player: "Ladislav Krejčí", min: 59 },
    { team: "KOR", player: "Hwang In-beom", min: 67 },
    { team: "KOR", player: "Oh Hyeon-gyu", min: 80 },
  ],
  "wc2026-group-b-3": [
    { team: "BIH", player: "Lukić", min: 21 },
    { team: "CAN", player: "Cyle Larin", min: 78 },
  ],
  "wc2026-group-d-4": [
    { team: "PAR", player: "Bobadilla (o.g.)", min: 7 },
    { team: "USA", player: "Folarin Balogun", min: 31 },
    { team: "USA", player: "Folarin Balogun", min: 45.5 },
    { team: "PAR", player: "Maurício", min: 73 },
    { team: "USA", player: "Giovanni Reyna", min: 90.8 },
  ],
  "wc2026-group-b-5": [
    { team: "SUI", player: "Breel Embolo", min: 17, note: "pen" },
    { team: "QAT", player: "Muheim (o.g.)", min: 90.4 },
  ],
  "wc2026-group-c-6": [
    { team: "MAR", player: "Ismael Saibari", min: 21 },
    { team: "BRA", player: "Vinícius Júnior", min: 32 },
  ],
  "wc2026-group-c-7": [
    { team: "SCO", player: "John McGinn", min: 28 },
  ],
  "wc2026-group-d-8": [
    { team: "AUS", player: "Nestory Irankunda", min: 27 },
    { team: "AUS", player: "Connor Metcalfe", min: 75 },
  ],
  "wc2026-group-e-9": [
    { team: "GER", player: "Felix Nmecha", min: 6 },
    { team: "CUR", player: "Comenencia", min: 21 },
    { team: "GER", player: "Nico Schlotterbeck", min: 38 },
    { team: "GER", player: "Kai Havertz", min: 45.5, note: "pen" },
    { team: "GER", player: "Jamal Musiala", min: 47 },
    { team: "GER", player: "Nathaniel Brown", min: 68 },
    { team: "GER", player: "Deniz Undav", min: 78 },
    { team: "GER", player: "Kai Havertz", min: 88 },
  ],
  "wc2026-group-e-10": [
    { team: "CIV", player: "Diallo", min: 90 },
  ],
  "wc2026-group-f-11": [
    { team: "NED", player: "Virgil van Dijk", min: 50 },
    { team: "JPN", player: "Nakamura", min: 57 },
    { team: "NED", player: "Crysencio Summerville", min: 64 },
    { team: "JPN", player: "Daichi Kamada", min: 88 },
  ],
  "wc2026-group-f-12": [
    { team: "SWE", player: "Yasin Ayari", min: 7 },
    { team: "TUN", player: "Rekik", min: 43 },
    { team: "SWE", player: "Alexander Isak", min: 30 },
    { team: "SWE", player: "Viktor Gyökeres", min: 59 },
    { team: "SWE", player: "Mattias Svanberg", min: 84 },
    { team: "SWE", player: "Yasin Ayari", min: 90.6 },
  ],
};

// Cards per match
const cards = {
  "wc2026-group-a-1": [
    { team: "MEX", player: "Brian Gutiérrez", type: "yellow", min: 23 },
    { team: "RSA", player: "Teboho Mokoena", type: "yellow", min: 17 },
    { team: "RSA", player: "Nkosinathi Sibisi", type: "yellow", min: 74 },
    { team: "RSA", player: "Sphephelo Sithole", type: "red", min: 49 },
    { team: "RSA", player: "Themba Zwane", type: "red", min: 84 },
    { team: "MEX", player: "César Montes", type: "red", min: 90.2 },
  ],
  "wc2026-group-a-2": [
    { team: "KOR", player: "Lee Gi-hyuk", type: "yellow", min: 90.6 },
  ],
  "wc2026-group-c-6": [
    // Brazil vs Morocco had cards but not listed in detail
  ],
};

// Build top scorers list
const goalCounts = {};
for (const [mid, goals] of Object.entries(scorers)) {
  for (const g of goals) {
    const key = g.player + "|" + g.team;
    if (!goalCounts[key]) goalCounts[key] = { player: g.player, team: g.team, goals: 0, matches: [] };
    goalCounts[key].goals += 1;
    goalCounts[key].matches.push(mid);
  }
}

const topScorers = Object.values(goalCounts)
  .sort((a, b) => b.goals - a.goals)
  .slice(0, 20);

// Add matchDetails to each matchState
for (const ms of snap.matchStates) {
  const g = scorers[ms.matchId] || [];
  const c = cards[ms.matchId] || [];
  ms.details = {
    scorers: g,
    cards: c,
    attendance: null, // would need source
  };
}

// Compute standings after MD1
const standings = {};
const groups = "ABCDEFGHIJKL";
for (const gc of groups) {
  const gTeams = snap.teams.filter((t) => t.groupCode === gc);
  const table = gTeams.map((t) => {
    const matches = snap.matchStates.filter(
      (m) => m.groupCode === gc && m.status === "final"
    );
    let pts = 0, gf = 0, ga = 0, w = 0, d = 0, l = 0, played = 0;
    for (const m of matches) {
      let home = m.homeTeamId === t.id;
      let goalsFor = home ? m.actualScore90min.home : m.actualScore90min.away;
      let goalsAg = home ? m.actualScore90min.away : m.actualScore90min.home;
      if (m.homeTeamId === t.id || m.awayTeamId === t.id) {
        played++;
        gf += goalsFor;
        ga += goalsAg;
        if (goalsFor > goalsAg) { pts += 3; w++; }
        else if (goalsFor === goalsAg) { pts += 1; d++; }
        else { l++; }
      }
    }
    return { code: t.id, name: t.name, pts, gf, ga, w, d, l, played, gd: gf - ga };
  });
  table.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
  standings[gc] = table;
}

// Fix dataVersion (computed from sourceVersions + strengthVersion)
snap.metadata.dataVersion = dataVersionFromSources(snap.metadata.sourceVersions, snap.metadata.strengthSnapshotVersion);

// Store extra data in snapshot
snap.topScorers = topScorers;
snap.standings = standings;

writeFileSync(dataPath, JSON.stringify(snap, null, 2));
console.log("✅ Match details added to snapshot");
console.log("   Scorers:", Object.keys(scorers).length, "matches");
console.log("   Top scorers:", topScorers.length, "players");
console.log("   Standings:", Object.keys(standings).length, "groups");
console.log("   dataVersion:", snap.metadata.dataVersion);
