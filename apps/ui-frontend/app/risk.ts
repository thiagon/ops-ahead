/**
 * The deadline-consumption scale is continuous: it walks green → amber → red
 * as the deadline is consumed, rather than snapping between the three signal
 * colors (spec.md, "Identidade visual"). The stops are the deck's own signal
 * tokens, interpolated in sRGB.
 */
const STOPS: Array<{ at: number; rgb: [number, number, number] }> = [
  { at: 0, rgb: [16, 185, 129] }, // signal-green — within expectation
  { at: 0.75, rgb: [245, 158, 11] }, // signal-amber — at risk (P3 breaches 87% past here)
  { at: 1, rgb: [249, 32, 62] }, // accent-red — breached
];

function mix(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

export function riskColor(consumedRatio: number): string {
  const ratio = Math.min(Math.max(consumedRatio, 0), 1);

  for (let i = 1; i < STOPS.length; i += 1) {
    const lower = STOPS[i - 1];
    const upper = STOPS[i];
    if (!lower || !upper || ratio > upper.at) continue;

    const span = upper.at - lower.at;
    const t = span === 0 ? 0 : (ratio - lower.at) / span;
    const [r, g, b] = [0, 1, 2].map(c => mix(lower.rgb[c] ?? 0, upper.rgb[c] ?? 0, t));
    return `rgb(${r} ${g} ${b})`;
  }

  return `rgb(${STOPS[STOPS.length - 1]?.rgb.join(' ')})`;
}

export function formatRatio(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** Remaining deadline as the operator reads it — negative once breached. */
export function formatRemaining(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const total = Math.floor(Math.abs(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${sign}${hours}h ${String(minutes).padStart(2, '0')}m`;
}

export const SEVERITY_LABEL: Record<number, string> = {
  1: 'Crítica',
  2: 'Alta',
  3: 'Média',
  4: 'Baixa',
  5: 'Muito baixa',
};

export const MILESTONE_LABEL: Record<string, string> = {
  pct_25: '25% do prazo',
  pct_50: '50% do prazo',
  pct_75: '75% do prazo',
  pct_100: 'Prazo estourado',
  abandoned: 'Abandonada',
};
