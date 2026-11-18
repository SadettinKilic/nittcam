import { describe, expect, it, vi } from 'vitest';
import { guardedNavigate, setNavigationGuard } from './navigation-guard';

describe('navigation guard', () => {
  it('navigates when no guard is set or the guard lets it through', () => {
    const go = vi.fn();
    guardedNavigate('/projeler', go);
    expect(go).toHaveBeenCalledWith('/projeler');
    const off = setNavigationGuard(() => false);
    guardedNavigate('/makineler', go);
    expect(go).toHaveBeenCalledWith('/makineler');
    off();
  });

  it('lets an active guard take over, and only the active guard can be removed', () => {
    const go = vi.fn();
    const seen: string[] = [];
    const offA = setNavigationGuard((href) => (seen.push(href), true));
    guardedNavigate('/projeler', go);
    expect(go).not.toHaveBeenCalled();
    expect(seen).toEqual(['/projeler']);
    const offB = setNavigationGuard(() => true);
    offA(); // stale remover: B stays active
    guardedNavigate('/', go);
    expect(go).not.toHaveBeenCalled();
    offB();
    guardedNavigate('/', go);
    expect(go).toHaveBeenCalledWith('/');
  });
});
