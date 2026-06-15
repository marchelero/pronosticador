#!/usr/bin/env node

import http from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { predictMatch } from "../core/index.mjs";
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
  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`🌍 World Cup Predictor: http://localhost:${PORT}`);
  console.log(`📡 API: /api/predict?home=BEL&away=EGY`);
  console.log(`📡 API: /api/simulation`);
  console.log(`📡 API: /api/teams`);
});
