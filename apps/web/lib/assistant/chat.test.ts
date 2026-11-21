import { describe, expect, it } from 'vitest';
import { appendMessage, comingSoonResponder, normalizeInput, type ChatMessage } from './chat';

describe('assistant chat shell (T314)', () => {
  it('the coming-soon responder always gives the same reply', async () => {
    const respond = comingSoonResponder('Yakında');
    const history: ChatMessage[] = [{ id: 'm1', role: 'user', text: 'x' }];
    await expect(respond({ text: 'plakayı 1830 yap', history: [] })).resolves.toBe('Yakında');
    await expect(respond({ text: 'çizgi çiz', history })).resolves.toBe('Yakında');
  });

  it('normalizeInput trims and rejects empty text', () => {
    expect(normalizeInput('  merhaba  ')).toBe('merhaba');
    expect(normalizeInput('   ')).toBeNull();
    expect(normalizeInput('')).toBeNull();
  });

  it('appendMessage adds with a new id and does not mutate', () => {
    const a: ChatMessage[] = [];
    const b = appendMessage(a, 'user', 'selam');
    const c = appendMessage(b, 'assistant', 'yakında');
    expect(a).toEqual([]);
    expect(c.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(c[1]).toEqual({ id: 'm2', role: 'assistant', text: 'yakında' });
  });
});
