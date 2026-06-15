#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { predictMatch } from "../core/index.mjs";
import { auditSnapshot, fail, findMatchState, findTeam, parseArgs, readJson } from "./audit-input.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultDataPath = resolve(scriptDir, "../assets/sample-data/worldcup-2026.json");
const usage =
  "Usage: node scripts/predict-match.mjs --home FRA --away BRA --data <audited-snapshot.json> [--match match-id] [--stage group] [--venue-country USA] [--format json|text]";
const args = parseArgs(process.argv.slice(2));

if (args.help || !args.home || !args.away) fail("Missing required --home or --away argument.", usage);

function formatPct(v) {
  return (v * 100).toFixed(1) + "%";
}

function confidenceLabel(v) {
  return { low: "baja", medium: "media", high: "alta" }[v] ?? v;
}

function upsetLabel(v) {
  return { low: "bajo", medium: "medio", high: "alto" }[v] ?? v;
}

function teamInfo(team) {
  const host = team.isHost ? " (anfitrión)" : "";
  return `${team.name} (#${team.fifaRank} FIFA, Elo ${team.eloRating ?? team.ratingValue})${host}`;
}

function pad(v, n) {
  return String(v).padEnd(n);
}

function fmtPct(v) {
  return (v * 100).toFixed(1) + "%";
}

function bar(v, width) {
  const filled = Math.round(v * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function explainText(prediction, homeTeam, awayTeam, matchState) {
  const lines = [];
  const h = homeTeam.name;
  const a = awayTeam.name;
  const W = 52;

  function sep(c) {
    return c.repeat(W);
  }

  function row(l, r) {
    return "  " + pad(l, 36) + "  " + r;
  }

  lines.push("  ┌" + sep("─") + "┐");
  lines.push("  │ " + pad("PREDICCIÓN 90 MINUTOS", 50) + " │");
  lines.push("  │ " + pad(h + " vs " + a, 50) + " │");
  lines.push("  │ " + pad("Etapa: " + (prediction.stage ?? "grupo") + "  Sede: " + (prediction.venueCountryCode ?? "neutral"), 50) + " │");
  if (matchState?.status === "final" && matchState?.actualScore90min) {
    const r = matchState.actualScore90min;
    const dirReal = r.home > r.away ? h : r.away > r.home ? a : "Empate";
    const dirPred = prediction.homeWin90Prob > prediction.awayWin90Prob ? h
      : prediction.awayWin90Prob > prediction.homeWin90Prob ? a : "Empate";
    const acertó = dirReal === dirPred ? "✓" : "✗";
    lines.push("  │ " + pad("", 50) + " │");
    lines.push("  │ " + pad("Resultado real: " + r.home + "-" + r.away + " (" + dirReal + ")", 50) + " │");
    lines.push("  │ " + pad("Pronóstico:     " + dirPred + " " + acertó, 50) + " │");
  }
  lines.push("  └" + sep("─") + "┘");
  lines.push("");

  // ── Tabla de probabilidades 1/X/2 ──
  const hWin = prediction.homeWin90Prob;
  const d = prediction.draw90Prob;
  const aWin = prediction.awayWin90Prob;
  const winner = hWin > aWin ? h : aWin > hWin ? a : "Empate";
  const barW = 20;

  lines.push("  ┌" + sep("─") + "┐");
  lines.push("  │ " + pad("RESULTADO (1 / X / 2)", 50) + " │");
  lines.push("  ├" + sep("─") + "┤");
  lines.push("  │ 1  " + pad(h, 18) + bar(hWin, barW) + "  " + pad(fmtPct(hWin), 7) + " │");
  lines.push("  │ X  " + pad("Empate", 18) + bar(d, barW) + "  " + pad(fmtPct(d), 7) + " │");
  lines.push("  │ 2  " + pad(a, 18) + bar(aWin, barW) + "  " + pad(fmtPct(aWin), 7) + " │");
  lines.push("  ├" + sep("─") + "┤");
  lines.push("  │ " + pad("Favorito: " + winner + "  |  Confianza: " + confidenceLabel(prediction.confidenceLevel) + "  |  Sorpresa: " + upsetLabel(prediction.upsetRisk), 50) + " │");
  lines.push("  └" + sep("─") + "┘");
  lines.push("");

  // ── Goles esperados ──
  const xGH = prediction.expectedGoalsHome;
  const xGA = prediction.expectedGoalsAway;
  const totalXG = xGH + xGA;
  lines.push("  ┌" + sep("─") + "┐");
  lines.push("  │ " + pad("GOLES ESPERADOS (xG)", 50) + " │");
  lines.push("  ├" + sep("─") + "┤");
  lines.push("  │ " + pad(h, 18) + "  " + pad(xGH.toFixed(2), 7) + bar(xGH / 3, barW) + "  │");
  lines.push("  │ " + pad(a, 18) + "  " + pad(xGA.toFixed(2), 7) + bar(xGA / 3, barW) + "  │");
  lines.push("  ├" + sep("─") + "┤");
  lines.push("  │ " + pad("Total: " + totalXG.toFixed(2) + "  |  Over 2.5: " + (totalXG > 2.5 ? "más probable" : "menos probable"), 50) + " │");
  lines.push("  └" + sep("─") + "┘");
  lines.push("");

  // ── Marcadores probables ──
  lines.push("  ┌" + sep("─") + "┐");
  lines.push("  │ " + pad("MARCADORES MÁS PROBABLES", 50) + " │");
  lines.push("  ├" + sep("─") + "┤");
  for (const s of prediction.topScorelines) {
    const label =
      s.scoreline.home > s.scoreline.away
        ? "→ " + h
        : s.scoreline.home < s.scoreline.away
          ? "→ " + a
          : "→ Empate";
    const scoreStr = s.scoreline.home + "-" + s.scoreline.away;
    lines.push("  │ " + pad(scoreStr, 8) + bar(s.probability, barW) + "  " + pad(fmtPct(s.probability), 7) + label.padEnd(18) + " │");
  }
  lines.push("  └" + sep("─") + "┘");
  lines.push("");

  // ── Comparativa de fuerza ──
  lines.push("  ┌" + sep("─") + "┐");
  lines.push("  │ " + pad("COMPARATIVA DE FUERZA", 50) + " │");
  lines.push("  ├" + sep("─") + "┤");
  lines.push("  │ " + pad("Equipo", 14) + "  Rating   Ataque   Defensa  Forma     │");
  lines.push("  │ " + pad(h, 14) + "  " + pad(homeTeam.ratingValue ?? homeTeam.eloRating, 7) + " " + pad(homeTeam.attackStrength?.toFixed(3) ?? "-", 7) + " " + pad(homeTeam.defenseStrength?.toFixed(3) ?? "-", 7) + " " + pad(String(homeTeam.formScore ?? "-"), 7) + " │");
  lines.push("  │ " + pad(a, 14) + "  " + pad(awayTeam.ratingValue ?? awayTeam.eloRating, 7) + " " + pad(awayTeam.attackStrength?.toFixed(3) ?? "-", 7) + " " + pad(awayTeam.defenseStrength?.toFixed(3) ?? "-", 7) + " " + pad(String(awayTeam.formScore ?? "-"), 7) + " │");
  lines.push("  └" + sep("─") + "┘");
  lines.push("");

  // ── Análisis ──
  lines.push("  ┌" + sep("─") + "┐");
  lines.push("  │ " + pad("ANÁLISIS", 50) + " │");
  lines.push("  ├" + sep("─") + "┤");
  const diff = Math.abs(xGH - xGA);
  if (diff > 0.4) {
    lines.push("  │ " + pad(h + " genera " + xGH.toFixed(2) + " xG vs " + xGA.toFixed(2) + " de " + a, 50) + " │");
  } else {
    lines.push("  │ " + pad("Partido muy parejo: xG " + xGH.toFixed(2) + "-" + xGA.toFixed(2), 50) + " │");
  }
  const bothScore = prediction.topScorelines
    .filter((s) => s.scoreline.home > 0 && s.scoreline.away > 0)
    .reduce((s, x) => s + x.probability, 0);
  lines.push("  │ " + pad("BTTS ~" + (bothScore * 100).toFixed(0) + "%  |  Confianza: " + confidenceLabel(prediction.confidenceLevel), 50) + " │");
  lines.push("  └" + sep("─") + "┘");
  lines.push("");

  if (prediction.contextSummary) {
    lines.push("  Ajustes: " + prediction.contextSummary);
    lines.push("");
  }

  lines.push("  ═".repeat(28));
  lines.push("  Solo 90 min + añadido. No incluye prórroga/penaltis.");
  lines.push("  El fútbol tiene alta variabilidad. Resultados con");
  lines.push("  25% de probabilidad ocurren 1 de cada 4 veces.");
  return lines.join("\n");
}

try {
  const snapshot = auditSnapshot(readJson(args.data || defaultDataPath));
  const homeTeam = findTeam(snapshot.teams, args.home);
  const awayTeam = findTeam(snapshot.teams, args.away);
  if (!homeTeam) throw new Error(`Home team not found: ${args.home}`);
  if (!awayTeam) throw new Error(`Away team not found: ${args.away}`);
  if (homeTeam.id === awayTeam.id) throw new Error("Home and away teams must be different.");

  const matchState = findMatchState(snapshot, homeTeam, awayTeam, args.match);
  const prediction = predictMatch({
    matchId: args.match || matchState?.matchId,
    homeTeam,
    awayTeam,
    stage: args.stage || matchState?.stage,
    modelVersion: snapshot.metadata.modelVersion,
    dataVersion: snapshot.metadata.dataVersion,
    generatedAt: snapshot.metadata.generatedAt,
    venueCountryCode: args["venue-country"] || matchState?.venueCountryCode,
    contextAdjustments: snapshot.contextAdjustments,
  });

  // Add stage and venue to output for text mode
  prediction.stage = args.stage || matchState?.stage || "group";
  prediction.venueCountryCode = args["venue-country"] || matchState?.venueCountryCode || "neutral";

  if (args.format === "text") {
    console.log(explainText(prediction, homeTeam, awayTeam, matchState));
  } else {
    // Default: clean JSON without the extra fields we added
    const out = { ...prediction };
    delete out.stage;
    delete out.venueCountryCode;
    console.log(JSON.stringify(out, null, 2));
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), usage);
}
