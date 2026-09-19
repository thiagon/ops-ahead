import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { VolumeForecastRow } from '~/types.ts';

const GROUP_COLOR: Record<string, string> = {
  p1: 'var(--color-accent-red)',
  p2: 'var(--color-signal-amber)',
  p3: 'var(--color-signal-blue)',
  total: 'var(--color-signal-purple)',
};

/**
 * The 80% band is drawn as a translucent segment stacked on top of the
 * prediction — at the handful of occurrences this forecast deals in, a whisker
 * is shorter than its own caps.
 */
function toPoint(row: VolumeForecastRow) {
  const yhat = Math.round(row.yhat);
  const upper = Math.round(row.yhat_upper);
  return {
    name: `${row.priority_group.toUpperCase()} D+${row.horizon}`,
    group: row.priority_group,
    yhat,
    headroom: Math.max(upper - yhat, 0),
    lower: Math.round(row.yhat_lower),
    upper,
  };
}

export function ForecastChart({ rows }: { rows: VolumeForecastRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-text-muted">Nenhuma previsão publicada ainda.</p>;
  }

  const data = [...rows]
    .sort((a, b) => a.priority_group.localeCompare(b.priority_group) || a.horizon - b.horizon)
    .map(toPoint);

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-base)" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
            stroke="var(--color-border-base)"
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
            stroke="var(--color-border-base)"
          />
          <Tooltip
            cursor={{ fill: 'rgb(255 255 255 / 0.04)' }}
            contentStyle={{
              backgroundColor: 'var(--color-bg-main)',
              border: '1px solid var(--color-border-base)',
              borderRadius: '0.5rem',
              fontSize: '0.75rem',
              fontFamily: 'var(--font-mono)',
            }}
            labelStyle={{ color: 'var(--color-text-muted)' }}
            itemStyle={{ color: 'var(--color-text-light)' }}
            formatter={(_value, name, item) => {
              if (name === 'headroom') return [];
              const point = item.payload as ReturnType<typeof toPoint>;
              return [`${point.yhat} (faixa 80%: ${point.lower}–${point.upper})`, 'previsto'];
            }}
          />
          <Bar dataKey="yhat" stackId="forecast" isAnimationActive={false}>
            {data.map(point => (
              <Cell
                key={point.name}
                fill={GROUP_COLOR[point.group] ?? 'var(--color-signal-blue)'}
              />
            ))}
          </Bar>
          <Bar
            dataKey="headroom"
            stackId="forecast"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          >
            {data.map(point => (
              <Cell
                key={point.name}
                fill={GROUP_COLOR[point.group] ?? 'var(--color-signal-blue)'}
                fillOpacity={0.25}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
