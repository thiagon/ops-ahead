import { describe, expect, it } from 'vitest';
import { parsePeriod } from '../app/routes/panel.tsx';

describe('panel period selector', () => {
  it('accepts the periods the screen offers', () => {
    expect(parsePeriod('7')).toBe(7);
    expect(parsePeriod('30')).toBe(30);
  });

  it('falls back to the default for anything else', () => {
    // The parameter comes from the URL, so any string can reach it.
    expect(parsePeriod(null)).toBe(14);
    expect(parsePeriod('')).toBe(14);
    expect(parsePeriod('90')).toBe(14);
    expect(parsePeriod('drop table')).toBe(14);
  });
});
