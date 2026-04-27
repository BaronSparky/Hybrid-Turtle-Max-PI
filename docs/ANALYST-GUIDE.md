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

### News & Catalyst Context (internet-aware, free)
- Endpoint: `POST /api/analyst/news`
- Body: `{ "ticker": "AAPL", "model": "gemma3:4b", "includeSummary": true }`
- Returns: recent public Yahoo Finance headlines, next earnings date + days-until,
  plus an optional plain-English LLM review flagging earnings-event risk and
  whether news flow looks routine vs. material (M&A, guidance, regulatory, etc.).
- Source: `yahoo-finance2` (public, no API key, no cost).
- Degrades gracefully: if Yahoo is unreachable, returns 200 with empty headlines and
  a `sourceWarnings` entry. If Ollama is offline, headlines + earnings still return
  and `summary` is null.
- Set `"includeSummary": false` to get raw data only (skip the LLM call).

### Batch News + Sentiment (portfolio + candidates)
- Endpoint: `GET /api/analyst/news-batch?topN=5`
- Returns news + earnings for all open positions and top-N scan candidates.
- Includes per-ticker sentiment classification (POSITIVE/NEUTRAL/NEGATIVE) via Ollama.
- Sentiment uses the smallest available model for speed.
- Deduplicates: candidates already in portfolio appear under portfolio only.
- Dashboard auto-loads this on mount and when the News section is expanded.

### Trade Pulse AI Explain
- Endpoint: `POST /api/analyst/trade-pulse`
- Body: `{ "ticker": "AAPL", "score": 72, "grade": "B", "decision": "CONDITIONAL", "signals": [...], "concerns": [...], "opportunities": [...] }`
- Auto-enriches with Yahoo news + earnings.
- Returns plain-English explanation of grade, key signal drivers, risk factors, and news context.
- Used by the Trade Pulse detail page and Telegram `/explain` command.

### Analytics Explain (generic)
- Endpoint: `POST /api/analyst/analytics-explain`
- Body: `{ "contextSummary": "...", "question": "..." }`
- Generic explain endpoint used by Score Lab, Filter Scorecard, Prediction Status, Signal Audit, Evidence, and Breakout Evidence pages.
- Context is truncated to 4000 chars to prevent prompt injection via large payloads.

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

If no model is specified, the system picks automatically based on context:
- **Summary/Explain**: Prefers the largest installed model for detailed analysis.
- **Short/Inline**: Uses the smallest installed model for fast inline explains.
- **Fallback order**: Gemma → Llama → first available.

### Caching
- **News cache**: 1-hour TTL per ticker. Avoids hammering Yahoo across dashboard, Telegram, and manual checks.
- **LLM response cache**: 30-minute TTL keyed by prompt hash. Identical prompts return cached responses instantly.
- Both caches are bounded (100 news entries, 50 LLM entries) with automatic eviction.

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

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/analyst` | System summary via Ollama |
| `/ask <question>` | Ask the analyst a question |
| `/news <ticker>` | News + earnings + optional AI review |
| `/explain <ticker>` | Trade Pulse AI explanation with grade, signals, news |
| `/earnings` | Earnings calendar for all open positions |
| `/scorecard` | Filter performance summary (passed vs blocked returns) |

All Telegram LLM responses are HTML-escaped before markdown-to-HTML conversion to prevent XSS.

---

## Dashboard Features

### Analyst Card
- Auto-streams system summary on page load (SSE).
- Auto-refreshes every 30 minutes when in ready state.
- Earnings proximity alert banner (auto-shows when any position has earnings ≤5 days).
- News & Catalyst Check section (auto-expands on earnings alert):
  - Auto-loads portfolio + top 5 candidates with headlines, earnings dates, and sentiment badges.
  - Manual single-ticker lookup below the auto-loaded results.
  - Per-ticker sentiment classification (▲ positive, ▼ negative).

### AI Explain Buttons
Available on 8 analysis pages:
- **Trade Pulse** (`/trade-pulse/[ticker]`) — grade, signals, concerns, news context
- **Candidates** (`/candidates`) — inline explain + news per row
- **Scan** (`/scan`) — explain button next to WhyCard
- **Score Lab** (`/score-validation`) — NCS/FWS/BQS band interpretation
- **Filter Scorecard** (`/filter-scorecard`) — filter value analysis
- **Prediction Status** (`/prediction-status`) — model accuracy + overfit check
- **Signal Audit** (`/signal-audit`) — signal redundancy analysis
- **Evidence** (`/evidence`) — tab-aware (rules, classification, entry, exit, simulation)
- **Breakout Evidence** (`/breakout-evidence`) — breakout vs non-breakout comparison

### Watchlist News Feed
- Page: `/watchlist-news` (Analysis → Watchlist News)
- Consolidated live news for portfolio + top 10 candidates.
- Unified headline timeline sorted by recency.
- Earnings calendar grid with proximity warnings.
- Per-ticker sentiment badges (▲/▼).
- Auto-refreshes every 15 minutes.

### Auto-Trade Earnings Check
- Pre-trade earnings proximity check for top 5 A-grade candidates.
- Telegram alert if any have earnings within 5 days.
- Optional deferral gate: set `EARNINGS_DEFERRAL_DAYS=5` to auto-skip candidates with earnings within N days.
- Defaults to 0 (advisory only, no deferral).
- Evening scan summary includes weekly earnings calendar for held positions + top candidates.

---

## Files

```
src/lib/analyst/
  ollama-client.ts       — HTTP client for Ollama API + model auto-selection
  prompt-builder.ts      — Assembles system + user prompts from data
  safety-filter.ts       — Strips secrets, validates responses
  analyst-service.ts     — Orchestrates pipeline: health → prompt → cache → generate → filter → cache
  news-fetcher.ts        — Free public news + earnings via yahoo-finance2 (1h cache)
  sentiment.ts           — Lightweight headline sentiment classifier (POSITIVE/NEUTRAL/NEGATIVE)

src/app/api/analyst/
  health/route.ts        — GET: Ollama connectivity check
  summary/route.ts       — GET: Today's system summary (SSE streaming)
  explain/route.ts       — POST: Candidate or stop explanation
  journal/route.ts       — POST: Journal draft generation
  news/route.ts          — POST: Public news + earnings + LLM review for a ticker
  news-batch/route.ts    — GET: Batch news + earnings + sentiment for portfolio + candidates
  trade-pulse/route.ts   — POST: Trade Pulse AI explanation
  analytics-explain/route.ts — POST: Generic analytics explain (Score Lab, Scorecard, etc.)

src/components/dashboard/
  AnalystCard.tsx         — Dashboard widget with model picker, news section, earnings alerts

src/components/analytics/
  AnalyticsExplainCard.tsx — Reusable AI explain card for analytics pages

src/components/candidates/
  CandidateExplainButton.tsx — Inline explain button with news + sentiment

src/app/watchlist-news/
  page.tsx               — Consolidated live news feed page

src/lib/analyst/
  safety-filter.test.ts  — 25 safety tests
  prompt-builder.test.ts — 32 prompt structure tests (incl. news + trade-pulse)
  ollama-client.test.ts  — 13 model selection tests (incl. context-aware)
  news-fetcher.test.ts   — 6 news/earnings fetch tests
```
