import { describe, expect, it, vi } from 'vitest';
import { runSchemaReconcileCheck } from './auto-migrate.mjs';

describe('auto-migrate schema reconciliation check', () => {
  it('logs known drift guidance without throwing or applying changes', () => {
    const exec = vi.fn(() => {
      throw { status: 2, stderr: '', message: 'known drift' };
    });
    const reportError = vi.fn();

    expect(() => runSchemaReconcileCheck({
      reconcileScript: 'scripts/reconcile-schema-drift.mjs',
      quiet: true,
      exec,
      reportError,
    })).not.toThrow();

    expect(exec).toHaveBeenCalledWith(
      'node "scripts/reconcile-schema-drift.mjs" --check --quiet',
      expect.objectContaining({ stdio: 'pipe' })
    );
    expect(reportError).toHaveBeenCalledWith(
      'Known additive schema drift detected. Run a backup, then inspect: node scripts/reconcile-schema-drift.mjs'
    );
  });
});