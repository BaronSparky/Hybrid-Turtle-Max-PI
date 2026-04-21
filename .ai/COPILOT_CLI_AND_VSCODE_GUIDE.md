# How to Use This with Copilot CLI and VS Code

This package is designed to give your AI helper one steady operating system and then a smaller playbook depending on the job.

## What each file is for

### `CORE_SKILL.md`
This is the main brain.
Use it as the default instruction set for almost everything.
It tells the agent how to think, how to avoid bloat, how to verify, and how to hand work back clearly.

### `playbooks/*.md`
These are situational overlays.
Use one when the task has a clear shape.
For example:
- `copilot-cli.md` for terminal-first agent work
- `vscode-agents.md` for VS Code Copilot chat or agent mode
- `edit-existing-repo.md` when patching a live codebase
- `build-from-scratch.md` when starting new projects
- `debugging.md` when something is broken
- `docs-and-specs.md` when writing instructions, docs, or plans
- `beginner-handoff.md` when you want output that a non-dev can follow

## The simple rule
Use:
- **Core skill** all the time
- **One playbook** for the current job
- **Optional short task prompt** for the exact task

That gives you a stack like this:
1. Core behavior
2. Job-specific behavior
3. Task-specific request

---

## How to use this in Copilot CLI

The exact command style can vary depending on your setup, but the practical workflow is the same.

## Recommended pattern

### Option 1: Paste the core skill at the start of a session
Start a fresh Copilot CLI session and paste:
- the contents of `CORE_SKILL.md`
- then the contents of the relevant playbook
- then your actual task

Example session structure:

```text
Use the following as your operating instructions for this session:

[paste CORE_SKILL.md]

Also apply this playbook for this task:

[paste playbooks/edit-existing-repo.md]

Task:
Read the repo first, identify the login flow, and fix the bug where users are redirected to the dashboard before session state is ready. Make the smallest change possible. Verify with the strongest checks available and explain the result in beginner-friendly language.
```

This works well because it is explicit and easy to control.

### Option 2: Keep a reusable prompt file
Create a file in your repo like:
- `.ai/core-skill.md`
- `.ai/playbooks/debugging.md`
- `.ai/prompts/fix-login-bug.md`

Then load or paste those into the session when needed.

This is cleaner if you do this often.

## Best Copilot CLI workflow
1. Ask it to inspect before changing anything
2. Ask for a short plan
3. Ask for the smallest patch
4. Ask it to verify
5. Ask it to summarise what changed and what is still unverified

A strong reusable task prompt is:

```text
First read the relevant files and summarise the current structure. Then restate the real objective, list any material assumptions, make the smallest viable change, verify it with the strongest checks available, and finish with a beginner-friendly handoff.
```

## Good Copilot CLI starter prompts

### For an existing repo
```text
Use the attached core skill and the edit-existing-repo playbook. Inspect the repo first. Do not rewrite architecture. Make the smallest change needed for this task. Verify with repo-native commands and clearly label what is verified versus assumed.
```

### For debugging
```text
Use the attached core skill and debugging playbook. Reproduce the issue before changing code. Identify the likely failure mechanism, patch minimally, and verify the fix without broad refactors.
```

### For a new build
```text
Use the attached core skill and build-from-scratch playbook. Start with the smallest end-to-end version that proves the idea. Prefer boring defaults, low setup friction, and clear run instructions.
```

---

## How to use this in VS Code with GitHub Copilot

## Best place to use it
You can use this in three practical ways:
- as a reusable instructions file you paste into chat
- as repo docs inside a `.github`, `.ai`, or `docs/ai` folder
- as a reference file you ask Copilot to follow during a session

## Recommended repo structure

```text
.ai/
  CORE_SKILL.md
  playbooks/
    copilot-cli.md
    vscode-agents.md
    edit-existing-repo.md
    build-from-scratch.md
    debugging.md
    docs-and-specs.md
    beginner-handoff.md
```

This makes it easy to point Copilot at the files inside the workspace.

## Recommended VS Code workflow

### For chat-based work
Open Copilot Chat and say something like:

```text
Please use `.ai/CORE_SKILL.md` as the main instruction set for this session, and also apply `.ai/playbooks/debugging.md`. First inspect the relevant files, then explain the likely issue, make the smallest patch, and tell me how to verify it.
```

### For agent-style work
Use a similar prompt, but add stronger boundaries:

```text
Use `.ai/CORE_SKILL.md` and `.ai/playbooks/edit-existing-repo.md`. Read the repo first. Touch only the files needed. Do not refactor unrelated code. After making changes, tell me exactly what changed, what was verified, and what still needs manual checking.
```

## My advice for VS Code
Do not rely on the tool to remember your preferred behavior forever.
Re-anchor it at the start of important tasks.
That means explicitly referencing the core skill and the right playbook again.
It reduces drift a lot.

---

## Best way to organise this for yourself

## Recommended setup
Create a folder in your coding workspace called `.ai` and store:
- the core skill
- the playbooks
- a few reusable prompt templates

Suggested structure:

```text
.ai/
  CORE_SKILL.md
  playbooks/
  prompts/
    inspect-first.md
    patch-not-rewrite.md
    beginner-handoff.md
```

## Example reusable prompt templates

### `inspect-first.md`
```text
Read the relevant files before proposing changes. Summarise structure, identify the likely files involved, and explain the smallest sensible path forward.
```

### `patch-not-rewrite.md`
```text
Make the smallest viable change. Do not redesign architecture unless the current structure is the direct cause of failure.
```

### `beginner-handoff.md`
```text
When finished, explain what changed, how to run it, what success looks like, and what to do if it fails. Keep the language suitable for a beginner.
```

---

## What I would actually do in your shoes

For your vibe coding setup, I would use this routine:

### Default stack
- `CORE_SKILL.md`
- one playbook based on the job
- one short task prompt

### Real examples

#### Fixing a bug in an existing repo
- Core skill
- `debugging.md`
- `edit-existing-repo.md`
- task prompt: "Fix the redirect race condition after login"

#### Starting a beginner-friendly app
- Core skill
- `build-from-scratch.md`
- `beginner-handoff.md`
- task prompt: "Build the smallest usable version first and explain every step simply"

#### Writing project docs
- Core skill
- `docs-and-specs.md`
- task prompt: "Write a setup guide that a non-dev can follow without guessing"

---

## Important practical tips

1. Keep the core file stable
Do not keep rewriting the core every week.
Treat it like your constitution.

2. Put variation in playbooks
If your needs change, update playbooks first.
That keeps the system clean.

3. Prefer one playbook at a time
Two can work when they are complementary, but too many causes blur.

4. Ask for verification every time
This is one of the biggest quality upgrades.
Always ask what was actually checked.

5. Ask for handoff in plain English
Especially for beginner workflows.
Otherwise tools often finish with dev-centric shorthand.

---

## The shortest version

If you want the simplest possible way to use this:

### In Copilot CLI
Paste:
1. core skill
2. one playbook
3. your task

### In VS Code
Store the files in `.ai/` and tell Copilot:
- use `.ai/CORE_SKILL.md`
- also apply `.ai/playbooks/[chosen-file].md`
- inspect first
- patch minimally
- verify
- explain clearly

That is the cleanest working setup.
