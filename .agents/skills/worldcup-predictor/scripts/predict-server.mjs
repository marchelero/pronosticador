#!/usr/bin/env node

import http from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { predictMatch, generateBettingSlip, scoreDistribution, simulateNinetyMinutes } from "../core/index.mjs";
import { simulateTournament } from "../core/index.mjs";
import { createSeededRng } from "../core/utils.mjs";
import { auditSnapshot, findTeam, readJson } from "./audit-input.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const dataPath = resolve(scriptDir, "../assets/sample-data/worldcup-2026.json");
const publicPath = resolve(scriptDir, "../public");
const snapshot = auditSnapshot(readJson(dataPath));

const PORT = process.env.PORT || 3030;

// ── Nombres en español ──
const esNames = {
  MEX:"México", KOR:"Corea del Sur", CZE:"República Checa", RSA:"Sudáfrica",
  SUI:"Suiza", CAN:"Canadá", QAT:"Catar", BIH:"Bosnia y Herzegovina",
  SCO:"Escocia", MAR:"Marruecos", BRA:"Brasil", HAI:"Haití",
  USA:"Estados Unidos", AUS:"Australia", TUR:"Turquía", PAR:"Paraguay",
  GER:"Alemania", CIV:"Costa de Marfil", ECU:"Ecuador", CUR:"Curazao",
  SWE:"Suecia", JPN:"Japón", NED:"Países Bajos", TUN:"Túnez",
  BEL:"Bélgica", EGY:"Egipto", IRN:"Irán", NZL:"Nueva Zelanda",
  ESP:"España", CPV:"Cabo Verde", KSA:"Arabia Saudita", URU:"Uruguay",
  FRA:"Francia", SEN:"Senegal", IRQ:"Irak", NOR:"Noruega",
  ARG:"Argentina", ALG:"Argelia", AUT:"Austria", JOR:"Jordania",
  POR:"Portugal", COD:"RD Congo", UZB:"Uzbekistán", COL:"Colombia",
  ENG:"Inglaterra", CRO:"Croacia", GHA:"Ghana", PAN:"Panamá",
};

function esName(team) {
  return esNames[team.code] || team.name;
}

// ── Simulación (cacheada 1 minuto) ──
let simCache = { data: null, ts: 0 };
const SIM_TTL = 60_000;

function getSimulation() {
  const now = Date.now();
  if (simCache.data && now - simCache.ts < SIM_TTL) return simCache.data;
  const result = simulateTournament({
    teams: snapshot.teams,
    matchStates: snapshot.matchStates,
    contextAdjustments: snapshot.contextAdjustments,
    modelVersion: snapshot.metadata.modelVersion,
    dataVersion: snapshot.metadata.dataVersion,
    generatedAt: snapshot.metadata.generatedAt,
    simulationCount: 10000,
    seed: "2026",
  });
  simCache = { data: result, ts: now };
  return result;
}

// (HTML served from public/index.html)

// ── Servidor HTTP ──
const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  if (path === "/" || path === "/index.html") {
    try {
      const content = readFileSync(resolve(publicPath, "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end("Error loading frontend");
    }
    return;
  }

  if (path === "/api/teams") {
    const data = snapshot.teams.map((t) => ({
      code: t.code,
      name: t.name,
      esName: esName(t),
      fifaRank: t.fifaRank,
      groupCode: t.groupCode,
      isHost: t.isHost,
      ratingValue: t.ratingValue ?? t.eloRating,
      attackStrength: t.attackStrength,
      defenseStrength: t.defenseStrength,
      formScore: t.formScore,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return;
  }

  if (path === "/api/simulation") {
    try {
      const sim = getSimulation();
      // Solo devolver championProb + teamStageProb (ligero)
      const out = {
        simulationCount: sim.simulationCount,
        championProbabilities: sim.championProbabilities,
        teamStageProbabilities: sim.teamStageProbabilities.map((t) => ({
          teamCode: t.teamCode,
          teamName: t.teamName,
          groupWinnerProb: t.groupWinnerProb,
          groupSecondProb: t.groupSecondProb,
          qualify32Prob: t.qualify32Prob,
          qualify16Prob: t.qualify16Prob,
          qualify8Prob: t.qualify8Prob,
          qualify4Prob: t.qualify4Prob,
          finalProb: t.finalProb,
          championProb: t.championProb,
        })),
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (path === "/api/stats") {
    const topScorers = snapshot.topScorers || [];
    const standings = snapshot.standings || {};
    // Group match details by matchId with scorers
    const matchDetails = {};
    for (const ms of snapshot.matchStates) {
      if (ms.details) {
        const hTeam = snapshot.teams.find(t => t.id === ms.homeTeamId);
        const aTeam = snapshot.teams.find(t => t.id === ms.awayTeamId);
        matchDetails[ms.matchId] = {
          matchId: ms.matchId,
          homeTeam: hTeam ? { code: hTeam.code, name: esName(hTeam) } : ms.homeTeamId,
          awayTeam: aTeam ? { code: aTeam.code, name: esName(aTeam) } : ms.awayTeamId,
          score: ms.actualScore90min,
          scorers: ms.details.scorers || [],
          cards: ms.details.cards || [],
        };
      }
    }
    const out = { topScorers, standings, matchDetails };
    // Also include cards summary
    const allCards = [];
    for (const ms of snapshot.matchStates) {
      if (ms.details?.cards) {
        for (const c of ms.details.cards) {
          allCards.push({ ...c, matchId: ms.matchId });
        }
      }
    }
    out.allCards = allCards;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out));
    return;
  }

  if (path === "/api/enriched") {
    const homeCode = url.searchParams.get("home");
    const awayCode = url.searchParams.get("away");
    if (!homeCode || !awayCode) { res.writeHead(400); res.end("Missing home/away"); return; }
    const out = {};
    // H2H
    const h2hKey1 = homeCode + "-" + awayCode;
    const h2hKey2 = awayCode + "-" + homeCode;
    out.h2h = snapshot.h2h?.[h2hKey1] || snapshot.h2h?.[h2hKey2] || [];
    // Recent form
    out.homeForm = snapshot.recentForm?.[homeCode]?.slice(0,10) || [];
    out.awayForm = snapshot.recentForm?.[awayCode]?.slice(0,10) || [];
    // Squad info
    out.homeSquad = snapshot.squadInfo?.[homeCode] || null;
    out.awaySquad = snapshot.squadInfo?.[awayCode] || null;
    // Injuries
    out.homeInjuries = snapshot.injuries?.[homeCode] || [];
    out.awayInjuries = snapshot.injuries?.[awayCode] || [];
    // Team trends
    out.homeTrends = snapshot.teamTrends?.[homeCode] || null;
    out.awayTrends = snapshot.teamTrends?.[awayCode] || null;
    // Weather (for venue)
    const ht = findTeam(snapshot.teams, homeCode);
    const at = findTeam(snapshot.teams, awayCode);
    const matchState = snapshot.matchStates.find(ms =>
      (ms.homeTeamId === homeCode && ms.awayTeamId === awayCode) ||
      (ms.homeTeamId === awayCode && ms.awayTeamId === homeCode));
    const venueCountry = matchState?.venueCountryCode || "USA";
    const venueMap = { MEX: "Estadio Azteca", CAN: "BC Place", USA: "SoFi Stadium" };
    const venue = venueMap[venueCountry] || "SoFi Stadium";
    out.weather = snapshot.weather?.[venue] || null;
    out.venue = venue;
    // Referee
    const refKey1 = homeCode + "-" + awayCode;
    const refKey2 = awayCode + "-" + homeCode;
    out.referee = snapshot.refereeAssignments?.[refKey1] || snapshot.refereeAssignments?.[refKey2] || null;
    // Cards accumulation from completed matches
    const allCards = [];
    for (const ms of snapshot.matchStates) {
      if (ms.details?.cards) allCards.push(...ms.details.cards.map(c => ({ ...c, matchId: ms.matchId, homeTeamId: ms.homeTeamId, awayTeamId: ms.awayTeamId })));
    }
    function teamCards(code) {
      const team = snapshot.teams.find(t => t.code === code);
      if (!team) return { yellow: 0, red: 0, players: [] };
      const relevant = allCards.filter(c => c.team === code);
      return {
        yellow: relevant.filter(c => c.type === "yellow").length,
        red: relevant.filter(c => c.type === "red").length,
        players: relevant.map(c => ({ player: c.player, type: c.type, min: c.min })),
      };
    }
    out.homeCards = teamCards(homeCode);
    out.awayCards = teamCards(awayCode);
    // Asian handicap + exact goals from score distribution
    if (ht && at) {
      const fullDist = scoreDistribution(
        { ...ht, isHost: ht.countryCode === venueCountry },
        { ...at, isHost: at.countryCode === venueCountry }
      );
      const sum = (fn) => fullDist.filter(fn).reduce((s, x) => s + x.probability, 0);
      out.asianHandicap = {
        homeMinus05: Math.round(sum(e => e.home > e.away) * 10000) / 10000,
        homeMinus1: Math.round(sum(e => e.home - e.away >= 2) * 10000) / 10000,
        homeMinus15: Math.round(sum(e => e.home - e.away >= 2) * 10000) / 10000,
        homeMinus2: Math.round(sum(e => e.home - e.away >= 3) * 10000) / 10000,
        homePlus05: Math.round(sum(e => e.home >= e.away) * 10000) / 10000,
        awayMinus05: Math.round(sum(e => e.away > e.home) * 10000) / 10000,
        awayMinus1: Math.round(sum(e => e.away - e.home >= 2) * 10000) / 10000,
      };
      out.exactGoals = [];
      for (let g = 0; g <= 6; g++) {
        out.exactGoals.push({ goals: g, probability: Math.round(sum(e => e.home + e.away === g) * 10000) / 10000 });
      }
      out.over04 = Math.round((1 - out.exactGoals[0].probability) * 10000) / 10000;
    }
    // Accuracy
    out.accuracy = snapshot.accuracy || null;
    // Group scenarios
    if (ht && at && ht.groupCode === at.groupCode) {
      const gc = ht.groupCode;
      const st = (snapshot.standings || {})[gc];
      if (st) {
        const htRow = st.find(r => r.code === homeCode);
        const atRow = st.find(r => r.code === awayCode);
        if (htRow && atRow) {
          const maxPts = st[0].pts;
          out.groupScenario = {
            group: gc,
            homePos: st.indexOf(htRow) + 1,
            awayPos: st.indexOf(atRow) + 1,
            homePts: htRow.pts,
            awayPts: atRow.pts,
            leaderPts: maxPts,
            teams: st.map(r => ({ code: r.code, pts: r.pts, pos: st.indexOf(r) + 1 })),
          };
        }
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out));
    return;
  }

  if (path === "/api/predict") {
    const homeCode = url.searchParams.get("home");
    const awayCode = url.searchParams.get("away");
    const format = url.searchParams.get("format") || "text";
    if (!homeCode || !awayCode) {
      res.writeHead(400);
      res.end("Missing home/away");
      return;
    }
    try {
      const homeTeam = findTeam(snapshot.teams, homeCode);
      const awayTeam = findTeam(snapshot.teams, awayCode);
      if (!homeTeam || !awayTeam) throw new Error("Team not found");

      const prediction = predictMatch({
        matchId: homeCode + "-" + awayCode,
        homeTeam,
        awayTeam,
        stage: "group",
        modelVersion: snapshot.metadata.modelVersion,
        dataVersion: snapshot.metadata.dataVersion,
        generatedAt: snapshot.metadata.generatedAt,
        venueCountryCode: "USA",
        contextAdjustments: snapshot.contextAdjustments,
      });

      // Full score distribution (top 15 + marginal goals)
      const fullDist = scoreDistribution(
        { ...homeTeam, isHost: homeTeam.countryCode === "USA" },
        { ...awayTeam, isHost: awayTeam.countryCode === "USA" }
      );
      const extendedScorelines = fullDist
        .slice().sort((a, b) => b.probability - a.probability)
        .slice(0, 15)
        .map(e => ({ scoreline: { home: e.home, away: e.away }, probability: Math.round(e.probability * 10000) / 10000 }));
      // Marginal goal probabilities
      const maxG = 6;
      const homeGoalsDist = [];
      const awayGoalsDist = [];
      for (let g = 0; g <= maxG; g++) {
        homeGoalsDist.push({ goals: g, probability: Math.round(fullDist.filter(e => e.home === g).reduce((s, x) => s + x.probability, 0) * 10000) / 10000 });
        awayGoalsDist.push({ goals: g, probability: Math.round(fullDist.filter(e => e.away === g).reduce((s, x) => s + x.probability, 0) * 10000) / 10000 });
      }

      // Synthetic market odds for value analysis
      const seedStr = homeCode + "-" + awayCode;
      const hashSeed = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 0xFFFFFFFF; };
      const seed = hashSeed(seedStr);
      const margin = 0.06 + seed * 0.04;
      const mpHome = Math.max(0.05, prediction.homeWin90Prob * (1 + (seed - 0.5) * 0.18));
      const mpDraw = Math.max(0.05, prediction.draw90Prob * (1 + (seed - 0.5) * 0.20));
      const mpAway = Math.max(0.05, prediction.awayWin90Prob * (1 + (seed - 0.5) * 0.18));
      const sumMp = mpHome + mpDraw + mpAway;
      const mHome = mpHome / sumMp * (1 - margin);
      const mDraw = mpDraw / sumMp * (1 - margin);
      const mAway = mpAway / sumMp * (1 - margin);

      // Value analysis
      const outcomes = [
        { id: "1", label: "Local", prob: prediction.homeWin90Prob, marketOdds: 1 / mHome, fairOdds: 1 / prediction.homeWin90Prob },
        { id: "X", label: "Empate", prob: prediction.draw90Prob, marketOdds: 1 / mDraw, fairOdds: 1 / prediction.draw90Prob },
        { id: "2", label: "Visitante", prob: prediction.awayWin90Prob, marketOdds: 1 / mAway, fairOdds: 1 / prediction.awayWin90Prob },
      ];
      const valueAnalysis = outcomes.map(o => {
        const ev = o.prob * o.marketOdds - 1;
        const kelly = o.marketOdds > 1 ? Math.max(0, (o.prob * o.marketOdds - 1) / (o.marketOdds - 1)) : 0;
        return {
          outcome: o.id, label: o.label,
          modelProb: Math.round(o.prob * 10000) / 10000,
          fairOdds: Math.round(o.fairOdds * 100) / 100,
          marketOdds: Math.round(o.marketOdds * 100) / 100,
          ev: Math.round(ev * 10000) / 10000,
          kellyPct: Math.round(kelly * 10000) / 10000,
          signal: ev > 0.05 ? "VALOR ✅" : ev > 0 ? "leve ⚠️" : "sin valor ❌",
          verdict: ev > 0.05 ? `Valor positivo: el mercado paga ${(ev * 100).toFixed(1)}% más de lo justo` :
                   ev > 0 ? `Valor marginal: apenas ${(ev * 100).toFixed(1)}% de sobreprecio` :
                   `Sin valor: el mercado paga ${(Math.abs(ev) * 100).toFixed(1)}% menos de lo justo`,
        };
      });

      // Match Monte Carlo simulation (5000 sims)
      const simRng = createSeededRng("match-sim-" + seedStr);
      const simResults = [];
      for (let i = 0; i < 5000; i++) {
        const r = simulateNinetyMinutes(
          { ...homeTeam, isHost: homeTeam.countryCode === "USA" },
          { ...awayTeam, isHost: awayTeam.countryCode === "USA" },
          simRng,
          fullDist
        );
        simResults.push(r);
      }
      const simScoreCounts = {};
      const simGoalCounts = {};
      for (const r of simResults) {
        const key = r.home + "-" + r.away;
        simScoreCounts[key] = (simScoreCounts[key] || 0) + 1;
        const total = r.home + r.away;
        simGoalCounts[total] = (simGoalCounts[total] || 0) + 1;
      }
      const topSimScores = Object.entries(simScoreCounts)
        .map(([score, count]) => ({ score, count, pct: count / 5000 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6)
        .map(s => ({ scoreline: s.score, probability: Math.round(s.pct * 10000) / 10000 }));
      const simGoalDist = Object.entries(simGoalCounts)
        .map(([goals, count]) => ({ goals: parseInt(goals), probability: Math.round((count / 5000) * 10000) / 10000 }))
        .sort((a, b) => a.goals - b.goals);
      const avgGoalsSim = simResults.reduce((s, r) => s + r.home + r.away, 0) / 5000;
      const matchSimulation = {
        simulations: 5000,
        avgTotalGoals: Math.round(avgGoalsSim * 100) / 100,
        avgHomeGoals: Math.round(simResults.reduce((s, r) => s + r.home, 0) / 5000 * 100) / 100,
        avgAwayGoals: Math.round(simResults.reduce((s, r) => s + r.away, 0) / 5000 * 100) / 100,
        homeWinPct: Math.round(simResults.filter(r => r.home > r.away).length / 50) / 100,
        drawPct: Math.round(simResults.filter(r => r.home === r.away).length / 50) / 100,
        awayWinPct: Math.round(simResults.filter(r => r.away > r.home).length / 50) / 100,
        mostCommonScore: topSimScores[0] || null,
        topScorelines: topSimScores,
        goalDistribution: simGoalDist,
      };

      // Momentum data from recent form
      const homeForm = snapshot.recentForm?.[homeCode]?.slice(0, 10) || [];
      const awayForm = snapshot.recentForm?.[awayCode]?.slice(0, 10) || [];
      function parseForm(form) {
        return form.map(f => {
          const g = f.startsWith("G");
          const e = f.startsWith("E");
          const m = f.match(/(\d+)-(\d+)\s+vs\s+(\w+)/);
          return {
            text: f,
            result: g ? "W" : e ? "D" : "L",
            color: g ? "var(--green)" : e ? "var(--gold)" : "var(--red)",
            score: m ? m[1] + "-" + m[2] : "-",
            opp: m ? m[3] : "TBD",
          };
        });
      }
      const momentum = {
        home: { team: esName(homeTeam), form: parseForm(homeForm) },
        away: { team: esName(awayTeam), form: parseForm(awayForm) },
      };

      if (format === "json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ...prediction, extendedScorelines, homeGoalsDist, awayGoalsDist,
          valueAnalysis, matchSimulation, momentum,
        }));
        return;
      }

      const hN = esName(homeTeam);
      const aN = esName(awayTeam);
      const h = hN;
      const a = aN;
      const W = 52;
      const pct = (v) => (v * 100).toFixed(1) + "%";
      const lbar = (v) => "█".repeat(Math.round(v * 20)) + "░".repeat(20 - Math.round(v * 20));
      const pd = (s, n) => String(s).padEnd(n);

      const confLabel = { low: "baja", medium: "media", high: "alta" } [prediction.confidenceLevel] || prediction.confidenceLevel;

      const lines = [];

      // Header
      lines.push("  ┌" + "─".repeat(W) + "┐");
      lines.push("  │ " + pd("PREDICCIÓN 90 MINUTOS", 50) + " │");
      lines.push("  │ " + pd(h + " vs " + a, 50) + " │");
      lines.push("  │ " + pd(homeTeam.groupCode + "  |  " + homeTeam.fifaRank + "ª FIFA vs " + awayTeam.fifaRank + "ª FIFA", 50) + " │");
      lines.push("  └" + "─".repeat(W) + "┘");

      // 1/X/2
      lines.push("  ┌" + "─".repeat(W) + "┐");
      lines.push("  │ " + pd("RESULTADO (1 / X / 2)", 50) + " │");
      lines.push("  ├" + "─".repeat(W) + "┤");
      lines.push("  │ 1  " + pd(h, 18) + lbar(prediction.homeWin90Prob) + "  " + pd(pct(prediction.homeWin90Prob), 7) + " │");
      lines.push("  │ X  " + pd("Empate", 18) + lbar(prediction.draw90Prob) + "  " + pd(pct(prediction.draw90Prob), 7) + " │");
      lines.push("  │ 2  " + pd(a, 18) + lbar(prediction.awayWin90Prob) + "  " + pd(pct(prediction.awayWin90Prob), 7) + " │");
      const winner = prediction.homeWin90Prob > prediction.awayWin90Prob ? h : a;
      lines.push("  ├" + "─".repeat(W) + "┤");
      lines.push("  │ " + pd("Favorito: " + winner + "  |  Confianza: " + confLabel, 50) + " │");
      lines.push("  └" + "─".repeat(W) + "┘");

      // xG
      const xGH = prediction.expectedGoalsHome;
      const xGA = prediction.expectedGoalsAway;
      const totalXG = xGH + xGA;
      lines.push("  ┌" + "─".repeat(W) + "┐");
      lines.push("  │ " + pd("GOLES ESPERADOS (xG)", 50) + " │");
      lines.push("  ├" + "─".repeat(W) + "┤");
      lines.push("  │ " + pd(h, 18) + "  " + pd(xGH.toFixed(2), 7) + lbar(xGH / 3) + "  │");
      lines.push("  │ " + pd(a, 18) + "  " + pd(xGA.toFixed(2), 7) + lbar(xGA / 3) + "  │");
      lines.push("  ├" + "─".repeat(W) + "┤");
      lines.push("  │ " + pd("Total: " + totalXG.toFixed(2) + "  |  Over 2.5: " + (totalXG > 2.5 ? "sí" : "no"), 50) + " │");
      lines.push("  └" + "─".repeat(W) + "┘");

      // Scorelines
      lines.push("  ┌" + "─".repeat(W) + "┐");
      lines.push("  │ " + pd("MARCADORES MÁS PROBABLES", 50) + " │");
      lines.push("  ├" + "─".repeat(W) + "┤");
      for (const s of prediction.topScorelines) {
        const label = s.scoreline.home > s.scoreline.away ? "→ " + h
          : s.scoreline.home < s.scoreline.away ? "→ " + a : "→ Empate";
        const ss = s.scoreline.home + "-" + s.scoreline.away;
        lines.push("  │ " + pd(ss, 8) + lbar(s.probability) + "  " + pd(pct(s.probability), 7) + pd(label, 18) + " │");
      }
      lines.push("  └" + "─".repeat(W) + "┘");

      // Fuerzas
      const fmt3 = (v) => (v ?? 0).toFixed(3);
      lines.push("  ┌" + "─".repeat(W) + "┐");
      lines.push("  │ " + pd("COMPARATIVA DE FUERZA", 50) + " │");
      lines.push("  ├" + "─".repeat(W) + "┤");
      lines.push("  │ " + pd("Equipo", 14) + "  Rating   Ataque   Defensa  Forma     │");
      lines.push("  │ " + pd(h, 14) + "  " + pd(homeTeam.ratingValue ?? homeTeam.eloRating, 7) + " " + pd(fmt3(homeTeam.attackStrength), 7) + " " + pd(fmt3(homeTeam.defenseStrength), 7) + " " + pd(homeTeam.formScore ?? "-", 7) + " │");
      lines.push("  │ " + pd(a, 14) + "  " + pd(awayTeam.ratingValue ?? awayTeam.eloRating, 7) + " " + pd(fmt3(awayTeam.attackStrength), 7) + " " + pd(fmt3(awayTeam.defenseStrength), 7) + " " + pd(awayTeam.formScore ?? "-", 7) + " │");
      lines.push("  └" + "─".repeat(W) + "┘");

      // Resumen
      lines.push("  ┌" + "─".repeat(W) + "┐");
      lines.push("  │ " + pd("RESUMEN DEL MODELO", 50) + " │");
      lines.push("  ├" + "─".repeat(W) + "┤");

      const diff = Math.abs(xGH - xGA);
      if (diff > 0.4) {
        lines.push("  │ " + pd(h + " genera " + xGH.toFixed(2) + " xG vs " + xGA.toFixed(2) + " de " + a, 50) + " │");
      } else {
        lines.push("  │ " + pd("Partido muy parejo: xG " + xGH.toFixed(2) + "-" + xGA.toFixed(2), 50) + " │");
      }

      const bothScore = prediction.topScorelines
        .filter((s) => s.scoreline.home > 0 && s.scoreline.away > 0)
        .reduce((s, x) => s + x.probability, 0);
      lines.push("  │ " + pd("Ambos anotan (BTTS): ~" + (bothScore * 100).toFixed(0) + "%", 50) + " │");

      const pHomeClean = prediction.topScorelines
        .filter((s) => s.scoreline.away === 0)
        .reduce((s, x) => s + x.probability, 0);
      const pAwayClean = prediction.topScorelines
        .filter((s) => s.scoreline.home === 0)
        .reduce((s, x) => s + x.probability, 0);
      lines.push("  │ " + pd(h + " portería a cero: ~" + (pHomeClean * 100).toFixed(0) + "%", 50) + " │");
      lines.push("  │ " + pd(a + " portería a cero: ~" + (pAwayClean * 100).toFixed(0) + "%", 50) + " │");

      const upsetNote = prediction.upsetRisk === "high" ? "Alto riesgo de sorpresa" :
        prediction.upsetRisk === "medium" ? "Riesgo medio de sorpresa" : "Bajo riesgo de sorpresa";
      lines.push("  │ " + pd(upsetNote + "  |  " + confLabel.toUpperCase(), 50) + " │");
      lines.push("  └" + "─".repeat(W) + "┘");

      // Metodología
      lines.push("  ┌" + "─".repeat(W) + "┐");
      lines.push("  │ " + pd("METODOLOGÍA", 50) + " │");
      lines.push("  ├" + "─".repeat(W) + "┤");
      lines.push("  │ " + pd("Poisson bivariado + Dixon-Coles", 50) + " │");
      lines.push("  │ " + pd("Rating: " + (homeTeam.ratingValue ?? homeTeam.eloRating) + " vs " + (awayTeam.ratingValue ?? awayTeam.eloRating), 50) + " │");
      lines.push("  │ " + pd("Ajustes contextuales: " + (snapshot.contextAdjustments?.length ?? 0) + " reglas manuales", 50) + " │");
      lines.push("  │ " + pd("Simulacion MC: 10.000 torneos", 50) + " │");
      lines.push("  │ " + pd("Semilla: 2026 (determinista)", 50) + " │");
      lines.push("  └" + "─".repeat(W) + "┘");

      // Ajustes
      if (prediction.contextSummary) {
        lines.push("  ┌" + "─".repeat(W) + "┐");
        lines.push("  │ " + pd("AJUSTES ACTIVOS", 50) + " │");
        lines.push("  ├" + "─".repeat(W) + "┤");
        lines.push("  │ " + pd(prediction.contextSummary, 50) + " │");
        lines.push("  └" + "─".repeat(W) + "┘");
      }

      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(lines.join("\n"));
    } catch (err) {
      res.writeHead(500);
      res.end("Error: " + err.message);
    }
    return;
  }

  // Favicon: return empty
  if (path === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (path === "/api/betting") {
    try {
      const strategy = url.searchParams.get("strategy") || "balanced";
      if (!["conservative", "balanced", "aggressive"].includes(strategy)) {
        res.writeHead(400); res.end("Invalid strategy"); return;
      }

      const completedKeys = new Set(
        snapshot.matchStates
          .filter((m) => m.status === "final")
          .map((m) => m.homeTeamId + "-" + m.awayTeamId)
      );

      const groups = new Map();
      for (const t of snapshot.teams) {
        if (!groups.has(t.groupCode)) groups.set(t.groupCode, []);
        groups.get(t.groupCode).push(t);
      }
      const groupPairs = [[0,1],[2,3],[0,2],[1,3],[1,2],[0,3]];
      const mdLabels = ["MD1", "MD2", "MD3"];
      const upcoming = [];
      let matchNo = 1;
      const sortedGroups = [...groups.entries()].sort((a,b) => a[0].localeCompare(b[0]));
      for (const [gc, list] of sortedGroups) {
        if (list.length !== 4) continue;
        for (let md = 0; md < 3; md++) {
          const [hi, ai] = groupPairs[md * 2];
          const [hi2, ai2] = groupPairs[md * 2 + 1];
          for (const [ha, aa] of [[hi, ai], [hi2, ai2]]) {
            const h = list[ha], a = list[aa];
            const key = h.code + "-" + a.code;
            if (completedKeys.has(key)) continue;
            const ms = snapshot.matchStates.find(m => m.homeTeamId === h.code && m.awayTeamId === a.code);
            const venue = (ms && ms.venueCountryCode) || "USA";
            upcoming.push({
              matchNo: matchNo++,
              matchId: h.code + "-" + a.code,
              homeCode: h.code, awayCode: a.code,
              homeTeam: esName(h), awayTeam: esName(a),
              groupCode: gc, round: mdLabels[md],
              venueCountryCode: venue,
            });
          }
        }
      }

      function enrichMatch(m) {
        const ht = findTeam(snapshot.teams, m.homeCode);
        const at = findTeam(snapshot.teams, m.awayCode);
        if (!ht || !at) return null;
        const pred = predictMatch({
          matchId: m.matchId,
          homeTeam: ht, awayTeam: at, stage: "group",
          modelVersion: snapshot.metadata.modelVersion,
          dataVersion: snapshot.metadata.dataVersion,
          generatedAt: snapshot.metadata.generatedAt,
          venueCountryCode: m.venueCountryCode,
          contextAdjustments: snapshot.contextAdjustments,
        });
        const dist = scoreDistribution(
          { ...ht, isHost: ht.countryCode === m.venueCountryCode },
          { ...at, isHost: at.countryCode === m.venueCountryCode }
        );
        const totalGoals = dist.reduce((s, x) => s + (x.home + x.away) * x.probability, 0);
        const maxG = 6;
        const extendedScorelines = dist
          .slice().sort((a,b) => b.probability - a.probability)
          .slice(0, 15)
          .map(e => ({ scoreline: { home: e.home, away: e.away }, probability: Math.round(e.probability * 10000) / 10000 }));
        const homeGoalsDist = [];
        const awayGoalsDist = [];
        for (let g = 0; g <= maxG; g++) {
          homeGoalsDist.push({ goals: g, probability: Math.round(dist.filter(e => e.home === g).reduce((s,x) => s+x.probability, 0) * 10000) / 10000 });
          awayGoalsDist.push({ goals: g, probability: Math.round(dist.filter(e => e.away === g).reduce((s,x) => s+x.probability, 0) * 10000) / 10000 });
        }
        return {
          ...m,
          homeWin90Prob: pred.homeWin90Prob,
          draw90Prob: pred.draw90Prob,
          awayWin90Prob: pred.awayWin90Prob,
          expectedGoalsHome: pred.expectedGoalsHome,
          expectedGoalsAway: pred.expectedGoalsAway,
          totalXG: Math.round(totalGoals * 100) / 100,
          over15: Math.round(dist.filter(x => (x.home + x.away) >= 2).reduce((s,x)=>s+x.probability,0) * 100) / 100,
          over25: Math.round(dist.filter(x => (x.home + x.away) >= 3).reduce((s,x)=>s+x.probability,0) * 100) / 100,
          over35: Math.round(dist.filter(x => (x.home + x.away) >= 4).reduce((s,x)=>s+x.probability,0) * 100) / 100,
          btts: Math.round(dist.filter(x => x.home > 0 && x.away > 0).reduce((s,x)=>s+x.probability,0) * 100) / 100,
          confidenceLevel: pred.confidenceLevel,
          upsetRisk: pred.upsetRisk,
          topScorelines: pred.topScorelines,
          extendedScorelines,
          homeGoalsDist,
          awayGoalsDist,
          asianHandicap: {
            homeMinus05: Math.round(dist.filter(e => e.home > e.away).reduce((s,x)=>s+x.probability,0) * 10000) / 10000,
            homeMinus1: Math.round(dist.filter(e => e.home - e.away >= 2).reduce((s,x)=>s+x.probability,0) * 10000) / 10000,
            homeMinus2: Math.round(dist.filter(e => e.home - e.away >= 3).reduce((s,x)=>s+x.probability,0) * 10000) / 10000,
            homePlus05: Math.round(dist.filter(e => e.home >= e.away).reduce((s,x)=>s+x.probability,0) * 10000) / 10000,
            awayMinus05: Math.round(dist.filter(e => e.away > e.home).reduce((s,x)=>s+x.probability,0) * 10000) / 10000,
          },
          exactGoals: (() => { const eg=[]; for(let g=0;g<=6;g++) eg.push({goals:g,probability:Math.round(dist.filter(e=>e.home+e.away===g).reduce((s,x)=>s+x.probability,0)*10000)/10000}); return eg; })(),
        };
      }

      const rng = (() => { let s = 0x9E3779B9; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xFFFFFFFF; }; })();
      const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); return (h >>> 0) / 0xFFFFFFFF; };
      };
      function attachMarket(m) {
        const seed = hashStr(m.matchId);
        const margin = 0.06 + seed * 0.04;
        const marketProbs = {
          home: Math.max(0.05, m.homeWin90Prob * (1 + (seed - 0.5) * 0.18)),
          draw: Math.max(0.05, m.draw90Prob * (1 + (rng() - 0.5) * 0.20)),
          away: Math.max(0.05, m.awayWin90Prob * (1 + (rng() - 0.5) * 0.18)),
        };
        const sum = marketProbs.home + marketProbs.draw + marketProbs.away;
        marketProbs.home = marketProbs.home / sum * (1 - margin);
        marketProbs.draw = marketProbs.draw / sum * (1 - margin);
        marketProbs.away = marketProbs.away / sum * (1 - margin);
        const fairOdds = (p) => p > 0 ? Math.round((1 / p) * 100) / 100 : 0;
        const marketOdds = (p) => Math.round((1 / p) * 100) / 100;
        m.market = {
          homeOdds: marketOdds(marketProbs.home),
          drawOdds: marketOdds(marketProbs.draw),
          awayOdds: marketOdds(marketProbs.away),
          homeFair: fairOdds(m.homeWin90Prob),
          drawFair: fairOdds(m.draw90Prob),
          awayFair: fairOdds(m.awayWin90Prob),
          homeValue: Math.round((m.homeWin90Prob * marketOdds(marketProbs.home) - 1) * 100) / 100,
          drawValue: Math.round((m.draw90Prob * marketOdds(marketProbs.draw) - 1) * 100) / 100,
          awayValue: Math.round((m.awayWin90Prob * marketOdds(marketProbs.away) - 1) * 100) / 100,
          margin: Math.round(margin * 1000) / 10,
        };
        return m;
      }

      const issueMatches = upcoming.map(enrichMatch).filter(Boolean).map(attachMarket);

      // Single match analysis
      let matchBetting = null;
      const homeFilter = url.searchParams.get("home");
      const awayFilter = url.searchParams.get("away");
      if (homeFilter && awayFilter) {
        const single = issueMatches.find(m =>
          (m.homeCode === homeFilter && m.awayCode === awayFilter) ||
          (m.homeCode === awayFilter && m.awayCode === homeFilter)
        );
        if (single) {
          const labelOrder = ["3", "1", "0"];
          const probs = { "3": single.homeWin90Prob, "1": single.draw90Prob, "0": single.awayWin90Prob };
          const ranked = labelOrder.map(l => ({ label: l, prob: probs[l] })).sort((a, b) => b.prob - a.prob);
          const top = ranked[0], second = ranked[1], third = ranked[2];
          let labels = [top.label];
          if (strategy === "conservative") {
            if (top.prob < 0.46 || second.prob >= 0.3) labels.push(second.label);
          } else if (strategy === "aggressive") {
            if (top.prob < 0.4 && second.prob >= 0.29) labels.push(second.label);
          } else {
            if (top.prob < 0.45 || second.prob >= 0.27) labels.push(second.label);
            if (top.prob < 0.38 && third.prob >= 0.25) labels.push(third.label);
          }
          if (!labels.includes("1") && probs["1"] >= 0.3 && strategy !== "aggressive") labels.push("1");
          labels = [...new Set(labels)].sort((a, b) => labelOrder.indexOf(a) - labelOrder.indexOf(b));
          const riskTag = top.prob < 0.4 || labels.length === 3 ? "high" : top.prob < 0.5 || labels.length === 2 ? "medium" : "low";
          const confScore = top.prob - second.prob / 2;
          const textMap = { "3": "local", "1": "empate", "0": "visitante" };
          const includesDraw = labels.includes("1");
          let reason = labels.length === 1
            ? `Modelo favorece a ${textMap[top.label]} con ${(top.prob * 100).toFixed(1)}% de probabilidad 90 min`
            : includesDraw
              ? `${textMap[top.label]} favorito (${(top.prob * 100).toFixed(1)}%) pero empate alto (${(probs["1"] * 100).toFixed(1)}%) — se cubre empate`
              : `Partido reñido — se cubren las ${labels.length} opciones más probables`;
          matchBetting = {
            match: single,
            selection: {
              matchNo: 1, matchId: single.matchId,
              homeTeam: single.homeTeam, awayTeam: single.awayTeam,
              homeCode: single.homeCode, awayCode: single.awayCode,
              label310: labels, selection: labels.join(""),
              probabilities: { "3": single.homeWin90Prob, "1": single.draw90Prob, "0": single.awayWin90Prob },
              confidenceScore: Math.round(confScore * 10000) / 10000,
              riskTag,
              reason,
            },
          };
        }
      }

      issueMatches.sort((a, b) => b.homeWin90Prob + b.awayWin90Prob + b.draw90Prob
        - (a.homeWin90Prob + a.awayWin90Prob + a.draw90Prob));
      const selected = issueMatches.slice(0, 14);
      selected.forEach((m, i) => { m.matchNo = i + 1; });
      const issue = {
        id: "wc2026-md2-md3",
        name: "Mundial 2026 - Fechas 2 y 3",
        unitStake: 2,
        modelVersion: snapshot.metadata.modelVersion,
        dataVersion: snapshot.metadata.dataVersion,
        matches: selected,
        disclaimer: "Análisis matemático. No es consejo de compra ni garantiza resultados. Apuesta con responsabilidad.",
      };
      const slip = generateBettingSlip({ issue, strategy, budget: 288, generatedAt: snapshot.metadata.generatedAt });

      // Translate Chinese reasons to Spanish and override Chinese labelToText references
      const labelMap = { "3": "Local", "1": "Empate", "0": "Visitante" };
      function translateSelectionReason(sel) {
        const labels = sel.label310 || [];
        const probs = sel.probabilities || {};
        const top = labels[0];
        const probsArr = ["3","1","0"].map(l => ({ l, p: probs[l] || 0 })).sort((a, b) => b.p - a.p);
        const t = probsArr[0], s = probsArr[1];
        if (labels.length === 1) {
          return `${labelMap[top]} con ${(t.p * 100).toFixed(1)}% — pick simple.`;
        }
        if (labels.includes("1")) {
          return `${labelMap[top]} (${(t.p * 100).toFixed(1)}%) + Empate (${((probs["1"]||0) * 100).toFixed(1)}%) — cubre el empate.`;
        }
        return `${labelMap[top]} (${(t.p * 100).toFixed(1)}%) + ${labelMap[s.l]} (${(s.p * 100).toFixed(1)}%) — cubre los dos resultados más probables.`;
      }
      for (const sel of slip.selections || []) {
        if (sel.reason && /[\u4e00-\u9fff]/.test(sel.reason)) sel.reason = translateSelectionReason(sel);
      }
      if (slip.renxuan9?.selections) {
        for (const sel of slip.renxuan9.selections) {
          if (sel.reason && /[\u4e00-\u9fff]/.test(sel.reason)) sel.reason = translateSelectionReason(sel);
        }
      }
      if (slip.renxuan9?.excludedMatches) {
        for (const em of slip.renxuan9.excludedMatches) {
          if (em.reason && /[\u4e00-\u9fff]/.test(em.reason)) em.reason = "Confianza del modelo relativamente baja o distribución muy pareja.";
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ issue, slip, matchBetting, matchCount: selected.length, totalAvailable: issueMatches.length }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message, stack: e.stack }));
    }
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`🌍 World Cup Predictor: http://localhost:${PORT}`);
  console.log(`📡 API: /api/predict?home=BEL&away=EGY`);
  console.log(`📡 API: /api/simulation`);
  console.log(`📡 API: /api/betting?strategy=balanced`);
  console.log(`📡 API: /api/teams`);
});
