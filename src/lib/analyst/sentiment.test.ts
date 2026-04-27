import { describe, expect, it, vi, beforeEach } from 'vitest';

// Hoist mocks for ollama-client
const { mockCheckHealth, mockGenerate, mockPickModel } = vi.hoisted(() => ({
  mockCheckHealth: vi.fn(),
  mockGenerate: vi.fn(),
  mockPickModel: vi.fn(),
}));

vi.mock('./ollama-client', () => ({
  checkOllamaHealth: mockCheckHealth,
  ollamaGenerate: mockGenerate,
  pickModelForContext: mockPickModel,
}));

import { classifyBatchSentiment } from './sentiment';

const HEALTHY = {
  available: true,
  models: [{ name: 'gemma3:4b', size: 2.5e9, digest: 'x', modified_at: '' }],
  selectedModel: 'gemma3:4b',
  latencyMs: 100,
  baseUrl: 'http://localhost:11434',
};

describe('classifyBatchSentiment', () => {
  beforeEach(() => {
    mockCheckHealth.mockReset();
    mockGenerate.mockReset();
    mockPickModel.mockReset();
    mockPickModel.mockReturnValue('gemma3:4b');
  });

  it('returns NEUTRAL for all when no headlines exist', async () => {
    const result = await classifyBatchSentiment([
      { ticker: 'AAPL', headlines: [] },
      { ticker: 'MSFT', headlines: [] },
    ]);

    expect(result).toEqual([
      { ticker: 'AAPL', sentiment: 'NEUTRAL', confidence: 'LOW' },
      { ticker: 'MSFT', sentiment: 'NEUTRAL', confidence: 'LOW' },
    ]);
    // Should not call Ollama at all
    expect(mockCheckHealth).not.toHaveBeenCalled();
  });

  it('classifies tickers from Ollama response', async () => {
    mockCheckHealth.mockResolvedValue(HEALTHY);
    mockGenerate.mockResolvedValue({
      response: 'AAPL:POSITIVE\nMSFT:NEGATIVE\nTSLA:NEUTRAL',
      done: true,
    });

    const result = await classifyBatchSentiment([
      { ticker: 'AAPL', headlines: [{ title: 'Apple beats earnings' }] },
      { ticker: 'MSFT', headlines: [{ title: 'Microsoft misses revenue target' }] },
      { ticker: 'TSLA', headlines: [{ title: 'Tesla at conference' }] },
    ]);

    expect(result).toEqual([
      { ticker: 'AAPL', sentiment: 'POSITIVE', confidence: 'HIGH' },
      { ticker: 'MSFT', sentiment: 'NEGATIVE', confidence: 'HIGH' },
      { ticker: 'TSLA', sentiment: 'NEUTRAL', confidence: 'HIGH' },
    ]);
  });

  it('returns NEUTRAL with LOW confidence when ticker not in LLM response', async () => {
    mockCheckHealth.mockResolvedValue(HEALTHY);
    mockGenerate.mockResolvedValue({
      response: 'AAPL:POSITIVE',
      done: true,
    });

    const result = await classifyBatchSentiment([
      { ticker: 'AAPL', headlines: [{ title: 'Good news' }] },
      { ticker: 'NVDA', headlines: [{ title: 'GPU demand' }] },
    ]);

    expect(result[0]).toEqual({ ticker: 'AAPL', sentiment: 'POSITIVE', confidence: 'HIGH' });
    expect(result[1]).toEqual({ ticker: 'NVDA', sentiment: 'NEUTRAL', confidence: 'LOW' });
  });

  it('returns NEUTRAL for all when Ollama is offline', async () => {
    mockCheckHealth.mockResolvedValue({ available: false, models: [], selectedModel: null, latencyMs: null, baseUrl: '' });

    const result = await classifyBatchSentiment([
      { ticker: 'AAPL', headlines: [{ title: 'Some news' }] },
    ]);

    expect(result).toEqual([
      { ticker: 'AAPL', sentiment: 'NEUTRAL', confidence: 'LOW' },
    ]);
  });

  it('returns NEUTRAL for all when Ollama returns null', async () => {
    mockCheckHealth.mockResolvedValue(HEALTHY);
    mockGenerate.mockResolvedValue(null);

    const result = await classifyBatchSentiment([
      { ticker: 'AAPL', headlines: [{ title: 'Some news' }] },
    ]);

    expect(result).toEqual([
      { ticker: 'AAPL', sentiment: 'NEUTRAL', confidence: 'LOW' },
    ]);
  });

  it('handles malformed LLM response gracefully', async () => {
    mockCheckHealth.mockResolvedValue(HEALTHY);
    mockGenerate.mockResolvedValue({
      response: 'I think AAPL is looking good! The sentiment is very positive.',
      done: true,
    });

    const result = await classifyBatchSentiment([
      { ticker: 'AAPL', headlines: [{ title: 'Some news' }] },
    ]);

    // Can't parse structured response — defaults to NEUTRAL
    expect(result[0].sentiment).toBe('NEUTRAL');
    expect(result[0].confidence).toBe('LOW');
  });

  it('handles fetch error gracefully', async () => {
    mockCheckHealth.mockRejectedValue(new Error('Network error'));

    const result = await classifyBatchSentiment([
      { ticker: 'AAPL', headlines: [{ title: 'Some news' }] },
    ]);

    expect(result).toEqual([
      { ticker: 'AAPL', sentiment: 'NEUTRAL', confidence: 'LOW' },
    ]);
  });

  it('parses response with = separator and extra whitespace', async () => {
    mockCheckHealth.mockResolvedValue(HEALTHY);
    mockGenerate.mockResolvedValue({
      response: '  AAPL = POSITIVE  \n  MSFT = NEGATIVE  ',
      done: true,
    });

    const result = await classifyBatchSentiment([
      { ticker: 'AAPL', headlines: [{ title: 'News' }] },
      { ticker: 'MSFT', headlines: [{ title: 'News' }] },
    ]);

    expect(result[0].sentiment).toBe('POSITIVE');
    expect(result[1].sentiment).toBe('NEGATIVE');
  });

  it('includes tickers without headlines in result as NEUTRAL', async () => {
    mockCheckHealth.mockResolvedValue(HEALTHY);
    mockGenerate.mockResolvedValue({
      response: 'AAPL:POSITIVE',
      done: true,
    });

    const result = await classifyBatchSentiment([
      { ticker: 'AAPL', headlines: [{ title: 'News' }] },
      { ticker: 'GOOG', headlines: [] }, // No headlines — should still appear in result
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].sentiment).toBe('POSITIVE');
    expect(result[1]).toEqual({ ticker: 'GOOG', sentiment: 'NEUTRAL', confidence: 'LOW' });
  });
});
