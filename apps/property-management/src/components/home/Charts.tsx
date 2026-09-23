import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { COLORS } from '@project/shared/constants';
import { daysInMonth, periodLabel } from '@project/shared/dates';
import { useWorkspace } from '../../lib/workspace';
import type { Dashboard } from './data';

/**
 * Hand-built SVG charts for Home. Thin bars (≤ 24px) with rounded data ends
 * on a single baseline, hairline gridlines, a legend whenever there's more
 * than one series, and a hover tooltip per bar that also works on keyboard
 * focus. Series colours are validated for colour-blind separation and
 * contrast on both the light and dark surfaces.
 */

export const SERIES = {
  received: COLORS.teal,
  noDecision: COLORS.amber,
  offered: COLORS.blue,
  renewing: COLORS.green,
  movingOut: COLORS.violet,
  opened: COLORS.blue,
  completed: COLORS.green,
};

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setWidth(Math.floor(entries[0].contentRect.width)));
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A column with a 4px rounded top and a square foot on the baseline. */
function barPath(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/** Round an axis maximum up to a clean step (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 × 10ⁿ per tick). */
function niceMax(v: number, ticks = 2) {
  if (v <= 0) return ticks;
  const raw = v / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(s => s * mag).find(s => s >= raw) ?? raw;
  return step * ticks;
}

type Tooltip = { x: number; y: number; content: ReactNode } | null;

/** Kept inside the chart's box: a tooltip for the first or last bar shifts inward rather than spilling out of the card. */
function TooltipBox({ tip, width }: { tip: Tooltip; width: number }) {
  if (!tip) return null;
  const half = 90;
  const left = width > half * 2 ? Math.min(Math.max(tip.x, half), width - half) : width / 2;
  return (
    <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border bg-popover px-2 py-1.5 text-sm text-popover-foreground shadow-md" style={{ left, top: tip.y - 6 }}>
      {tip.content}
    </div>
  );
}

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      {items.map(i => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-[2px]" style={{ background: i.color }} aria-hidden />
          {i.label}
        </span>
      ))}
    </div>
  );
}

const H = 132;
const PAD_TOP = 8;
const PAD_BOTTOM = 20;
const AXIS_W = 40;

/** Payments received this month, one column per day. Days still to come are an empty track. */
export function ReceivedChart({ period, days, today }: { period: string; days: NonNullable<Dashboard['charts']['received']>; today: string }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tooltip>(null);
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const [y, m] = period.split('-').map(Number);
  const count = daysInMonth(y, m);
  const byDay = useMemo(() => new Map(days.map(d => [Number(d.day.slice(8, 10)), d])), [days]);
  const max = niceMax(Math.max(0, ...days.map(d => d.amount)));
  const todayNum = today.slice(0, 7) === period ? Number(today.slice(8, 10)) : count;
  const plotW = Math.max(0, width - AXIS_W);
  const slot = plotW / count;
  const barW = Math.max(2, Math.min(24, slot - 2));
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const scale = (v: number) => (v / max) * plotH;

  return (
    <div ref={ref} className="relative" onMouseLeave={() => { setTip(null); setHoverDay(null); }}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={`Payments received each day in ${periodLabel(period)}`}>
          {[0, 0.5, 1].map(t => (
            <g key={t}>
              <line x1={AXIS_W} x2={width} y1={PAD_TOP + plotH - t * plotH} y2={PAD_TOP + plotH - t * plotH} stroke="hsl(var(--border))" strokeWidth={1} />
              <text x={AXIS_W - 6} y={PAD_TOP + plotH - t * plotH + 3.5} textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {ws.money(max * t, { compact: true, cents: false })}
              </text>
            </g>
          ))}
          {Array.from({ length: count }, (_, i) => {
            const dayNum = i + 1;
            const d = byDay.get(dayNum);
            const x = AXIS_W + i * slot + (slot - barW) / 2;
            const h = d ? Math.max(2, scale(d.amount)) : 0;
            const future = dayNum > todayNum;
            const label = `${new Date(y, m - 1, dayNum).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
            return (
              <g key={dayNum}>
                {future && <rect x={x} y={PAD_TOP + plotH - 2} width={barW} height={2} rx={1} fill="hsl(var(--muted))" />}
                {d && <path d={barPath(x, PAD_TOP + plotH - h, barW, h, Math.min(4, barW / 2))} fill={SERIES.received} opacity={hoverDay != null && hoverDay !== dayNum ? 0.55 : 1} />}
                {dayNum % 7 === 1 && (
                  <text x={AXIS_W + i * slot + slot / 2} y={H - 5} textAnchor="middle" className="fill-muted-foreground text-[11px] tabular-nums">{dayNum}</text>
                )}
                <rect
                  x={AXIS_W + i * slot}
                  y={PAD_TOP}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                  tabIndex={d ? 0 : -1}
                  className="cursor-pointer outline-none"
                  aria-label={d ? `${label}: ${ws.money(d.amount)} from ${d.payments} payments` : undefined}
                  onMouseEnter={() => {
                    setHoverDay(dayNum);
                    setTip({ x: AXIS_W + i * slot + slot / 2, y: Math.max(PAD_TOP + 24, PAD_TOP + plotH - h), content: d ? <><span className="font-semibold tabular-nums">{ws.money(d.amount)}</span> <span className="text-muted-foreground">· {label} · {d.payments} {d.payments === 1 ? 'payment' : 'payments'}</span></> : <span className="text-muted-foreground">{label} · {future ? 'still to come' : 'no payments'}</span> });
                  }}
                  onFocus={() => {
                    if (!d) return;
                    setHoverDay(dayNum);
                    setTip({ x: AXIS_W + i * slot + slot / 2, y: Math.max(PAD_TOP + 24, PAD_TOP + plotH - h), content: <><span className="font-semibold tabular-nums">{ws.money(d.amount)}</span> <span className="text-muted-foreground">· {label} · {d.payments} {d.payments === 1 ? 'payment' : 'payments'}</span></> });
                  }}
                  onBlur={() => { setTip(null); setHoverDay(null); }}
                  onClick={() => navigate('/accounting/receivables')}
                />
              </g>
            );
          })}
        </svg>
      )}
      {width === 0 && <div style={{ height: H }} />}
      <TooltipBox tip={tip} width={width} />
    </div>
  );
}

const COL_H = 148;

/** Leases ending in each of the next six months, stacked by what's been decided. */
export function ExpirationsChart({ months }: { months: NonNullable<Dashboard['charts']['expirations']> }) {
  const navigate = useNavigate();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tooltip>(null);
  const [hover, setHover] = useState<string | null>(null);
  const max = niceMax(Math.max(1, ...months.map(mo => mo.total)), 2);
  const plotTop = 16;
  const plotH = COL_H - plotTop - PAD_BOTTOM;
  const slot = width / months.length;
  const barW = Math.min(24, Math.max(8, slot - 16));
  const unit = plotH / max;
  const series = [
    { key: 'noDecision', label: 'No decision', color: SERIES.noDecision },
    { key: 'offered', label: 'Renewal offered', color: SERIES.offered },
    { key: 'renewing', label: 'Renewing', color: SERIES.renewing },
    { key: 'movingOut', label: 'Moving out', color: SERIES.movingOut },
  ] as const;

  return (
    <div className="space-y-2">
      <div ref={ref} className="relative" onMouseLeave={() => { setTip(null); setHover(null); }}>
        {width > 0 && (
          <svg width={width} height={COL_H} role="img" aria-label="Fixed-term leases ending in each of the next six months">
            <line x1={0} x2={width} y1={plotTop + plotH} y2={plotTop + plotH} stroke="hsl(var(--border))" strokeWidth={1} />
            {months.map((mo, i) => {
              const values = { noDecision: Math.max(0, mo.total - mo.offered - mo.renewing - mo.movingOut), offered: mo.offered, renewing: mo.renewing, movingOut: mo.movingOut };
              const x = i * slot + (slot - barW) / 2;
              let yCursor = plotTop + plotH;
              const segs = series.filter(s => values[s.key] > 0);
              const label = periodLabel(mo.period, true);
              const content = (
                <div className="space-y-0.5">
                  <div><span className="font-semibold tabular-nums">{mo.total}</span> <span className="text-muted-foreground">{mo.total === 1 ? 'lease ends' : 'leases end'} in {periodLabel(mo.period)}</span></div>
                  {segs.map(s => (
                    <div key={s.key} className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="h-0.5 w-2.5 rounded-full" style={{ background: s.color }} /> <span className="tabular-nums text-foreground">{values[s.key]}</span> {s.label.toLowerCase()}
                    </div>
                  ))}
                </div>
              );
              return (
                <g key={mo.period} opacity={hover && hover !== mo.period ? 0.55 : 1}>
                  {segs.map((s, idx) => {
                    const h = values[s.key] * unit;
                    const top = idx === segs.length - 1;
                    yCursor -= h;
                    const gap = idx > 0 ? 2 : 0;
                    return top ? <path key={s.key} d={barPath(x, yCursor, barW, h - gap, 4)} fill={s.color} /> : <rect key={s.key} x={x} y={yCursor} width={barW} height={Math.max(0, h - gap)} fill={s.color} />;
                  })}
                  {mo.total > 0 && <text x={x + barW / 2} y={plotTop + plotH - mo.total * unit - 4} textAnchor="middle" className="fill-foreground text-[12px] font-medium tabular-nums">{mo.total}</text>}
                  {mo.total === 0 && <text x={x + barW / 2} y={plotTop + plotH - 4} textAnchor="middle" className="fill-muted-foreground text-[12px] tabular-nums">0</text>}
                  <text x={i * slot + slot / 2} y={COL_H - 5} textAnchor="middle" className="fill-muted-foreground text-[11px]">{label.split(' ')[0]}</text>
                  <rect
                    x={i * slot}
                    y={0}
                    width={slot}
                    height={COL_H}
                    fill="transparent"
                    tabIndex={0}
                    className="cursor-pointer outline-none"
                    aria-label={`${periodLabel(mo.period)}: ${mo.total} leases end`}
                    onMouseEnter={() => { setHover(mo.period); setTip({ x: i * slot + slot / 2, y: Math.max(plotTop + 36, plotTop + plotH - mo.total * unit - 10), content }); }}
                    onFocus={() => { setHover(mo.period); setTip({ x: i * slot + slot / 2, y: plotTop + plotH - mo.total * unit - 10, content }); }}
                    onBlur={() => { setHover(null); setTip(null); }}
                    onClick={() => navigate('/leases')}
                  />
                </g>
              );
            })}
          </svg>
        )}
        {width === 0 && <div style={{ height: COL_H }} />}
        <TooltipBox tip={tip} width={width} />
      </div>
      <Legend items={series.map(s => ({ label: s.label, color: s.color }))} />
    </div>
  );
}

/** Work orders opened and completed per week, last eight weeks. */
export function WorkOrderWeeksChart({ weeks }: { weeks: NonNullable<Dashboard['charts']['workOrderWeeks']> }) {
  const navigate = useNavigate();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tooltip>(null);
  const max = niceMax(Math.max(1, ...weeks.flatMap(w => [w.opened, w.completed])), 2);
  const plotTop = 14;
  const plotH = COL_H - plotTop - PAD_BOTTOM;
  const slot = width / weeks.length;
  const barW = Math.min(14, Math.max(4, (slot - 10) / 2));
  const unit = plotH / max;
  const fmt = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="space-y-2">
      <div ref={ref} className="relative" onMouseLeave={() => setTip(null)}>
        {width > 0 && (
          <svg width={width} height={COL_H} role="img" aria-label="Work orders opened and completed per week">
            <line x1={0} x2={width} y1={plotTop + plotH} y2={plotTop + plotH} stroke="hsl(var(--border))" strokeWidth={1} />
            <line x1={0} x2={width} y1={plotTop} y2={plotTop} stroke="hsl(var(--border))" strokeWidth={1} opacity={0.6} />
            <text x={0} y={plotTop - 4} className="fill-muted-foreground text-[11px] tabular-nums">{max}</text>
            {weeks.map((w, i) => {
              const cx = i * slot + slot / 2;
              const hO = w.opened * unit;
              const hC = w.completed * unit;
              const content = (
                <div className="space-y-0.5">
                  <div className="text-muted-foreground">Week of {fmt(w.weekStart)}</div>
                  <div className="flex items-center gap-1.5"><span className="h-0.5 w-2.5 rounded-full" style={{ background: SERIES.opened }} /> <span className="font-semibold tabular-nums">{w.opened}</span> <span className="text-muted-foreground">opened</span></div>
                  <div className="flex items-center gap-1.5"><span className="h-0.5 w-2.5 rounded-full" style={{ background: SERIES.completed }} /> <span className="font-semibold tabular-nums">{w.completed}</span> <span className="text-muted-foreground">completed</span></div>
                </div>
              );
              return (
                <g key={w.weekStart}>
                  <path d={barPath(cx - barW - 1, plotTop + plotH - hO, barW, hO, Math.min(4, barW / 2))} fill={SERIES.opened} />
                  <path d={barPath(cx + 1, plotTop + plotH - hC, barW, hC, Math.min(4, barW / 2))} fill={SERIES.completed} />
                  {(i % 2 === 1 || weeks.length <= 5) && <text x={cx} y={COL_H - 5} textAnchor="middle" className="fill-muted-foreground text-[11px]">{fmt(w.weekStart)}</text>}
                  <rect x={i * slot} y={0} width={slot} height={COL_H} fill="transparent" tabIndex={0} className="cursor-pointer outline-none" aria-label={`Week of ${fmt(w.weekStart)}: ${w.opened} opened, ${w.completed} completed`}
                    onMouseEnter={() => setTip({ x: cx, y: Math.max(plotTop + 48, plotTop + plotH - Math.max(hO, hC) - 6), content })}
                    onFocus={() => setTip({ x: cx, y: plotTop + plotH - Math.max(hO, hC) - 6, content })}
                    onBlur={() => setTip(null)}
                    onClick={() => navigate('/work-orders')}
                  />
                </g>
              );
            })}
          </svg>
        )}
        {width === 0 && <div style={{ height: COL_H }} />}
        <TooltipBox tip={tip} width={width} />
      </div>
      <Legend items={[{ label: 'Opened', color: SERIES.opened }, { label: 'Completed', color: SERIES.completed }]} />
    </div>
  );
}
