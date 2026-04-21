# Playbook: Copilot CLI

## Purpose
Use this when working inside Copilot CLI or similar terminal-first agent flows.

## Operating rules
- Start by restating the objective in plain language.
- Inspect before changing: read relevant files, config, package scripts, and repo structure first.
- Prefer small patches over broad rewrites.
- Use the terminal to verify reality, not to generate noise.
- Avoid long autonomous loops unless success criteria are clear.

## Recommended flow
1. Understand the repo
   - inspect root files
   - read package manager files
   - identify framework, test tools, lint, typecheck, run commands
2. Reframe the task
   - define what success looks like
3. Make the smallest change likely to work
4. Verify with the strongest available checks
5. Report back with changed files, verification status, and next step

## Good prompt shape
- Goal
- Constraints
- Files likely involved
- What must not change
- How to verify success

## Example operator prompt
"Read the repo first. Summarise structure, scripts, and likely files. Then make the smallest change needed for [goal]. Run relevant verification. Report what changed, what passed, and what remains unverified."

## Anti-patterns
- changing many files before understanding the repo
- inventing architecture that the project did not ask for
- adding config or abstractions to look sophisticated
- claiming success without build, test, lint, or runtime evidence
