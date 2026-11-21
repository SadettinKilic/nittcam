import type { ValidationIssue } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { checkState, parkOff, renestOnly, summarizeIssues } from './check-state';

const issue = (code: string, severity: 'error' | 'warning', path = 'parts[0]'): ValidationIssue =>
  ({ code, severity, path, message: code }) as ValidationIssue;

describe('check state (T321)', () => {
  it('warnings without errors are amber, never the green "geçti"', () => {
    expect(checkState(0, 0)).toBe('ok');
    expect(checkState(0, 7)).toBe('warn');
    expect(checkState(1, 7)).toBe('fail');
  });

  it('the Uyarılar box counts the simulation warnings, so it never says "Sorun bulunmadı" then', () => {
    const s = summarizeIssues([], 1);
    expect(s.clean).toBe(false);
    expect(s.warningCount).toBe(1);
    expect(summarizeIssues([], 0).clean).toBe(true);
  });

  it('parts missing from the layout are a neutral "yeniden diz", not errors', () => {
    const issues = [
      issue('PART_NOT_IN_LAYOUT', 'error', 'parts[0]'),
      issue('PART_NOT_IN_LAYOUT', 'error', 'parts[1]'),
      issue('HOLE_MIN_SKIN', 'warning', 'parts[2].holes[0]'),
    ];
    const s = summarizeIssues(issues, 0);
    expect(s.errors).toHaveLength(0);
    expect(s.renest).toHaveLength(2);
    expect(s.warningCount).toBe(1);
    expect(s.clean).toBe(false);
    expect(renestOnly([issues[0] as ValidationIssue])).toBe(true);
    expect(renestOnly(issues)).toBe(false);
    expect(renestOnly([])).toBe(false);
  });

  it('a manual changer without a park point warns; auto changers and park on do not', () => {
    expect(parkOff({ toolChanger: { type: 'manual' } })).toBe(true);
    expect(parkOff({ toolChanger: { type: 'manual', park: { enabled: false } } })).toBe(true);
    expect(parkOff({ toolChanger: { type: 'manual', park: { enabled: true } } })).toBe(false);
    expect(parkOff({ toolChanger: { type: 'auto' } })).toBe(false);
  });
});
