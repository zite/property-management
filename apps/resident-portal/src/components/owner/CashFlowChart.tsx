import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { cn } from '@project/components/lib/utils';
import { useIsDark } from '../../lib/theme';
import { money } from './kit';

/**
 * Income against expenses by month — two series on one money axis, so the
 * gap between the bars is the month's operating cash flow. Palette slots 1
 * and 2 (blue, orange), stepped per theme and validated for colour-vision
 * deficiency; a legend and a table view carry the same values without colour.
 */

type Row = { period: string; label: string; income: number; expenses: number; net: number };

const THEME = {
  light: { income: '#2a78d6', expenses: '#eb6834', grid: '#e6e9ee', axis: '#5d6470', cursor: 'rgba(15, 23, 42, 0.04)' },
  dark: { income: '#3987e5', expenses: '#d95926', grid: '#262a32', axis: '#a3a9b3', cursor: 'rgba(255, 255, 255, 0.04)' },
};

const shortMonth = (label: string) => label.split(' ')[0];

function ChartTooltip({ active, payload, currency, colors }: TooltipProps<number, string> & { currency: string; colors: typeof THEME.light }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as Row;
  return (
    <div className="min-w-[180px] rounded-lg border bg-popover px-3 py-2.5 text-sm text-popover-foreground shadow-md">
      <p className="mb-1.5 font-medium">{row.label}</p>
      <dl className="space-y-1">
        {(['income', 'expenses'] as const).map(k => (
          <div key={k} className="flex items-center justify-between gap-4">
            <dt className="flex items-center gap-2 text-muted-foreground">
              <span className="h-0.5 w-3 rounded-full" style={{ background: colors[k] }} aria-hidden />
              {k === 'income' ? 'Income' : 'Expenses'}
            </dt>
            <dd className="font-semibold tabular-nums">{money(row[k], currency)}</dd>
          </div>
        ))}
        <div className="mt-1 flex items-center justify-between gap-4 border-t pt-1.5">
          <dt className="text-muted-foreground">Net</dt>
          <dd className="font-semibold tabular-nums">{money(row.net, currency)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function CashFlowChart({ rows, currency, partialLabel }: { rows: Row[]; currency: string; partialLabel?: string }) {
  const dark = useIsDark();
  const colors = dark ? THEME.dark : THEME.light;
  const [table, setTable] = useState(false);
  const hasData = rows.some(r => r.income !== 0 || r.expenses !== 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="flex items-center gap-4 text-sm text-muted-foreground" aria-label="Legend">
          <li className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colors.income }} aria-hidden /> Income
          </li>
          <li className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colors.expenses }} aria-hidden /> Expenses
          </li>
        </ul>
        <button type="button" onClick={() => setTable(t => !t)} className="rounded-md px-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35" aria-expanded={table}>
          {table ? 'Show chart' : 'Show as table'}
        </button>
      </div>

      {table ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Month</th>
                <th className="py-2 pr-3 text-right font-medium">Income</th>
                <th className="py-2 pr-3 text-right font-medium">Expenses</th>
                <th className="py-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map(r => (
                <tr key={r.period} className="border-b last:border-0">
                  <td className="py-2 pr-3">{r.label}</td>
                  <td className="py-2 pr-3 text-right">{money(r.income, currency)}</td>
                  <td className="py-2 pr-3 text-right">{money(r.expenses, currency)}</td>
                  <td className="py-2 text-right font-medium">{money(r.net, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !hasData ? (
        <p className="mt-3 flex h-56 items-center justify-center rounded-lg border border-dashed text-[15px] text-muted-foreground">No income or expenses in these months yet.</p>
      ) : (
        <div className={cn('mt-3 h-64 w-full')} role="img" aria-label={`Income and expenses by month, ${rows[0]?.label} to ${rows[rows.length - 1]?.label}. Use “Show as table” for the values.`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barGap={2} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke={colors.grid} strokeWidth={1} />
              <XAxis dataKey="label" tickFormatter={shortMonth} tickLine={false} axisLine={{ stroke: colors.grid }} tick={{ fill: colors.axis, fontSize: 12 }} dy={6} interval={0} />
              <YAxis tickFormatter={v => money(Number(v), currency, { compact: true })} tickLine={false} axisLine={false} tick={{ fill: colors.axis, fontSize: 12 }} width={56} />
              <Tooltip cursor={{ fill: colors.cursor }} content={<ChartTooltip currency={currency} colors={colors} />} isAnimationActive={false} />
              <Bar dataKey="income" name="Income" fill={colors.income} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              <Bar dataKey="expenses" name="Expenses" fill={colors.expenses} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {partialLabel && <p className="mt-2 text-xs text-muted-foreground">{partialLabel}</p>}
    </div>
  );
}
