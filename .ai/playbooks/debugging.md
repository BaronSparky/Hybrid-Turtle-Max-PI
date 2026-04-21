# Playbook: Debugging

## Goal
Find the real failure mechanism with the least disruption.

## Rules
- Reproduce before fixing.
- Check assumptions before editing code.
- Prefer evidence over theories.
- Isolate the failure point.
- Apply the smallest high-leverage fix first.

## Debug flow
1. State the symptom
2. State the expected behavior
3. Reproduce consistently
4. Narrow the layer: input, state, logic, network, storage, rendering, environment
5. Identify the likely failure mechanism
6. Patch minimally
7. Verify the symptom is gone and no nearby behavior broke

## Useful questions
- What changed recently?
- Is the failure deterministic?
- Is this an environment issue, logic issue, or data issue?
- What is the first place reality diverges from expectation?
