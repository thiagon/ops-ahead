import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';

/**
 * Recharts measures its own container, so the wrapper needs a real height —
 * `ResponsiveContainer` inside a zero-height parent renders nothing.
 */
export function Sparkline({
  data,
  className,
  labels,
  formatValue,
}: {
  data: number[];
  className?: string;
  labels?: string[];
  formatValue?: (value: number) => string;
}) {
  const points = data.map((value, i) => ({ value, label: labels?.[i] ?? `#${i + 1}` }));

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Tooltip
            cursor={{ stroke: 'currentColor', strokeOpacity: 0.3 }}
            contentStyle={{
              backgroundColor: 'var(--color-bg-main)',
              border: '1px solid var(--color-border-base)',
              borderRadius: '0.5rem',
              fontSize: '0.7rem',
              fontFamily: 'var(--font-mono)',
            }}
            labelStyle={{ color: 'var(--color-text-muted)' }}
            itemStyle={{ color: 'var(--color-text-light)' }}
            formatter={value => {
              const numeric = Number(value);
              return [formatValue ? formatValue(numeric) : numeric.toFixed(1), 'valor'];
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="currentColor"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
