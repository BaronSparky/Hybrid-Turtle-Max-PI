import { describe, expect, it } from 'vitest';
import { shouldRunSmokeForChangedFiles } from './pre-push-source-filter';

describe('shouldRunSmokeForChangedFiles', () => {
  it('runs smoke when source files changed', () => {
    expect(shouldRunSmokeForChangedFiles(['src/lib/alert-service.ts'])).toBe(true);
    expect(shouldRunSmokeForChangedFiles(['scripts/smoke-buy-flow.ts'])).toBe(true);
    expect(shouldRunSmokeForChangedFiles(['packages/risk/src/index.ts'])).toBe(true);
  });

  it('runs smoke when developer workflow or root config files changed', () => {
    expect(shouldRunSmokeForChangedFiles(['.husky/pre-push'])).toBe(true);
    expect(shouldRunSmokeForChangedFiles(['package.json'])).toBe(true);
    expect(shouldRunSmokeForChangedFiles(['package-lock.json'])).toBe(true);
    expect(shouldRunSmokeForChangedFiles(['tsconfig.json'])).toBe(true);
    expect(shouldRunSmokeForChangedFiles(['eslint.config.mjs'])).toBe(true);
  });

  it('skips smoke for docs-only changes', () => {
    expect(shouldRunSmokeForChangedFiles([
      'README.md',
      'docs/SACRED_FILE_CHANGES.md',
      '.copilot-tracking/memory/2026-04-29/rpi-observability-cycles-memory.md',
    ])).toBe(false);
  });

  it('normalizes Windows path separators', () => {
    expect(shouldRunSmokeForChangedFiles(['src\\lib\\alert-service.ts'])).toBe(true);
  });

  it('preserves previous behavior when changed file list is unavailable', () => {
    expect(shouldRunSmokeForChangedFiles([])).toBe(true);
  });
});