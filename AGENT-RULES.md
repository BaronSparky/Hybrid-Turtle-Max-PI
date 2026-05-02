# HybridTurtle — Agent Rules

You are working inside a live, risk-sensitive trading system.

Your job is to make careful, traceable, low-blast-radius changes.

## Core Behaviour

- Do only the task requested.
- Do not expand scope without being asked.
- Do not bundle unrelated cleanup into the same change.
- If you spot other issues, note them separately but do not fix them automatically.
- Prefer small, surgical edits over wide rewrites.
- Preserve naming, architecture, and existing conventions unless explicitly told otherwise.

## System Mindset

Act like a careful maintainer of a money-sensitive system.

Optimize for:
- correctness
- traceability
- testability
- low blast radius
- operational clarity

Do not act like a generic startup engineer optimizing for speed over safety.

## Sacred File Rules

The following files are risk-sensitive:

- stop-manager.ts
- position-sizer.ts
- risk-gates.ts
- regime-detector.ts
- dual-score.ts
- scan-engine.ts

If a task touches a sacred file, you must:

1. explicitly say a sacred file is being changed
2. explain why the change is necessary
3. make the smallest possible edit
4. add or update tests before calling the task complete
5. state what behaviour must remain unchanged

Do not casually refactor sacred files for style, neatness, or “cleanup”.

## No Creative Refactors In Money Logic

Do not rewrite, reorganize, or “improve” core trading logic for style reasons.

If current logic works and the task does not require a behaviour change:
- preserve it
- do not rename major concepts
- do not move logic across layers unnecessarily
- do not re-architect the execution path

Correctness and traceability are more important than elegance in sacred files.

## Scope Discipline

- Complete only the requested task.
- Do not silently add new features.
- Do not fix neighbouring code unless it blocks the task.
- Do not mix bugfixes, refactors, and enhancements in one change unless explicitly requested.
- If additional work is needed, list it separately under “Follow-up notes”.

## Layer Separation

Layer 1 = execution engine:
- scan-engine
- dual-score
- risk-gates
- position-sizer
- stop-manager

Layer 2 = advisory / analytics / prediction:
- conformal
- failure modes
- MI audit
- dynamic weights
- stress testing
- immune system
- lead-lag
- GNN
- Bayesian
- Kelly
- Meta-RL
- VPIN
- sentiment
- TDA
- TradePulse
- causal invariance

Layer 2 must never directly mutate Layer 1 execution behaviour unless explicitly instructed.

## Advisory-Only Default

Any new:
- analytics
- prediction
- weighting
- AI
- confidence
- optimization
- ranking assist
- reinforcement learning
- signal fusion

must default to:
- display-only
- shadow mode
- advisory mode
- no direct execution effect

unless explicitly instructed otherwise.

## Weekly Rhythm Rules

These are intentional operating rules, not bugs:

- Sunday = planning
- Monday to Friday = execution, regime-gated
- Saturday = maintenance

Do not weaken or remove these rules unless explicitly instructed.

## Non-Negotiable Trading Constraints

- Do not replace Yahoo Finance.
- Do not remove weekday execution gating.
- Do not remove weekend no-entry blocks.
- Stops must never decrease.
- Position sizing must use floorShares(), never round up.
- All 6 risk gates must pass.
- Regime confirmation requires 3 consecutive bullish days.
- Do not rebalance dual-score weights unless explicitly instructed.
- HEDGE positions are excluded from open-risk and max-position counts.

## Scan Engine Constraints

Do not reorder or redefine the scan pipeline unless explicitly instructed.

Current order:

1. Universe
2. Technical filters
3. Status classification
4. Ranking
5. Risk gates
6. Anti-chase guard
7. Position sizing

Preserve execution intent and ordering.

## Engineering Standards

- TypeScript strict mode
- no `any`
- Zod for external validation
- Vitest for tests
- Prisma transactions for multi-table writes
- small pure functions where practical
- comments only where logic is non-obvious
- keep route handlers thin
- keep business logic out of UI components where possible

## Prisma Rules

- Never use `prisma db push`
- Always use `prisma migrate dev --name ...`
- Commit migration files with schema changes

## Testing Rules

A task is not complete unless relevant verification is done.

At minimum:
- run relevant tests for changed logic
- add tests for new logic
- extend tests when fixing bugs
- note any tests still needed
- list manual checks when applicable

If sacred logic is changed, tests are mandatory.

## Definition of Done

A task is not done unless:

- code is implemented
- types pass
- relevant tests pass
- changed files are listed
- risk impact is explained
- manual checks are provided where relevant

## Required Response Format

For every non-trivial task, respond using this structure:

1. Plan
2. Files to change
3. Risk-sensitive impact
4. Implementation
5. Tests run / still needed
6. Manual checks
7. Changed files summary

## Failure Handling

If blocked:
- state the blocker clearly
- do not fake completion
- do not claim tests passed if they were not run
- do not pretend behaviour is preserved without checking

If uncertain:
- choose the safer implementation
- keep blast radius small
- explain assumptions clearly

## Follow-Up Notes

If you notice related improvements outside scope:
- do not implement them automatically
- list them separately at the end as optional follow-ups