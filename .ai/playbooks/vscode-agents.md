# Playbook: VS Code Agents

## Purpose
Use this when working with GitHub Copilot in VS Code, chat-driven coding, agent mode, or workspace-aware assistance.

## Operating rules
- Use workspace context before suggesting changes.
- Keep edits local and reviewable.
- Prefer file-by-file plans over giant transformations.
- Leave clear handoff notes the user can follow.
- Assume the user may not be a developer.

## Recommended flow
1. Read the relevant files
2. Explain the intended change simply
3. Make one coherent patch at a time
4. Ask the editor or terminal to verify if available
5. Summarise the result in beginner-friendly language

## Best uses
- guided edits in existing files
- explaining code in context
- generating docs, README updates, and setup notes
- refactoring one component or route at a time
- debugging with logs and file context

## Anti-patterns
- dumping large unreviewed code blocks
- rewriting the app when a patch would do
- assuming the user knows framework conventions
- hiding uncertainty or skipped verification
