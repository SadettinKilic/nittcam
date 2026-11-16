import type { MachineProfileIssue } from '@nittcam/core';
import type { Messages } from '../../lib/messages';

export type ErrorText = Messages['machines']['errors'];

/** Field path → Turkish message (first issue per path wins). */
export type FieldErrors = Record<string, string>;

const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });

function fill(template: string, values: Record<string, number | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = values[k];
    return v === undefined ? '' : nf.format(v);
  });
}

/** Turkish message for one core profile issue (by rule key, then by Zod code and bound). */
export function issueMessage(issue: MachineProfileIssue, t: ErrorText): string {
  if (issue.key && issue.key in t) return t[issue.key as keyof ErrorText];
  const bounds = { min: issue.minimum, max: issue.maximum };
  switch (issue.code) {
    case 'invalid_type':
      return issue.origin === 'int' ? t.integer : t.number;
    case 'too_small':
      if (issue.origin === 'string') return t.required;
      if (issue.origin === 'array') return fill(t.tooFew, bounds);
      return fill(issue.inclusive === false ? t.greaterThan : t.min, bounds);
    case 'too_big':
      if (issue.origin === 'string') return fill(t.maxLength, bounds);
      if (issue.origin === 'array') return fill(t.tooMany, bounds);
      return fill(issue.inclusive === false ? t.lessThan : t.max, bounds);
    case 'invalid_format':
      return t.format;
    case 'invalid_value':
      return t.choice;
    default:
      return t.generic;
  }
}

export function fieldErrors(issues: readonly MachineProfileIssue[], t: ErrorText): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    out[issue.path] ??= issueMessage(issue, t);
  }
  return out;
}
