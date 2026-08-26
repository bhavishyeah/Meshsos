import { describe, it, expect } from 'vitest';

describe('Shared types', () => {
  it('should export successfully', async () => {
    const module = await import('./index.ts');
    expect(module).toBeDefined();
  });
});
