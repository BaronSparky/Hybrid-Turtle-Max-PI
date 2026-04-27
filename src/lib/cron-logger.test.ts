import { describe, expect, it, vi } from 'vitest';
import { createCronLogger } from './cron-logger';

describe('cron-logger', () => {
  it('emits structured JSON to console.log for info level', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = createCronLogger('test-job');
    log.info('hello world', { count: 42 });

    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.job).toBe('test-job');
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello world');
    expect(parsed.count).toBe(42);
    expect(parsed.ts).toBeDefined();
    spy.mockRestore();
  });

  it('emits to console.error for error level', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = createCronLogger('err-job');
    log.error('something broke', { code: 'FAIL' });

    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.level).toBe('error');
    expect(parsed.code).toBe('FAIL');
    spy.mockRestore();
  });

  it('emits to console.warn for warn level', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = createCronLogger('warn-job');
    log.warn('heads up');

    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.level).toBe('warn');
    spy.mockRestore();
  });

  it('child logger inherits parent fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = createCronLogger('parent-job', { session: 'uk' });
    const child = log.child({ ticker: 'AAPL' });
    child.info('processing');

    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.session).toBe('uk');
    expect(parsed.ticker).toBe('AAPL');
    expect(parsed.job).toBe('parent-job');
    spy.mockRestore();
  });

  it('data fields override parent fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = createCronLogger('job', { step: 'scan' });
    log.info('done', { step: 'trade' });

    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.step).toBe('trade');
    spy.mockRestore();
  });
});
