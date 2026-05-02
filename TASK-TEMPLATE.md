# HybridTurtle — Task Template

Use this template for any non-trivial coding task.

---

## Task

[Describe the exact task here in 1–3 sentences.]

Examples:
- Add passive snapshot capture for novel signals
- Build the /risk page open-risk meter
- Fix stop sync not persisting latest broker stop
- Add /api/scan/progress route with typed payloads

---

## Objective

[Describe the end result in plain English.]

Example:
Implement the feature with minimal blast radius, preserve current trading behaviour, and add appropriate tests.

---

## Scope

### In Scope
- [item]
- [item]
- [item]

### Out of Scope
- [item]
- [item]
- [item]

---

## Risk Sensitivity

Does this task touch sacred files?

- [ ] No sacred files
- [ ] Yes — sacred files are involved

If yes, list them:
- [file path]
- [file path]

If yes, also state:
- why the change is necessary
- what behaviour must remain unchanged
- what tests must prove safety

---

## Likely Files To Change

- [file path]
- [file path]
- [file path]

---

## Constraints

Always follow these:

- Do not replace Yahoo Finance
- Do not weaken weekday execution gates
- Do not weaken weekend no-entry blocks
- Stops must never decrease
- Position sizing must use floorShares()
- Prediction / analytics features must remain advisory-only unless explicitly instructed
- Keep the blast radius small
- Do not refactor outside scope

Add task-specific constraints here:
- [constraint]
- [constraint]

---

## Acceptance Criteria

The task is complete only if:

- [ ] feature / fix is implemented
- [ ] existing intended behaviour is preserved
- [ ] types pass
- [ ] relevant tests pass
- [ ] changed files are listed
- [ ] manual verification steps are provided

Task-specific acceptance checks:
- [ ] [acceptance check]
- [ ] [acceptance check]
- [ ] [acceptance check]

---

## Required Output Format

Respond using exactly this structure:

1. Plan
2. Files to change
3. Risk-sensitive impact
4. Implementation
5. Tests run / still needed
6. Manual checks
7. Changed files summary

---

## Implementation Instructions

- Prefer surgical edits over rewrites
- Keep functions small and typed
- Keep route handlers thin
- Use Zod at request boundaries
- Use Prisma migrations for schema changes
- Add or extend tests where logic changes
- If blocked, say exactly what is blocked
- Do not claim completion without verification

---

## Notes / Project Context

[Paste any extra context specific to this task here.]

Examples:
- This is advisory-only
- This must not alter scan ranking
- This route feeds the /plan page
- This needs to work with the SMALL_ACCOUNT profile

---

## Deliver The Task Now
Implement only the scoped task above and nothing else.