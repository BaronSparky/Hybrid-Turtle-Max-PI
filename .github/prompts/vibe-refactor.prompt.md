---
description: 'Restructure code without changing observable behaviour. Invariant-first, small steps, no mixed cleanup. Includes mandatory pre-flight and adversary blocks.'
mode: 'agent'
---

# Vibe Refactor

Restructuring code without changing observable behaviour. Same inputs, same outputs, same side effects — different shape.

The repository's `copilot-instructions.md` defines the shared posture, verification ladder, confidence labels, and handoff template. This prompt extends those for refactor work.

## Core Posture

A refactor is **not** an opportunity to fix bugs, add features, tune parameters, or "clean up while you're in there." Mixing those in is the single most common reason refactors fail.

If you discover a bug during a refactor, stop the refactor, fix the bug as a separate change, then resume.

## Pre-Flight Block (required before code changes)

Fill in this block before touching any code. Each field must have a concrete answer.

```
Refactor in one sentence: [what shape change is happening]
Invariant:                [what behaviour must remain identical]
Baseline test status:     [N tests passing / coverage gaps / characterisation tests needed]
Smallest first step:      [what changes in the first commit]
Reversibility:            [reversible / partially / irreversible — and why]
Verification plan:        [test suite + typecheck + behavioural diff if applicable]
Stop-and-ask triggers:    [list, or "none"]
```

If baseline test status shows coverage gaps in the area being refactored, stop. Add characterisation tests first — refactoring code you cannot detect regressions in is rearranging deck chairs in the dark.

## Adversary Block (required before code changes)

List the three strongest objections a sharp reviewer would raise against the plan above. Weak strawmen do not count.

```
1. [strongest objection]
2. [second]
3. [third]
```

For each, answer: is it correct? If yes, revise the plan and update the Pre-Flight Block. If no, state in one sentence why the objection does not apply.

Refactor-specific objections to consider: hidden behaviour change, missed caller of moved code, public API contract change, lost performance characteristic, broken serialisation or persistence format, scope creep into bug-fix or feature territory.

## Procedure

1. **Define the invariant.**
   - One sentence: "After this change, X still does exactly Y for all inputs that previously produced Y."
   - The invariant is the test you will use to know the refactor is correct.

2. **Capture current behaviour before changing anything.**
   - Run the existing test suite — confirm it passes. If it does not, fix that first.
   - If coverage is thin in the area you are refactoring, add characterisation tests before touching the code.
   - Confirm typecheck and lint are clean before starting.

3. **Make small, behaviour-preserving steps.**
   - One rename, one extraction, one move at a time.
   - Run the test suite between each step where practical.
   - A 20-step refactor with 20 green test runs is far safer than one giant change with one final run.

4. **Do not mix unrelated cleanup.**
   - If you are extracting a function, do not also rename its parameters and reorder its branches.
   - Land each kind of change as its own commit.

5. **Verify before and after.**
   - Same test suite, same results.
   - Same typecheck output.
   - For behaviour-critical code, run against realistic data and compare outputs to a captured baseline.

6. **Hand off with explicit invariant confirmation.**

## Worked Example

**Request:** "The `payment-handler.ts` file has grown to 600 lines. Split it up."

**Stop-and-ask first:** Confirm the split shape and that the request really is restructuring (not "rewrite while you're there").

**After clarification:** "Split into `payment/orchestrator.ts` (top-level flow), `payment/validators/` (one file per validator), `payment/processors/` (one file per processor). Public exports identical. No logic changes."

**Pre-Flight Block:**
```
Refactor in one sentence: split 600-line payment-handler.ts into orchestrator + validators/ + processors/ subdirectories
Invariant:                every existing consumer import resolves; every payment test passes with identical results; same payment requests produce same outputs and side effects
Baseline test status:     47 tests passing; validator branches well covered; two processor edge cases uncovered — characterisation tests needed first
Smallest first step:      create payment/orchestrator.ts, move top-level handler unchanged, re-export from old location
Reversibility:            reversible per step; final commit (deleting old file) is irreversible from that commit forward but trivially revertible
Verification plan:        full payment suite + typecheck after each step + recorded-scenario byte diff at end
Stop-and-ask triggers:    none after clarification confirmed scope
```

**Adversary Block:**
```
1. Re-exporting from the old location during the migration could mask cases where consumers import symbols that should not be public — the temporary back-compat layer hides the API surface.
2. "Public exports identical" assumes all current exports are intentional. Some may be accidental — moving them all forward perpetuates the accident.
3. The two uncovered processor edge cases might be uncovered because they are unreachable, not because tests are missing — adding characterisation tests for unreachable code pins behaviour that should not exist.
```

Verdict:
1. Correct concern but acceptable trade-off — the back-compat re-export is removed in the final step, at which point any unintended consumer becomes visible as an import error. Logged the concern in the handoff.
2. Partially correct — checked the export list, all current exports have at least one external consumer. No accidental public surface to prune in this refactor.
3. Not correct — traced both edge cases, both are reachable via specific input shapes. Tests are genuinely missing, not protecting dead code.

**Capture baseline:**
- Ran the payment test suite — 47 tests passing
- Ran typecheck — clean
- Added two characterisation tests pinning the uncovered processor edge cases — 49 tests passing

**Steps (each followed by a test run):**
1. Create `payment/orchestrator.ts`, move the top-level handler unchanged. Re-export from old location for compatibility. Tests green.
2. Create `payment/validators/`, move first validator. Tests green.
3. Move remaining validators one at a time. Tests green after each.
4. Create `payment/processors/`, move processors one at a time. Tests green after each.
5. Update internal imports inside the new files to use direct paths instead of going through the old re-export. Tests green.
6. Delete the old `payment-handler.ts` file (now empty of logic). Update consumer imports to point at `payment/orchestrator.ts`. Tests green.

**Verification:**
- All 49 tests pass identically before and after
- Typecheck clean
- Diffed pre-refactor and post-refactor outputs of a recorded payment scenario in dev — byte-identical

**Handoff:**
```
Changed: payment-handler.ts deleted, payment/ directory created with orchestrator.ts + validators/ (4 files) + processors/ (5 files), 8 consumer imports updated
Why: split a 600-line file into single-responsibility modules without changing behaviour
Verified: 49 tests pass identically, typecheck clean, recorded scenario produces byte-identical output
Confidence: verified
Unknown: nothing material — invariant held throughout
Next: none — task complete. The two characterisation tests added in step 2 are now permanent regression coverage.
```

## Common Mistakes

- **Refactoring without a baseline.** If you do not know what the test suite said before you started, you cannot prove the refactor preserved behaviour.
- **Mixing in "while I'm here" changes.** The 600-line file probably has bugs and ugly bits. Resist. Do the refactor cleanly, then propose follow-ups.
- **Big-bang refactors.** Twenty small steps with twenty green test runs is much safer than one large change with one final run. The bisection cost when something breaks is the difference between minutes and hours.
- **Refactoring code without coverage.** If the area is thinly tested, add characterisation tests first. Refactoring without tests is just rearranging deck chairs in the dark.
- **Stopping when typecheck passes.** Typecheck is necessary, not sufficient. Behaviour preservation requires running the actual code.

## When To Stop And Ask

- The refactor target is a file the project marks as critical
- The proposed split would change a public API or export shape
- The current test coverage is too thin to detect regressions, and the requester has not indicated whether to add tests first
- The refactor would touch generated code, build output, or vendored dependencies
- The code "looks wrong" in ways that suggest a bug rather than a structural issue — confirm whether the requester wants a refactor or a bug fix
