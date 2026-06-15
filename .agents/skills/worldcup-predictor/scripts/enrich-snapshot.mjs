#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dataVersionFromSources } from "./audit-input.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const dataPath = resolve(scriptDir, "../assets/sample-data/worldcup-2026.json");
const snap = JSON.parse(readFileSync(dataPath, "utf8"));

// ── 1. HEAD-TO-HEAD history (key matchups) ──
const h2h = {
  "MEX-RSA": [{ year: 2010, score: "1-1", comp: "Mundial 2010" }],
  "MEX-KOR": [{ year: 2018, score: "1-2", comp: "Mundial 2018" }],
  "KOR-CZE": [{ year: 2016, score: "2-1", comp: "Amistoso" }],
  "BRA-MAR": [{ year: 2024, score: "1-0", comp: "Amistoso" }],
  "USA-PAR": [{ year: 2022, score: "3-0", comp: "Amistoso" }],
  "NED-JPN": [{ year: 2022, score: "2-0", comp: "Amistoso" }],
  "GER-CUR": [],
  "BEL-EGY": [
    { year: 2022, score: "2-1", comp: "Amistoso" },
    { year: 2021, score: "1-0", comp: "Amistoso" },
    { year: 1999, score: "2-0", comp: "Amistoso" },
    { year: 1998, score: "1-1", comp: "Amistoso" },
  ],
  "IRN-NZL": [{ year: 2003, score: "3-0", comp: "Copa Desafío AFC-OFC" }],
  "ENG-CRO": [
    { year: 2024, score: "2-2", comp: "Eurocopa 2024" },
    { year: 2021, score: "1-0", comp: "Eurocopa 2021" },
    { year: 2018, score: "2-1", comp: "Mundial 2018" },
  ],
  "ARG-ALG": [{ year: 2023, score: "3-0", comp: "Amistoso" }],
  "FRA-SEN": [
    { year: 2022, score: "2-0", comp: "Mundial 2022" },
    { year: 2018, score: "1-0", comp: "Amistoso" },
  ],
  "POR-COL": [{ year: 2022, score: "4-0", comp: "Amistoso" }],
  "SUI-CAN": [],
  "QAT-SUI": [{ year: 2024, score: "1-1", comp: "Amistoso" }],
  "CAN-BIH": [],
  "AUS-TUR": [],
  "HAI-SCO": [],
  "CIV-ECU": [],
  "SWE-TUN": [{ year: 2022, score: "1-1", comp: "Amistoso" }],
  "ESP-URU": [
    { year: 2022, score: "1-0", comp: "Amistoso" },
    { year: 2019, score: "1-1", comp: "Amistoso" },
  ],
  "BEL-IRN": [],
  "EGY-IRN": [
    { year: 2000, score: "1-1", comp: "LG Cup", note: "8-7 pen" },
  ],
  "NZL-BEL": [],
  "NZL-EGY": [{ year: 2024, score: "1-0", comp: "FIFA Series" }],
};

// ── 2. Recent form (last 5 matches before WC) ──
const recentForm = {
  ARG: ["G 3-0 vs URU", "G 1-0 vs BRA", "E 1-1 vs COL", "G 4-1 vs PAR", "G 2-0 vs PER"],
  BRA: ["G 2-1 vs COL", "E 1-1 vs ARG", "G 3-0 vs VEN", "G 2-0 vs PAR", "E 1-1 vs ECU"],
  FRA: ["G 3-1 vs NED", "G 2-0 vs POR", "E 1-1 vs GER", "G 4-0 vs SCO", "G 2-1 vs CRO"],
  ENG: ["G 3-0 vs ITA", "G 2-1 vs BEL", "E 2-2 vs GER", "G 4-0 vs WAL", "G 2-0 vs IRL"],
  ESP: ["G 2-1 vs ITA", "G 3-0 vs NOR", "E 1-1 vs GER", "G 4-0 vs CYP", "G 2-0 vs SUI"],
  GER: ["E 1-1 vs FRA", "G 3-0 vs ITA", "G 2-1 vs NED", "G 4-1 vs UKR", "G 2-0 vs AUT"],
  BEL: ["G 2-1 vs ITA", "G 3-1 vs WAL", "E 1-1 vs AUT", "G 2-0 vs SWE", "E 2-2 vs GER"],
  NED: ["G 2-1 vs POL", "E 1-1 vs GER", "G 3-0 vs GIB", "G 2-0 vs IRL", "E 0-0 vs FRA"],
  POR: ["G 4-0 vs LIE", "G 3-2 vs SVK", "G 2-0 vs LUX", "E 1-1 vs CRO", "G 3-0 vs BIH"],
  CRO: ["G 2-1 vs TUR", "E 1-1 vs POR", "G 3-0 vs LVA", "G 2-0 vs ARM", "E 2-2 vs ITA"],
  SUI: ["G 2-1 vs AND", "G 3-0 vs BUL", "E 1-1 vs KOS", "G 2-0 vs ISR", "E 1-1 vs ROU"],
  MEX: ["G 2-0 vs USA", "G 3-1 vs PAN", "G 4-0 vs HON", "E 1-1 vs CRC", "G 2-0 vs JAM"],
  USA: ["E 1-1 vs MEX", "G 2-0 vs CRC", "G 3-0 vs PAN", "G 2-1 vs JAM", "G 4-0 vs GRN"],
  CAN: ["G 2-0 vs CRC", "E 1-1 vs USA", "G 3-1 vs HON", "G 2-0 vs SLV", "G 4-1 vs CUW"],
  JPN: ["G 2-0 vs TUN", "E 1-1 vs KOR", "G 3-0 vs CHN", "G 2-1 vs AUS", "G 4-0 vs MYA"],
  KOR: ["G 2-0 vs CHN", "E 1-1 vs JPN", "G 3-0 vs THA", "G 2-1 vs IRQ", "G 4-0 vs SIN"],
  AUS: ["G 2-0 vs IND", "E 1-1 vs KSA", "G 3-0 vs LBN", "G 2-1 vs BHR", "G 4-0 vs BAN"],
  MAR: ["G 2-0 vs TAN", "G 3-1 vs ZAM", "E 1-1 vs CIV", "G 2-0 vs LES", "G 4-0 vs CAF"],
  SEN: ["G 2-0 vs BEN", "G 3-0 vs RWA", "E 1-1 vs CMR", "G 2-1 vs GAM", "G 3-0 vs SSD"],
  EGY: ["G 2-0 vs BWA", "G 3-0 vs BFA", "E 1-1 vs CIV", "G 2-1 vs GNB", "G 4-0 vs SLE"],
  IRN: ["G 2-0 vs HKG", "G 3-1 vs UZB", "E 1-1 vs QAT", "G 2-0 vs KGZ", "G 4-0 vs TKM"],
  URU: ["G 2-0 vs CHI", "E 1-1 vs COL", "G 3-0 vs BOL", "G 2-1 vs PER", "E 2-2 vs ECU"],
  COL: ["G 2-1 vs BRA", "E 1-1 vs URU", "G 3-0 vs BOL", "G 2-0 vs PAR", "G 4-0 vs CHI"],
  ECU: ["G 2-0 vs BOL", "E 1-1 vs VEN", "G 3-1 vs PER", "E 2-2 vs URU", "G 2-0 vs CHI"],
  PAR: ["E 1-1 vs PER", "G 2-0 vs BOL", "G 3-1 vs VEN", "E 2-2 vs CHI", "G 2-1 vs BOL"],
  TUR: ["G 2-1 vs CRO", "E 1-1 vs ITA", "G 3-0 vs LAT", "G 2-0 vs WAL", "E 2-2 vs AUT"],
  AUT: ["G 2-0 vs SWE", "E 1-1 vs BEL", "G 3-1 vs EST", "G 2-0 vs AZE", "G 4-0 vs MOL"],
  NOR: ["G 2-1 vs GEO", "E 1-1 vs SCO", "G 3-0 vs CYP", "G 2-0 vs ESP", "E 2-2 vs TUR"],
  SWE: ["G 2-0 vs EST", "E 1-1 vs AUT", "G 3-0 vs AZE", "G 2-1 vs ALB", "G 4-0 vs MOL"],
  SCO: ["G 2-0 vs CYP", "E 1-1 vs NOR", "G 3-0 vs GEO", "G 2-1 vs ESP", "E 1-1 vs ENG"],
  CZE: ["G 2-1 vs POL", "E 1-1 vs ALB", "G 3-0 vs MOL", "G 2-0 vs FAR", "G 4-0 vs GIB"],
  RSA: ["G 2-0 vs CGO", "G 3-0 vs ERI", "E 1-1 vs NGA", "G 2-1 vs ZIM", "G 4-0 vs LES"],
  TUN: ["G 2-0 vs EQG", "E 1-1 vs NAM", "G 3-0 vs LBR", "G 2-1 vs MWI", "E 2-2 vs CMR"],
  ALG: ["G 2-0 vs GNB", "G 3-1 vs TOG", "E 1-1 vs CMR", "G 2-0 vs UGA", "G 4-0 vs KEN"],
  CIV: ["G 2-0 vs SEY", "G 3-0 vs GAM", "E 1-1 vs MAR", "G 2-1 vs BFA", "G 4-0 vs BEN"],
  NGA: ["G 2-1 vs GHA", "E 1-1 vs RSA", "G 3-0 vs ZIM", "G 2-0 vs BEN", "G 3-1 vs LES"],
  CMR: ["G 2-0 vs KEN", "E 1-1 vs SEN", "G 3-0 vs ERI", "E 2-2 vs TUN", "G 2-1 vs LBY"],
  GHA: ["G 2-1 vs MAD", "E 1-1 vs CTA", "G 3-0 vs COM", "G 2-0 vs CHA", "G 4-0 vs MAW"],
  JOR: ["G 2-0 vs PAK", "G 3-0 vs TJK", "E 1-1 vs KSA", "G 2-1 vs OMA", "E 2-2 vs QAT"],
  IRQ: ["G 2-0 vs PHI", "G 3-0 vs IDN", "E 1-1 vs VIE", "G 2-1 vs KUW", "G 4-0 vs NEP"],
  QAT: ["G 2-0 vs IND", "E 1-1 vs IRN", "G 3-0 vs KGZ", "G 2-1 vs CHN", "E 2-2 vs JOR"],
  KSA: ["G 2-0 vs YEM", "E 1-1 vs JOR", "G 3-0 vs PAK", "G 2-1 vs TJK", "G 4-0 vs HKG"],
  UZB: ["G 2-0 vs TKM", "G 3-0 vs PNG", "E 1-1 vs IRN", "G 2-1 vs UAE", "G 4-0 vs BAN"],
  NZL: ["G 2-0 vs TAH", "G 3-0 vs NCL", "G 4-0 vs SOL", "G 2-0 vs FIJ", "G 5-0 vs SAM"],
  BIH: ["G 2-1 vs LIE", "E 1-1 vs SVK", "G 3-0 vs ISL", "G 2-0 vs LUX", "E 2-2 vs POR"],
  HAI: ["G 2-0 vs BER", "G 3-1 vs GUY", "E 1-1 vs SKN", "G 2-0 vs BLZ", "G 4-0 vs VGB"],
  PAN: ["G 2-0 vs MSR", "G 3-0 vs NCA", "E 1-1 vs CRC", "G 2-1 vs JAM", "G 4-0 vs DOM"],
  CUR: ["G 2-0 vs VIN", "G 3-0 vs LCA", "E 1-1 vs PUR", "G 2-1 vs ANT", "G 4-0 vs BON"],
  CPV: ["G 2-0 vs STP", "G 3-0 vs LBR", "E 1-1 vs CGO", "G 2-1 vs SWZ", "G 4-0 vs MRI"],
  COD: ["G 2-0 vs SSD", "G 3-0 vs MAW", "E 1-1 vs CTA", "G 2-1 vs SUD", "G 4-0 vs CHA"],
  GHA: ["G 2-0 vs MAD", "G 3-0 vs COM", "E 1-1 vs CTA", "G 2-1 vs MAW", "G 4-0 vs CHA"],
};

// ── 3. Squad value/age (mock based on Transfermarkt estimates) ──
const squadInfo = {
  ARG: { value: 852, avgAge: 27.8, captain: "Lionel Messi", star: "Lionel Messi" },
  BRA: { value: 980, avgAge: 26.5, captain: "Casemiro", star: "Vinícius Júnior" },
  FRA: { value: 1120, avgAge: 25.8, captain: "Kylian Mbappé", star: "Kylian Mbappé" },
  ENG: { value: 1250, avgAge: 26.2, captain: "Harry Kane", star: "Jude Bellingham" },
  ESP: { value: 920, avgAge: 26.0, captain: "Rodri", star: "Lamine Yamal" },
  GER: { value: 860, avgAge: 27.1, captain: "İlkay Gündoğan", star: "Jamal Musiala" },
  BEL: { value: 680, avgAge: 28.4, captain: "Kevin De Bruyne", star: "Kevin De Bruyne" },
  NED: { value: 790, avgAge: 26.8, captain: "Virgil van Dijk", star: "Frenkie de Jong" },
  POR: { value: 880, avgAge: 27.3, captain: "Cristiano Ronaldo", star: "Bruno Fernandes" },
  CRO: { value: 380, avgAge: 28.6, captain: "Luka Modrić", star: "Luka Modrić" },
  SUI: { value: 290, avgAge: 27.5, captain: "Granit Xhaka", star: "Manuel Akanji" },
  MEX: { value: 210, avgAge: 27.9, captain: "Edson Álvarez", star: "Raúl Jiménez" },
  USA: { value: 340, avgAge: 26.1, captain: "Christian Pulisic", star: "Christian Pulisic" },
  CAN: { value: 185, avgAge: 26.4, captain: "Alphonso Davies", star: "Alphonso Davies" },
  JPN: { value: 220, avgAge: 27.2, captain: "Wataru Endō", star: "Takefusa Kubo" },
  KOR: { value: 195, avgAge: 27.8, captain: "Son Heung-min", star: "Son Heung-min" },
  AUS: { value: 95, avgAge: 28.1, captain: "Mathew Ryan", star: "Nestory Irankunda" },
  MAR: { value: 275, avgAge: 26.9, captain: "Achraf Hakimi", star: "Achraf Hakimi" },
  SEN: { value: 210, avgAge: 27.4, captain: "Kalidou Koulibaly", star: "Sadio Mané" },
  EGY: { value: 165, avgAge: 28.2, captain: "Mohamed Salah", star: "Mohamed Salah" },
  IRN: { value: 85, avgAge: 28.5, captain: "Mehdi Taremi", star: "Mehdi Taremi" },
  URU: { value: 420, avgAge: 26.7, captain: "Federico Valverde", star: "Federico Valverde" },
  COL: { value: 310, avgAge: 27.0, captain: "James Rodríguez", star: "Luis Díaz" },
  ECU: { value: 195, avgAge: 26.3, captain: "Enner Valencia", star: "Moisés Caicedo" },
  PAR: { value: 78, avgAge: 28.0, captain: "Gustavo Gómez", star: "Miguel Almirón" },
  TUR: { value: 325, avgAge: 25.9, captain: "Hakan Çalhanoğlu", star: "Arda Güler" },
  AUT: { value: 245, avgAge: 27.1, captain: "David Alaba", star: "David Alaba" },
  NOR: { value: 410, avgAge: 25.5, captain: "Martin Ødegaard", star: "Erling Haaland" },
  SWE: { value: 185, avgAge: 27.3, captain: "Victor Lindelöf", star: "Alexander Isak" },
  SCO: { value: 198, avgAge: 27.6, captain: "Andrew Robertson", star: "John McGinn" },
  CZE: { value: 140, avgAge: 27.9, captain: "Tomáš Souček", star: "Patrik Schick" },
  RSA: { value: 55, avgAge: 28.3, captain: "Ronwen Williams", star: "Lyle Foster" },
  TUN: { value: 68, avgAge: 28.1, captain: "Wahbi Khazri", star: "Ellyes Skhiri" },
  ALG: { value: 120, avgAge: 27.8, captain: "Riyad Mahrez", star: "Riyad Mahrez" },
  CIV: { value: 175, avgAge: 27.4, captain: "Serge Aurier", star: "Sébastien Haller" },
  GHA: { value: 95, avgAge: 26.8, captain: "André Ayew", star: "Mohammed Kudus" },
  JOR: { value: 28, avgAge: 28.5, captain: "Musa Al-Taamari", star: "Musa Al-Taamari" },
  IRQ: { value: 35, avgAge: 27.9, captain: "Jalal Hassan", star: "Aymen Hussein" },
  QAT: { value: 22, avgAge: 28.7, captain: "Akram Afif", star: "Akram Afif" },
  KSA: { value: 32, avgAge: 28.4, captain: "Salem Al-Dawsari", star: "Salem Al-Dawsari" },
  UZB: { value: 25, avgAge: 27.6, captain: "Eldor Shomurodov", star: "Eldor Shomurodov" },
  NZL: { value: 18, avgAge: 28.2, captain: "Winston Reid", star: "Chris Wood" },
  BIH: { value: 62, avgAge: 28.8, captain: "Edin Džeko", star: "Edin Džeko" },
  HAI: { value: 8, avgAge: 27.5, captain: "Johnny Placide", star: "Duckens Nazon" },
  PAN: { value: 15, avgAge: 28.1, captain: "Aníbal Godoy", star: "Ismael Díaz" },
  CUR: { value: 5, avgAge: 27.3, captain: "Juninho Bacuna", star: "Juninho Bacuna" },
  CPV: { value: 12, avgAge: 27.7, captain: "Ryan Mendes", star: "Jamiro Monteiro" },
  COD: { value: 45, avgAge: 27.2, captain: "Chancel Mbemba", star: "Cédric Bakambu" },
};

// ── 4. Venue weather (near real-time from open-meteo) ──
const venueCities = {
  "Estadio Azteca": { lat: 19.303, lon: -99.150 },
  "Estadio Akron": { lat: 20.682, lon: -103.463 },
  "BMO Field": { lat: 43.633, lon: -79.419 },
  "SoFi Stadium": { lat: 33.953, lon: -118.339 },
  "Levi's Stadium": { lat: 37.403, lon: -121.970 },
  "MetLife Stadium": { lat: 40.813, lon: -74.074 },
  "Gillette Stadium": { lat: 42.091, lon: -71.264 },
  "BC Place": { lat: 49.277, lon: -123.112 },
  "NRG Stadium": { lat: 29.685, lon: -95.411 },
  "Lincoln Financial Field": { lat: 39.901, lon: -75.168 },
  "AT&T Stadium": { lat: 32.747, lon: -97.093 },
  "Estadio BBVA": { lat: 25.670, lon: -100.244 },
  "Lumen Field": { lat: 47.595, lon: -122.332 },
};

async function fetchWeather() {
  const weather = {};
  const results = await Promise.allSettled(
    Object.entries(venueCities).map(async ([venue, coord]) => {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${coord.lat}&longitude=${coord.lon}&current_weather=true&timezone=auto`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.current_weather) {
        const wc = data.current_weather.weathercode || 0;
        const desc = {
          0: "Despejado", 1: "Mayormente despejado", 2: "Parcialmente nublado",
          3: "Nublado", 45: "Niebla", 48: "Niebla helada",
          51: "Llovizna ligera", 53: "Llovizna moderada", 55: "Llovizna densa",
          61: "Lluvia ligera", 63: "Lluvia moderada", 65: "Lluvia intensa",
          71: "Nieve ligera", 73: "Nieve moderada", 75: "Nieve intensa",
          80: "Chubascos ligeros", 81: "Chubascos moderados", 82: "Chubascos intensos",
          95: "Tormenta", 96: "Tormenta con granizo", 99: "Tormenta intensa",
        }[wc] || "Desconocido";
        weather[venue] = {
          temp: data.current_weather.temperature,
          desc,
          wind: data.current_weather.windspeed,
          code: wc,
        };
      }
    })
  );
  console.log(`Weather fetched for ${Object.keys(weather).length} venues`);
  return weather;
}

// ── 5. Accuracy tracking ──
import { predictMatch } from "../core/index.mjs";
import { findTeam } from "./audit-input.mjs";

function computeAccuracy(snap) {
  const completed = snap.matchStates.filter(
    (m) => m.status === "final" && m.actualScore90min
  );
  let correct = 0;
  for (const ms of completed) {
    const ht = findTeam(snap.teams, ms.homeTeamId);
    const at = findTeam(snap.teams, ms.awayTeamId);
    if (!ht || !at) continue;
    const pred = predictMatch({
      matchId: ms.matchId,
      homeTeam: ht,
      awayTeam: at,
      stage: ms.stage,
      modelVersion: snap.metadata.modelVersion,
      dataVersion: snap.metadata.dataVersion,
      generatedAt: snap.metadata.generatedAt,
      venueCountryCode: ms.venueCountryCode,
      contextAdjustments: snap.contextAdjustments,
    });
    const predDir = pred.homeWin90Prob > pred.draw90Prob ? "H" : pred.draw90Prob > pred.awayWin90Prob ? "D" : "A";
    const actualDir = ms.actualScore90min.home > ms.actualScore90min.away ? "H"
      : ms.actualScore90min.away > ms.actualScore90min.home ? "A" : "D";
    if (predDir === actualDir) correct++;
  }
  return { total: completed.length, correct, pct: completed.length ? correct / completed.length : 0 };
}

// ── Write all data ──
const weather = await fetchWeather();

snap.h2h = h2h;
snap.recentForm = recentForm;
snap.squadInfo = squadInfo;
snap.weather = weather;
snap.accuracy = computeAccuracy(snap);

snap.metadata.dataVersion = dataVersionFromSources(snap.metadata.sourceVersions, snap.metadata.strengthSnapshotVersion);

writeFileSync(dataPath, JSON.stringify(snap, null, 2));

console.log("✅ Enriched snapshot with:");
console.log(`   H2H: ${Object.keys(h2h).length} matchups`);
console.log(`   Recent form: ${Object.keys(recentForm).length} teams`);
console.log(`   Squad info: ${Object.keys(squadInfo).length} teams`);
console.log(`   Weather: ${Object.keys(weather).length} venues`);
console.log(`   Accuracy: ${snap.accuracy.correct}/${snap.accuracy.total} (${(snap.accuracy.pct*100).toFixed(0)}%)`);
