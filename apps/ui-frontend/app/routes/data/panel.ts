import { fetchAlertDailyFeatures, fetchRecurringPatterns } from '~/clickhouse.server.ts';
import { dataResponse } from '~/data-response.server.ts';
import { loadQueue } from '~/queue.server.ts';
import { parsePeriod } from '~/routes/panel.tsx';
import type { Route } from './+types/panel';

function criticality(row: {
  severity: number;
  consumed_ratio: number;
  breach_probability: number | null;
}): number {
  const score = row.breach_probability ?? 0;
  return (6 - row.severity) * 10 + row.consumed_ratio * 5 + score * 3;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  return dataResponse(request, params.tenant, async () => {
    const periodDays = parsePeriod(new URL(request.url).searchParams.get('period'));
    const [queue, dailyFeatures, recurringPatterns] = await Promise.all([
      loadQueue(),
      fetchAlertDailyFeatures(periodDays),
      fetchRecurringPatterns(periodDays),
    ]);
    const rows = [...queue].sort((a, b) => criticality(b) - criticality(a));
    return { rows, dailyFeatures, recurringPatterns, periodDays };
  });
}
