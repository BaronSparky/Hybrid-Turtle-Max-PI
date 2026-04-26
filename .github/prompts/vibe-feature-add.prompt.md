---
description: 'Add new observable behaviour to an existing codebase. Includes a tuning sub-mode (with mandatory pre-flight and adversary blocks) for parameter and threshold changes.'
mode: 'agent'
---

# Vibe Feature Add

Adding new observable behaviour to an existing codebase. Something a user, API consumer, or another part of the system can now do that it couldn't before.

The repository's `copilot-instructions.md` defines the shared posture, verification ladder, confidence labels, and handoff template. This prompt extends those for feature work.

## Procedure

1. **Define the observable behaviour.**
   - One sentence: "After this change, X will be able to do Y."
   - Identify the smallest complete path that satisfies it.

2. **Find the existing pattern to extend.**
   - New endpoint? Find the closest existing endpoint and match its shape.
   - New component? Find the closest existing component and match its interface.
   - New job or handler? Find the closest existing one and match its registration pattern.
   - Do not invent a new pattern when an existing one fits.

3. **Implement the minimum complete path.**
   - One endpoint, not five. One component, not a component framework.
   - All the way from input to output, working end-to-end.
   - No speculative configuration knobs.

4. **Add focused tests.**
   - At least one test proving the new behaviour works.
   - At least one test proving it does not break the closest existing behaviour.

5. **Verify against the ladder.**
   - Run the new path with realistic data.
   - Run targeted tests, then the affected suite.
   - Typecheck and lint.

6. **Hand off using the standard template.**

## Sub-Mode: Tuning

Tuning failures are silent — a wrong threshold ships, behaviour shifts, and the test suite still passes because the tests were calibrated to the new value. The two gate blocks below are required for any tuning change.

### Pre-Flight Block — Tuning (required)

```
Constant being changed:   [name and location]
Old value → new value:    [explicit values, not vague descriptions]
Intended behaviour shift: [what observably changes as a result]
Read sites:               [every file:line that reads this constant]
Tests pinning old value:  [list, or "none found"]
Cascade risk:             [what downstream behaviour depends on this value]
Verification plan:        [test suite + realistic-environment check]
Stop-and-ask triggers:    [list, or "none"]
```

If "Read sites" is empty or contains "TBD," stop. Grep the codebase first — guessing read sites is the most common tuning failure.

### Adversary Block — Tuning (required)

```
1. [strongest objection]
2. [second]
3. [third]
```

Tuning-specific objections to consider: cascade into a related constant that should move with this one, tests that pass after the change but should have failed because they were pinned to the old value for a reason, observable downstream behaviour the requester did not mention, value chosen by feel rather than by data.

### Procedure

1. **State the current value and the new value explicitly.**
   - Example: "Cache TTL: 60s → 300s"
   - Not: "longer cache time"

2. **State the intended behavioural change.**
   - Example: "Reduces upstream API calls by ~5x for repeated identical queries"

3. **Identify every read site.**
   - Grep the codebase for the constant or config key.
   - Do not guess — list every file and line that reads it.
   - Check tests that may have pinned the old value.

4. **Run the affected test suites.**
   - Tuning often breaks tests calibrated to the old value.
   - If a test fails, decide: was the test wrong, or is the new value wrong?

5. **Verify in a realistic environment.**
   - Unit tests are not enough for tuning.
   - Run the affected feature against real or staging data and confirm the change took effect.

## Worked Example: New Feature

**Request:** "Add an endpoint that returns the user's last 10 login events."

**Observable behaviour:** "After this change, an authenticated client calling `GET /api/me/logins` receives a JSON array of the user's 10 most recent login events, newest first."

**Existing pattern:** `GET /api/me/sessions` already returns session data for the authenticated user. Match its shape — same auth middleware, same response envelope, same error handling.

**Minimum path:**
- Add `routes/api/me/logins.ts` mirroring `routes/api/me/sessions.ts`
- Reuse the existing `LoginEvent` model — no schema changes
- One query, ordered by timestamp desc, limit 10
- No pagination, no filtering, no date range — those are separate features

**Tests:**
- Unit: handler returns 10 events newest-first for a user with 15+ events
- Unit: handler returns all events for a user with fewer than 10
- Unit: handler returns 401 for unauthenticated request
- Regression: existing `/api/me/sessions` tests still pass

**Verification:**
- Hit the endpoint locally with a seeded test user, confirmed 10 events returned in correct order
- Ran the targeted test file, all green
- Ran full API suite, all green
- Typecheck clean

**Handoff:**
```
Changed: routes/api/me/logins.ts (new, 42 lines), tests/api/me/logins.test.ts (new, 3 tests)
Why: new endpoint exposing last 10 login events for the authenticated user, per request
Verified: 3 new unit tests pass, full API suite passes, manual call returned correct shape and order
Confidence: verified
Unknown: behaviour with users having zero login events — returns empty array, not yet test-pinned
Next: add a regression test for the empty case, or confirm empty array is acceptable as-is
```

## Worked Example: Tuning

**Request:** "The rate limiter is too aggressive — loosen it."

**Stop-and-ask:** "What new limit — and which routes? The global default, the auth routes, or the public API?"

**After clarification:** "Global default: 60 req/min → 120 req/min. Auth and public API limits unchanged."

**Pre-Flight Block — Tuning:**
```
Constant being changed:   DEFAULT_RPM in lib/rate-limit/config.ts
Old value → new value:    60 → 120
Intended behaviour shift: doubles allowed request rate on default-limited routes; 429 trips at request 121 instead of 61
Read sites:               middleware/rate-limit.ts:14 (only consumer); auth and public API paths import AUTH_RPM and PUBLIC_RPM from the same file — confirmed unaffected
Tests pinning old value:  tests/middleware/rate-limit.test.ts (3 fixtures at 60, 1 assertion at 61)
Cascade risk:             monitoring/alerting thresholds may be calibrated to the old 429 rate; metrics dashboards may need updating; no code-level cascade
Verification plan:        rate-limit suite + manual loop test against dev server + confirm auth limit still triggers separately
Stop-and-ask triggers:    none
```

**Adversary Block — Tuning:**
```
1. The rate limit was set to 60 for a reason — possibly an upstream service constraint or cost ceiling. Doubling it without checking that constraint may shift the bottleneck downstream.
2. AUTH_RPM and PUBLIC_RPM are stated as "unchanged" but they may be defined as multiples or fractions of DEFAULT_RPM rather than independent values — need to verify they are truly independent.
3. The "request 61 is rejected" test passing at 121 might mean the rate limiter logic is correct, but there may be a separate per-IP or per-user limit that the tests do not exercise.
```

Verdict:
1. Asked the requester — confirmed no upstream constraint; the original 60 was a conservative starting value with no specific basis. Proceeding.
2. Checked the file — AUTH_RPM and PUBLIC_RPM are independent literal values, not derived from DEFAULT_RPM. Genuinely unaffected.
3. Checked the middleware — only one rate-limit dimension exists (per-route global). No per-IP or per-user layer. Tests cover the only dimension that exists.

**Verification:**
- Updated fixtures, ran the rate-limit test suite — all green
- Hit a non-auth, non-public endpoint 121 times in a loop against the dev server, confirmed request 121 returns 429
- Hit an auth endpoint 61 times to confirm its separate limit still triggers — confirmed unchanged

**Handoff:**
```
Changed: lib/rate-limit/config.ts (1 line), tests/middleware/rate-limit.test.ts (3 fixtures, 1 assertion)
Why: tuning request — raise default rate limit from 60 to 120 req/min, auth and public API unchanged
Verified: rate-limit suite passes, manual loop confirmed new threshold active, auth path confirmed unchanged
Confidence: verified
Unknown: real-world traffic patterns under new limit (will observe)
Next: monitor 429 rate over the next week — adjust again if too few or too many trip the limit
```

## Anti-Patterns To Avoid

- Adding a feature flag when no one will toggle it
- Building configuration for a single use case
- Extracting an abstraction on the first use
- Adding a feature in three places when one would do
- Tuning by "feel" without grepping the read sites
- Tuning without running the test suite that pinned the old value
- Adding pagination, filtering, sorting, or similar "obvious next features" before the base case is shipped and used
