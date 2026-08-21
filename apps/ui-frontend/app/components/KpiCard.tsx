import { AlertCircleIcon, AlertTriangleIcon, ClockIcon, TrendingUpIcon } from './icons';
import { Sparkline } from './Sparkline';

export type KpiTone = 'red' | 'amber' | 'blue' | 'green';
export type KpiIcon = 'alert-circle' | 'alert-triangle' | 'trending-up' | 'clock';

export interface Kpi {
  label: string;
  value: string;
  delta?: string;
  tone: KpiTone;
  icon: KpiIcon;
  sparkline?: number[];
}

const iconMap = {
  'alert-circle': AlertCircleIcon,
  'alert-triangle': AlertTriangleIcon,
  'trending-up': TrendingUpIcon,
  clock: ClockIcon,
};

const toneClasses: Record<KpiTone, { border: string; text: string; iconBg: string }> = {
  red: {
    border: 'border-accent-red/30',
    text: 'text-accent-red',
    iconBg: 'bg-accent-red/15',
  },
  amber: {
    border: 'border-signal-amber/30',
    text: 'text-signal-amber',
    iconBg: 'bg-signal-amber/15',
  },
  blue: {
    border: 'border-signal-blue/30',
    text: 'text-signal-blue',
    iconBg: 'bg-signal-blue/15',
  },
  green: {
    border: 'border-signal-green/30',
    text: 'text-signal-green',
    iconBg: 'bg-signal-green/15',
  },
};

export function KpiCard({ kpi }: { kpi: Kpi }) {
  const Icon = iconMap[kpi.icon];
  const tone = toneClasses[kpi.tone];

  return (
    <div className={`relative rounded-xl border bg-bg-tile p-4 ${tone.border}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-text-muted text-xs font-semibold tracking-wide uppercase">
          {kpi.label}
        </span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone.iconBg}`}>
          <Icon className={`h-4 w-4 ${tone.text}`} />
        </span>
      </div>
      <div className="mb-1 text-3xl font-bold text-text-light">{kpi.value}</div>
      {kpi.delta && <div className={`text-xs ${tone.text}`}>{kpi.delta}</div>}
      {kpi.sparkline && (
        <Sparkline data={kpi.sparkline} className={`mt-2 h-8 w-full opacity-70 ${tone.text}`} />
      )}
    </div>
  );
}
