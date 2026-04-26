---
description: 'Review code, a PR, or a design for risks, bugs, missing tests, or unclear behaviour. Severity-ordered findings with file:line grounding.'
mode: 'agent'
---

# Vibe Review

Checking work — code, a pull request, a design, or earlier output — for risks, bugs, missing tests, or unclear behaviour.

The repository's `copilot-instructions.md` defines the shared posture, verification ladder, confidence labels, and handoff template. This prompt extends those for review work.

## Core Posture

A review's job is to surface what the author or earlier-you missed. Style nitpicks, restating the obvious, and praise without substance are noise. Lead with the things that would burn the user if shipped.

Order findings by severity, not by file order or by the order you noticed them.

## Procedure

1. **Establish what is being reviewed and against what standard.**
   - One sentence: "Reviewing X for Y."
   - "Reviewing the new payment endpoint for correctness and missing edge cases."
   - Without a standard, "review" becomes free-form opinion.

2. **Read the change in full before commenting.**
   - Skim once for shape, read once for substance.
   - Do not comment on file 1 before seeing file 5 — the comment may answer itself.

3. **Hunt for concrete risks first, in this order:**
   - **Correctness:** does it do the wrong thing for some input?
   - **Safety:** does it leak data, skip auth, or break invariants?
   - **Edge cases:** empty input, null, zero, negative, very large, concurrent, partial failure
   - **Missing tests:** behaviour that is asserted to work but not pinned by a test
   - **Unclear behaviour:** code where two readers would disagree about what it does
   - **Performance:** only flag when concrete, not speculative

4. **Ground every finding in a file and line.**
   - "`payment-handler.ts:142` — when `amount` is zero, the early return skips audit logging, so zero-value transactions are invisible to the audit trail."
   - Not: "audit logging seems incomplete."

5. **Distinguish severity.**
   - **Blocker:** must fix before merge — correctness, safety, data loss
   - **Should fix:** important but not blocking — missing tests, edge cases, unclear behaviour
   - **Consider:** worth thinking about — design choices, naming, future-proofing
   - **Nit:** style, formatting, taste — flag sparingly, ideally not at all

6. **Hand off with findings ordered by severity.**

## Worked Example

**Request:** "Review this PR adding password reset functionality."

**Standard:** "Reviewing the password reset flow for correctness, security, and missing edge cases."

**Reading pass:** PR touches 4 files — new `routes/auth/reset-request.ts`, new `routes/auth/reset-confirm.ts`, an email template, and a migration adding a `password_reset_tokens` table.

**Findings:**

```
BLOCKER — reset-confirm.ts:34
The token comparison uses === on the raw token from the request and the stored
hash. This will never match unless the stored value is the raw token, in which
case the table stores plaintext reset tokens. Either the comparison or the
storage is wrong. Confirm which: tokens should be stored hashed and compared
by hashing the incoming token, not by string equality.

BLOCKER — reset-request.ts:18
No rate limit on the reset request endpoint. An attacker can enumerate valid
emails by observing response timing or send floods of reset emails. Add the
existing rate-limit middleware (used on /auth/login) to this route.

SHOULD FIX — reset-confirm.ts:51
No expiry check on the token. The migration adds an expires_at column but
the handler never reads it. Tokens are valid forever once issued.

SHOULD FIX — tests/auth/reset.test.ts (missing)
No tests for the new endpoints. At minimum: valid reset flow, expired token,
already-used token, wrong token, missing token, malformed email.

CONSIDER — reset-request.ts:8
Returns 200 with "email sent" message regardless of whether the email exists
in the DB. This is correct for not leaking account existence — worth a code
comment to prevent a future "improvement" that breaks it.

NIT — email template
"Click here to reset" link uses target="_blank" without rel="noopener". Low
risk on a transactional email but trivial to fix.
```

**Handoff:**
```
Reviewed: PR #237 (password reset flow), 4 files
Found: 2 blockers, 2 should-fix, 1 consider, 1 nit
Verified: read the diff in full, traced token path from request → storage → confirmation
Confidence: verified for the listed findings; likely for the absence of other security issues (did not run the code or test the flow end-to-end)
Unknown: behaviour of the email-sending dependency under failure — not visible in this PR
Next: address the two blockers before merge. The should-fix items can land in a follow-up PR if scope is a concern, but the expiry check is genuinely close to a blocker.
```

## Common Mistakes

- **Praise sandwich.** Wrapping real findings in compliments dilutes them. State findings cleanly. Acknowledge good work separately if at all.
- **Style commentary first.** Putting nits at the top buries the blocker on line 34.
- **"Looks good" without depth.** A review that finds nothing in a non-trivial change usually means the reviewer skimmed.
- **Speculative performance concerns.** "This might be slow at scale" with no measurement is noise. Either measure or do not raise it.
- **Comments without file:line.** Findings the author cannot locate are findings the author cannot fix.
- **Reviewing the diff without context.** Sometimes the bug is in the unchanged code that the diff now relies on. Read enough surrounding code to know.

## When To Stop And Ask

- The review scope is unclear (correctness only, or also design, or also performance, or also security?)
- The standard for "good" is unclear (production-ready, prototype, internal tool?)
- A finding depends on knowledge you do not have (e.g. "is this dependency intentional?")
- The change touches a file the project marks as critical and the reviewer does not have full context on the constraints
