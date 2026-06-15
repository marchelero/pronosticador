#!/usr/bin/env node

import http from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { predictMatch, generateBettingSlip, scoreDistribution } from "../core/index.mjs";
import { simulateTournament } from "../core/index.mjs";
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
    out.homeForm = snapshot.recentForm?.[homeCode]?.slice(0,5) || [];
    out.awayForm = snapshot.recentForm?.[awayCode]?.slice(0,5) || [];
    // Squad info
    out.homeSquad = snapshot.squadInfo?.[homeCode] || null;
    out.awaySquad = snapshot.squadInfo?.[awayCode] || null;
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

      if (format === "json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(prediction));
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
