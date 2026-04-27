import { describe, expect, it } from 'vitest';
import { pickModel, pickModelForContext, type OllamaModel } from './ollama-client';

// ── pickModel ──

const MODELS: OllamaModel[] = [
  { name: 'llama3.2:3b', size: 2e9, digest: 'abc', modified_at: '2026-04-01' },
  { name: 'gemma3:4b', size: 2.5e9, digest: 'def', modified_at: '2026-04-02' },
  { name: 'gemma3:12b', size: 7e9, digest: 'ghi', modified_at: '2026-04-03' },
  { name: 'mistral:7b', size: 4e9, digest: 'jkl', modified_at: '2026-04-04' },
];

describe('pickModel', () => {
  it('returns preferred model when exact match exists', () => {
    expect(pickModel(MODELS, 'gemma3:12b')).toBe('gemma3:12b');
  });

  it('returns partial match for preferred model', () => {
    expect(pickModel(MODELS, 'gemma3')).toBe('gemma3:4b');
  });

  it('prefers gemma when no preference given', () => {
    expect(pickModel(MODELS, undefined)).toBe('gemma3:4b');
  });

  it('falls back to llama when no gemma available', () => {
    const noGemma = MODELS.filter(m => !m.name.includes('gemma'));
    expect(pickModel(noGemma, undefined)).toBe('llama3.2:3b');
  });

  it('falls back to first model when no gemma or llama', () => {
    const other: OllamaModel[] = [
      { name: 'mistral:7b', size: 4e9, digest: 'jkl', modified_at: '2026-04-04' },
      { name: 'phi3:mini', size: 2e9, digest: 'mno', modified_at: '2026-04-05' },
    ];
    expect(pickModel(other, undefined)).toBe('mistral:7b');
  });

  it('returns empty string for empty model list', () => {
    expect(pickModel([], undefined)).toBe('');
  });

  it('falls back to gemma preference when preferred model not found', () => {
    expect(pickModel(MODELS, 'nonexistent:7b')).toBe('gemma3:4b');
  });
});

// ── pickModelForContext ──

describe('pickModelForContext', () => {
  it('returns largest model for summary context', () => {
    expect(pickModelForContext(MODELS, 'summary')).toBe('gemma3:12b');
  });

  it('returns largest model for explain context', () => {
    expect(pickModelForContext(MODELS, 'explain')).toBe('gemma3:12b');
  });

  it('returns smallest model for short context', () => {
    expect(pickModelForContext(MODELS, 'short')).toBe('llama3.2:3b');
  });

  it('respects preferred model override regardless of context', () => {
    expect(pickModelForContext(MODELS, 'short', 'gemma3:12b')).toBe('gemma3:12b');
  });

  it('returns empty string for empty model list', () => {
    expect(pickModelForContext([], 'summary')).toBe('');
  });

  it('returns only model when single model available', () => {
    const single: OllamaModel[] = [{ name: 'mistral:7b', size: 4e9, digest: 'abc', modified_at: '' }];
    expect(pickModelForContext(single, 'summary')).toBe('mistral:7b');
    expect(pickModelForContext(single, 'short')).toBe('mistral:7b');
  });
});
