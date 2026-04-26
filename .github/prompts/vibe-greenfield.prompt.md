---
description: 'Start a new project, repo, or major standalone module from zero. Spine-first, defer-the-cheap-decisions discipline.'
mode: 'agent'
---

# Vibe Greenfield

First-commit territory. No existing files to match, no conventions to follow, no tests to extend. You are choosing the shape.

The repository's `copilot-instructions.md` defines the shared posture, verification ladder, confidence labels, and handoff template. This prompt extends those for greenfield work.

## Core Posture

Resist the urge to scaffold everything you might need. The hardest part of greenfield is not building — it is building **only what the next 48 hours requires**.

Prefer:
- vertical slice over horizontal layers
- one working path over ten stubbed paths
- concrete naming over generic naming (`Order`, not `Entity`)
- inline code over premature extraction
- working end-to-end before working thoroughly

## Procedure

1. **Define the smallest demonstrable outcome.**
   - One sentence: "When done, I can do X and see Y."
   - If you cannot state it in one sentence, the scope is wrong.

2. **Choose the spine before the skeleton.**
   - Pick the one user-facing path that proves the system works.
   - Implement that path top-to-bottom, leaving everything else absent.

3. **Lock decisions that are expensive to reverse; defer the rest.**
   - Expensive: language, framework, database, deployment target, auth model
   - Cheap: file structure, naming, internal abstractions, test framework
   - Decide expensive ones explicitly. Let cheap ones emerge.

4. **Build the spine end-to-end before widening.**
   - One route, one model, one component, one test — all wired together.
   - No second feature until the first runs end-to-end on a fresh clone.

5. **Verify with a fresh-start check.**
   - Clone the repo, follow the README, run the app.
   - If it does not work in under 5 minutes, the project is not started — it is half-started.

6. **Hand off with a runnable state.**
   - README with prerequisites, install, run, verify
   - One smoke test that proves the spine works
   - A single ordered TODO list of what comes next

## Worked Example

**Request:** "Start a new project — a CLI tool that takes a URL and returns the page title."

**Smallest demonstrable outcome:** "When done, I can run the CLI with a URL argument and see the page title printed to stdout."

**Spine:** parse one CLI argument → fetch one URL → extract the `<title>` → print it. No config files, no error recovery, no batch mode, no output formats.

**Expensive decisions locked:**
- TypeScript + Node (matches existing tooling preferences)
- Native `fetch` (no HTTP library dependency)
- Regex-based title extraction (no HTML parser dependency yet)

**Deferred:**
- Multiple URLs at once
- Output formats (JSON, CSV)
- Retry logic
- Config file support
- Tests beyond the smoke test

**Spine implementation:** ~30 lines in `src/index.ts`, one `package.json`, one README.

**Fresh-start check:** clone the repo, follow the README install step, run the CLI against `https://example.com`. See `Example Domain` printed. Total time: under 2 minutes.

**Handoff:**
```
Changed: new repo, 4 files (src/index.ts, package.json, README.md, .gitignore)
Why: spine for URL-to-title CLI — single URL, single output, manual run only
Verified: ran fresh clone, fetched two test URLs, both printed correct titles
Confidence: verified
Unknown: behaviour with non-HTML responses, redirects, or auth-walled pages — not handled
Next: decide whether to add HTML parser dependency before adding more URL types
```

## Anti-Patterns To Avoid

- Setting up auth before there is anything to authenticate
- Creating folders for features that do not exist yet (`/utils`, `/helpers`, `/services` with one file each)
- Configuring CI/CD before there is code worth deploying
- Choosing libraries based on "we will probably need this" rather than "we need this for the spine"
- Writing abstractions before there are two concrete uses to abstract from
- Building admin panels, dashboards, or settings pages before the core works
- Premature ORM setup when one SQL query would do
- Premature monorepo when one package would do
- Writing tests for code that has not yet been used end-to-end

## Quality Bar

Greenfield work is done when someone else can clone the repo, follow the README, and see the spine working in under 5 minutes — and when the next three tasks are obvious.
