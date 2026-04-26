---
description: 'Correct existing behaviour. Reproduce-first, root-cause-not-symptom, surgical patch, regression check. Includes mandatory pre-flight and adversary blocks.'
mode: 'agent'
---

# Vibe Bug Fix

Correcting existing behaviour. Something already does X but should do Y.

The repository's `copilot-instructions.md` defines the shared posture, verification ladder, confidence labels, and handoff template. This prompt extends those for bug-fix work.

## Pre-Flight Block (required before code changes)

Fill in this block before touching any code. Each field must have a concrete answer; "TBD" or empty fields mean the work is not ready to start.

```
Bug in one sentence:    [restate the failure]
Reproduction status:    [reliable / intermittent / not yet reproduced]
Suspected root cause:   [hypothesis, or "unknown — investigation needed"]
Smallest plausible fix: [what the patch likely looks like]
Reversibility:          [reversible / partially / irreversible — and why]
Verification plan:      [which rung of the ladder, and what command]
Stop-and-ask triggers:  [list, or "none"]
```

If reproduction status is "not yet reproduced," stop. Reproducing comes first — do not skip to fixing.

## Adversary Block (required before code changes)

List the three strongest objections a sharp reviewer would raise against the plan above. Weak strawmen do not count — these must be objections that, if correct, would change the approach.

```
1. [strongest objection]
2. [second]
3. [third]
```

For each, answer: is it correct? If yes, revise the plan and update the Pre-Flight Block. If no, state in one sentence why the objection does not apply.

If three real objections cannot be generated, one of two things is true:
- The problem is genuinely trivial — state this explicitly and proceed
- The problem is not understood well enough yet — return to reproduction or root-cause investigation

## Procedure

1. **Reproduce or identify the failing path.**
   - Get the bug to happen reliably, in front of you, before fixing anything.
   - If it cannot be reproduced, label the work `blocked` until it can be.
   - "I think this fixes it" without reproduction is a guess, not a fix.

2. **Find the root cause, not the nearest symptom.**
   - Trace the failing path back through the call graph.
   - Distinguish "where it explodes" from "where it went wrong."
   - Patching the explosion site hides the cause and creates the next bug.

3. **Patch with the smallest change that fixes the root cause.**
   - One line if one line is enough.
   - Do not refactor adjacent code while you are there.
   - Do not "improve" the function while fixing it.

4. **Verify the failing case now passes.**
   - Re-run the exact reproduction from step 1.
   - Confirm the failure is gone.

5. **Check regression risk.**
   - Run the test suite covering the fixed area.
   - Identify other callers of the changed code path and confirm their behaviour.
   - Add a regression test if the bug could plausibly return.

6. **Hand off using the standard template.**

## Worked Example

**Request:** "User avatars show a broken image icon when the user has no avatar set — should show the default placeholder."

**Pre-Flight Block:**
```
Bug in one sentence:    Avatar component renders broken-image icon for users with null avatarUrl instead of a placeholder.
Reproduction status:    reliable — visible on any seed user with avatarUrl null
Suspected root cause:   component renders avatarUrl directly without null fallback
Smallest plausible fix: add null-coalescing fallback to the existing default-avatar helper
Reversibility:          reversible — single component change, no data or schema impact
Verification plan:      rung 1 (run the page in dev) + rung 2 (targeted avatar tests)
Stop-and-ask triggers:  none
```

**Adversary Block:**
```
1. The fix masks a deeper data issue — why is avatarUrl null in the first place? Should it have been backfilled at signup?
2. The default-avatar helper might do something expensive (network call, hash computation) that makes calling it on every render bad.
3. Other components might render avatarUrl directly with the same bug — fixing one leaves an inconsistent UI.
```

Verdict:
1. Not correct — null avatarUrl is the documented signup default; this is by design, not a data bug.
2. Not correct — `getDefaultAvatar` is a pure function returning a static asset path; checked the implementation.
3. Partially correct — confirmed via grep that `components/user/profile-header.tsx` has the same bug. Out of scope for this fix; filed as separate task per "do not patch every site that looks similar" rule.

**Reproduce:** Open the app in dev. Find a seed user with null avatarUrl. Confirm the broken-image icon renders.

**Root cause hunt:**
- Avatar rendering happens in `components/user/avatar.tsx`
- Component renders `<img src={user.avatarUrl} />` directly
- When `user.avatarUrl` is `null`, the rendered HTML becomes `<img src="">` which the browser treats as a broken reference
- The default placeholder logic exists in `lib/user/default-avatar.ts` but is not called from this component
- That is the bug — the component bypasses the helper

**Patch:** import `getDefaultAvatar` and use `user.avatarUrl ?? getDefaultAvatar(user.id)`. One import, one expression change.

**Verify failing case:** reload the page, the no-avatar user now renders the default placeholder. Confirmed.

**Regression check:**
- Ran the avatar test suite, 6 tests pass, but no test covered the null case. Added one.
- Grepped for other places rendering `user.avatarUrl` directly — confirmed the profile-header.tsx finding from the Adversary Block. Filed separately, not fixed here.
- Confirmed the helper `getDefaultAvatar` is already covered by its own tests.

**Handoff:**
```
Changed: components/user/avatar.tsx (2 lines), tests/components/avatar.test.tsx (1 test added)
Why: Avatar component rendered empty src when user had null avatarUrl, producing broken-image icon. Now falls back to default placeholder via existing helper.
Verified: manual reproduction now passes, full avatar test suite green, regression test added
Confidence: verified
Unknown: same pattern exists in profile-header.tsx — not fixed in this change, filed as separate task
Next: address the same bug in profile-header.tsx, or grep for any other direct uses of user.avatarUrl
```

## Common Mistakes

- **Fixing the symptom, not the cause.** Wrapping the explosion site in a try/catch instead of finding why it threw.
- **Refactoring while fixing.** Tempting because the code "looks bad" near the bug. Resist. Fix the bug, then propose a separate refactor.
- **Skipping reproduction.** "It's obviously this" is the most expensive sentence in debugging. Reproduce first.
- **No regression test.** If the bug could come back, it will. Pin the correct behaviour in a test.
- **Patching every site that "looks similar."** If three places have the same bug, fix the requested one, write the regression test, then file the others as separate tasks (or confirm and fix in scope only if the requester explicitly broadens the scope).

## When To Stop And Ask

- The fix appears to require touching a file the project marks as critical
- The "bug" might actually be intended behaviour and the requester is mistaken about expectations
- Two reasonable root causes exist and would lead to materially different patches
- The bug is intermittent and you cannot reproduce it reliably (label `blocked` and ask for more reproduction info)
- The fix would require a database migration, schema change, or breaking API change
