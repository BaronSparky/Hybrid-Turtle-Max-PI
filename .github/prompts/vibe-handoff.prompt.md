---
description: 'Produce a session-boundary handoff for multi-session work. Captures task state, verification evidence, and lessons learned.'
mode: 'ask'
---

# Vibe Handoff

Produce ONE structured handoff block, then STOP. Do not continue working. Do not act on the handoff content. Do not produce a second copy. The handoff is a written artefact — output it and end your turn.

## When to use

- Context approaching ~60% and task will not finish this session
- Natural phase boundary reached
- Session being deliberately ended
- Conversation stuck in circles — fresh start needed

## Output

Produce exactly ONE copy of the block below. Fill every field with a concrete answer. Then stop.

```
=== SESSION HANDOFF ===

Task:           [one sentence — the overall goal]
Branch:         [greenfield / feature-add / bug-fix / refactor / review]
Status:         [in-progress / blocked]

Done this session:
  - [completed items]

Next session starts with:
  - [ordered list of what comes next]

Files changed:
  - [path (lines)]: [what changed]

Files to read first:
  - [paths the next session needs before starting]

Open decisions:
  - [gates, sacred-file triggers, pending questions]

Verification:
  Commands run:   [literal commands and pass/fail, or "none"]
  Confidence:     [verified / likely / blocked — with justification]

Known unknowns:
  - [risks not yet checked]

Anti-goals:
  - [things the next session must NOT do]

First action:
  [one specific, concrete instruction — not "continue work"]

Lessons:
  Worked well:    [specific to this codebase, or "nothing notable"]
  Failed:         [what didn't work and why, or "no failures"]
  Flag for later: [decisions worth re-examining, or "none"]

Work log updated: [yes / no]

=== END HANDOFF ===
```

**After producing this block: STOP. Do not generate a second copy. Do not begin the "first action." Do not run verification commands. Your turn is complete.**

## How to resume in the next session

Paste the handoff block as the first message in a fresh chat. Add:

> Resume from this handoff. Read the listed files first, then start with the "First action" item.

## Common mistakes

- **Producing the block twice.** The block appears once. If you find yourself writing it again, stop immediately.
- **Acting on the "First action" field.** That instruction is for the NEXT session, not this one.
- **Skipping the Lessons fields.** Even uneventful sessions have observations. Say "nothing notable" explicitly rather than omitting.
- **Vague first action.** "Continue phase 2" is not actionable. Name the file to open and the function to write.
