# Playbook: Building From Scratch

## Goal
Start simple, stay coherent, and avoid building a fragile pile of premature architecture.

## Rules
- Begin with the smallest useful version.
- Choose boring, well-supported defaults.
- Keep setup friction low.
- Prefer one path that works over many options.
- Defer advanced features until the core loop works.

## Recommended order
1. Define outcome and user journey
2. Pick stack based on simplicity, not novelty
3. Build the thinnest end-to-end slice
4. Verify that slice works in reality
5. Add the next layer only after the first is stable

## Minimum build order
- app skeleton
- one working feature path
- persistence if needed
- validation
- error states that users can actually hit
- docs for setup and run

## Anti-patterns
- auth before core value
- plugin systems before one solid workflow
- multiple databases or queues without clear need
- abstracting future complexity that may never arrive
