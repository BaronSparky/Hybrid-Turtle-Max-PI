import { describe, expect, it, vi, beforeEach } from 'vitest';
import { promises as fs } from 'fs';

vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
  },
}));

import { getModelFeedbackScores, getModelScore, clearFeedbackCache } from './feedback-reader';

describe('feedback-reader', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearFeedbackCache();
  });

  describe('getModelFeedbackScores', () => {
    it('returns empty array when feedback file does not exist', async () => {
      (fs.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));
      const result = await getModelFeedbackScores();
      expect(result).toEqual([]);
    });

    it('aggregates scores per model', async () => {
      const store = {
        entries: [
          { context: 'a', rating: 'up', model: 'gemma3:4b', timestamp: 1 },
          { context: 'b', rating: 'up', model: 'gemma3:4b', timestamp: 2 },
          { context: 'c', rating: 'down', model: 'gemma3:4b', timestamp: 3 },
          { context: 'd', rating: 'up', model: 'llama3:8b', timestamp: 4 },
          { context: 'e', rating: 'down', model: 'llama3:8b', timestamp: 5 },
        ],
      };
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(store));

      const result = await getModelFeedbackScores();

      const gemma = result.find(s => s.model === 'gemma3:4b');
      expect(gemma).toBeDefined();
      expect(gemma!.up).toBe(2);
      expect(gemma!.down).toBe(1);
      expect(gemma!.helpfulPct).toBe(67);

      const llama = result.find(s => s.model === 'llama3:8b');
      expect(llama).toBeDefined();
      expect(llama!.up).toBe(1);
      expect(llama!.down).toBe(1);
      expect(llama!.helpfulPct).toBe(50);
    });

    it('ignores entries without model field', async () => {
      const store = {
        entries: [
          { context: 'a', rating: 'up', timestamp: 1 },
          { context: 'b', rating: 'up', model: 'gemma3:4b', timestamp: 2 },
        ],
      };
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(store));

      const result = await getModelFeedbackScores();
      expect(result).toHaveLength(1);
      expect(result[0].model).toBe('gemma3:4b');
    });
  });

  describe('getModelScore', () => {
    it('returns 50 for unknown model', async () => {
      (fs.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));
      const score = await getModelScore('unknown:model');
      expect(score).toBe(50);
    });
  });
});
