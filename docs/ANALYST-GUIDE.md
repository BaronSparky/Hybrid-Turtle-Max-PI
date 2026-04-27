# AI Analyst — Operating Guide

Local Ollama-powered analyst for HybridTurtle. Read-only, advisory-only.

---

## Quick Start

### 1. Install Ollama

Download from [ollama.com](https://ollama.com/download) and install.

### 2. Pull a Model

```bash
# Recommended: Gemma 3 4B (fast, ~2.5GB)
ollama pull gemma3:4b

# Or larger for better quality (~7GB)
ollama pull gemma3:12b

# Or any model you prefer
ollama pull llama3.2:3b
ollama pull mistral:7b
```

### 3. Start Ollama

```bash
ollama serve
```

Ollama runs on `http://localhost:11434` by default.

### 4. Start Dashboard

```bash
npm run dev
```

The AI Analyst card appears on the dashboard automatically. If Ollama is offline, it shows "Analyst offline" — the rest of the dashboard works normally.

---

## Features

### Dashboard Summary Card
- Location: Dashboard page, below Today's Directive
- Shows plain-English summary of today's system state
- Includes: regime, positions, risk, candidates, stops, health
- Model selector: click the gear icon to switch between installed models
- Refresh: click the refresh icon to regenerate

### Candidate Explanations
- Endpoint: `POST /api/analyst/explain`
- Body: `{ "type": "candidate", "ticker": "AAPL" }`
- Returns plain-English explanation of why a candidate has its status

### Stop Explanations
- Endpoint: `POST /api/analyst/explain`
- Body: `{ "type": "stop", "ticker": "MSFT" }` or `{ "type": "stop", "positionId": "..." }`
- Returns plain-English explanation of stop level and R-multiple

### Journal Drafting
- Endpoint: `POST /api/analyst/journal`
- Body: `{ "positionId": "...", "type": "entry" | "close" | "lesson" }`
- Returns structured journal draft (user must manually save/edit)

### Health Check
- Endpoint: `GET /api/analyst/health`
- Returns Ollama connectivity, available models, latency

---

## Model Selection

All endpoints accept an optional `model` parameter to use a specific model:

```
GET /api/analyst/summary?model=gemma3:12b
GET /api/analyst/health?model=llama3.2:3b
POST /api/analyst/explain  { "model": "mistral:7b", ... }
POST /api/analyst/journal  { "model": "gemma3:4b", ... }
```

The dashboard card has a built-in model picker (gear icon) showing all installed models with sizes.

If no model is specified, the system picks automatically:
1. Gemma models (preferred)
2. Llama models (fallback)
3. First available model

---

## Safety Boundaries

The analyst module has hard safety boundaries that cannot be bypassed:

| Boundary | How It's Enforced |
|----------|-------------------|
| No trade execution | Module never imports broker, execution, or position-creation code |
| No stop modification | Module never imports stop-manager write functions |
| No settings changes | Module never calls PUT/POST on settings endpoints |
| No DB writes | All API routes use only read queries (findFirst, findMany) |
| No credential exposure | safety-filter.ts strips secrets, tokens, keys before prompt assembly |
| No action directives | System prompt constrains model; safety-filter checks response |
| Hallucination guard | Response checked for numbers not present in source data |
| Disclaimer | Every response is prefixed with "Advisory only — verify against dashboard" |
| Graceful degradation | If Ollama is offline, endpoints return `{ available: false }` |

### Sacred Files Never Touched

These files are NOT imported, read, or modified by the analyst:
- `stop-manager.ts` — monotonic stop enforcement
- `position-sizer.ts` — risk-based sizing
- `risk-gates.ts` — 6-gate validation
- `regime-detector.ts` — market regime detection
- `scan-engine.ts` — 7-stage scan pipeline
- `dual-score.ts` — BQS/FWS/NCS scoring
- `scan-guards.ts` — anti-chase guard
- `trading212.ts` — broker API

---

## Custom Ollama URL

By default, the analyst connects to `http://localhost:11434`. To use a different URL, set:

```env
OLLAMA_URL=http://192.168.1.100:11434
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Analyst offline" on dashboard | Run `ollama serve` in a terminal |
| "No models installed" | Run `ollama pull gemma3:4b` |
| Slow responses (>30s) | Use a smaller model (`gemma3:4b` vs `gemma3:12b`) |
| Generation timeout | Check Ollama isn't loading another model simultaneously |
| Empty response | Model may need more VRAM; try a smaller model |

---

## Files

```
src/lib/analyst/
  ollama-client.ts       — HTTP client for Ollama API
  prompt-builder.ts      — Assembles system + user prompts from data
  safety-filter.ts       — Strips secrets, validates responses
  analyst-service.ts     — Orchestrates pipeline: health → prompt → generate → filter

src/app/api/analyst/
  health/route.ts        — GET: Ollama connectivity check
  summary/route.ts       — GET: Today's system summary
  explain/route.ts       — POST: Candidate or stop explanation
  journal/route.ts       — POST: Journal draft generation

src/components/dashboard/
  AnalystCard.tsx         — Dashboard widget with model picker

src/lib/analyst/
  safety-filter.test.ts  — 25 safety tests
  prompt-builder.test.ts — 23 prompt structure tests
  ollama-client.test.ts  — 7 model selection tests
```
