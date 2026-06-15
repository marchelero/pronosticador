# ⚽ Pronosticador Mundial 2026

Predictor de partidos del Mundial 2026 con modelo Poisson + Dixon-Coles y simulación Monte Carlo.

## ✨ Características

- **48 equipos reales** con grupos oficiales del Mundial 2026
- **Resultados de Fecha 1** (12 partidos jugados, goleadores, tarjetas)
- **Predicción 90 min** con probabilidades 1/X/2, xG, marcadores probables
- **Simulación Monte Carlo** (10.000 torneos) — probabilidades de campeón, clasificación, etc.
- **Recalibración automática** post-jornada — ajusta ratings según rendimiento real
- **Datos enriquecidos**: historial H2H, forma reciente, valor de plantilla, clima en sede
- **Frontend web** con interfaz visual y API REST

## 🚀 Inicio rápido

```bash
# Servidor web (http://localhost:3030)
npm run server:start

# Ver estado
npm run server:status

# Detener
npm run server:stop

# Predicción desde CLI
npm run predict -- --home BEL --away EGY --format text

# Simular torneo
npm run simulate -- --simulations 10000 --seed 2026
```

## 📡 API REST

| Endpoint | Descripción |
|----------|-------------|
| `GET /` | Frontend web |
| `GET /api/teams` | Lista de 48 equipos con nombres en español |
| `GET /api/predict?home=BEL&away=EGY` | Predicción en texto |
| `GET /api/predict?home=BEL&away=EGY&format=json` | Predicción en JSON |
| `GET /api/simulation` | Probabilidades del torneo (campeón, rondas) |
| `GET /api/stats` | Goleadores, tabla de posiciones, tarjetas |
| `GET /api/enriched?home=BEL&away=EGY` | H2H, forma, plantilla, clima, escenario de grupo |

## 🧠 Modelo

- **Poisson bivariado** con corrección **Dixon-Coles** para partidos de baja anotación
- **xG** calculado de rating Elo, attackStrength, defenseStrength y formScore
- **Monte Carlo**: 10.000 torneos completos con siembra determinista
- **Calibración**: los ratings se ajustan automáticamente tras cada jornada

## 📁 Estructura

```
├── package.json              # Scripts npm (server, predict, simulate, calibrate)
├── .agents/
│   └── skills/worldcup-predictor/
│       ├── core/             # Motor de predicción (Poisson + Dixon-Coles)
│       ├── scripts/          # predict-match, predict-server, calibrate, enrich
│       ├── public/           # Frontend HTML
│       ├── assets/           # Snapshots de datos
│       └── references/       # Documentación del modelo
```

## 🔄 Post-jornada

```bash
# 1. Agregar resultados al snapshot (editar assets/sample-data/worldcup-2026.json)
# 2. Recalibrar ratings
npm run calibrate
# 3. Agregar goleadores/tarjetas
node .agents/skills/worldcup-predictor/scripts/add-match-details.mjs
# 4. Enriquecer datos (clima, etc.)
node .agents/skills/worldcup-predictor/scripts/enrich-snapshot.mjs
# 5. Reiniciar servidor
npm run server:restart
```
