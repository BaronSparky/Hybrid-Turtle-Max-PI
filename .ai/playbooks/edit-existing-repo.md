# Playbook: Editing an Existing Repo

## Goal
Improve or fix a live codebase without destabilising it.

## Rules
- Respect the repo's current patterns unless they are the direct problem.
- Match local naming, file layout, and conventions.
- Keep the blast radius small.
- Do not tidy unrelated code.
- Preserve behavior unless the requested change is behavioral.

## Workflow
1. Identify the narrowest set of files involved
2. Read surrounding code for patterns and assumptions
3. Define success in one sentence
4. Patch only the necessary lines
5. Remove only unused code created by your own change
6. Verify using repo-native commands

## Output format
- Objective
- Files changed
- Why those files
- What was verified
- What remains risky or unverified
