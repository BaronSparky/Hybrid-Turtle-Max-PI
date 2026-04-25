---
name: vibe-coding-workflow
description: 'Use when applying the .ai CORE_SKILL.md operating system, choosing Copilot CLI or VS Code playbooks, doing inspect-first coding, minimal patches, debugging, repo edits, docs, beginner handoffs, verification, or reusable AI coding workflows.'
argument-hint: 'Describe the task and, optionally, the playbook to apply: debugging, edit-existing-repo, build-from-scratch, docs-and-specs, vscode-agents, copilot-cli, beginner-handoff.'
---

# Vibe Coding Workflow

Use this skill to apply the repository's `.ai` operating pattern: core behavior first, one job-specific playbook second, and the user's task third.

The goal is useful, verifiable progress with small changes, explicit assumptions, and a clear handoff.

## Source Files

- Core operating rules: `.ai/CORE_SKILL.md`
- Usage guide: `.ai/COPILOT_CLI_AND_VSCODE_GUIDE.md`
- Playbooks: `.ai/playbooks/`

## When to Use

- The user asks to use `CORE_SKILL.md`, a vibe coding workflow, Copilot CLI guidance, or VS Code agent guidance.
- The task benefits from an inspect-first, patch-minimally, verify-afterwards workflow.
- The user wants a reusable prompt, coding routine, playbook stack, beginner handoff, debugging process, docs process, or repo-editing process.
- The task is vague enough that the real objective, assumptions, constraints, and verification method need to be made explicit.

## Workflow

1. Restate the real objective in one or two lines.
2. Identify material assumptions, constraints, dependencies, and likely failure points.
3. Choose the smallest useful playbook stack:
   - Always apply `.ai/CORE_SKILL.md`.
   - Add one main playbook from `.ai/playbooks/` based on the job.
   - Add a second playbook only when it clearly complements the first.
4. Inspect relevant files or outputs before proposing code changes.
5. Make a short plan with verification points.
6. Implement the smallest viable change that maps directly to the task.
7. Verify with the strongest repo-native check available.
8. Hand back the result with what changed, why, what was verified, what remains unknown, and the next best step.

## Playbook Selection

- `debugging.md`: something is broken; reproduce or inspect the failure mechanism before patching.
- `edit-existing-repo.md`: patching a live codebase; preserve architecture and touch only required files.
- `build-from-scratch.md`: starting a new project; make the smallest end-to-end version first.
- `docs-and-specs.md`: writing guides, specs, plans, prompts, or instructions.
- `beginner-handoff.md`: output should be plain-language, low-friction, and usable by a non-expert.
- `vscode-agents.md`: working in VS Code agent mode with workspace tools and file edits.
- `copilot-cli.md`: terminal-first Copilot CLI sessions or reusable CLI prompt patterns.

## Decision Rules

- Prefer mechanism over slogans: explain what sustains the result, what it depends on, and what can fail.
- Prefer small, reversible edits over broad rewrites.
- Surface ambiguity when it materially changes the outcome; otherwise choose a conservative default and proceed.
- Mention simpler approaches when they exist.
- Do not add speculative features, unused abstractions, or future-proofing that makes the current task harder.
- Match the existing codebase style and leave unrelated issues as follow-up notes.

## Quality Checks

Before finishing, confirm:

- The work maps directly to the user's request.
- Assumptions and trade-offs are explicit where they matter.
- The chosen playbook stack is appropriate and not overloaded.
- Verification was run or the reason it could not be run is clear.
- The final handoff is usable by the target reader, especially if the user asked for beginner-friendly output.

## Reusable Prompt Pattern

Use or adapt this when the user wants a portable prompt:

```text
Use `.ai/CORE_SKILL.md` as the core operating instructions and apply `.ai/playbooks/[chosen-playbook].md` for this task. First inspect the relevant files, restate the real objective, list material assumptions, make the smallest viable change, verify with the strongest repo-native checks available, and finish with a plain-English handoff that says what changed, what was verified, and what remains unknown.
```
