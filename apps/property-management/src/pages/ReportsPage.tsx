import { BarChart3, ChevronRight, Clock, Search, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { REPORT_GROUPS, REPORTS, REPORT_BY_KEY, type ReportDef } from '../components/reports/catalog';
import { REPORT_ICONS } from '../components/reports/bits';
import { forgetRecent, readRecent, type RecentReport } from '../components/reports/data';
import { useListNav } from '../components/list/useListNav';
import { EmptyState, Kbd, Tip } from '../components/primitives/bits';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { timeAgo } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { useWorkspace } from '../lib/workspace';

/**
 * The report catalog: every report grouped the way a property manager looks
 * for it, with what each answers. Search filters as you type (`/`), J/K move,
 * Enter opens. Recently viewed reports come back with the parameters you last
 * used. Financial reports only appear for roles that can see the books.
 */

const PARAM_HINT = (d: ReportDef) =>
  [d.params.owner && 'Owner', d.params.period && 'Period', d.params.asOf && 'As of date', d.params.year && 'Calendar year', d.params.months && 'Months ahead', d.params.basis && 'Cash or accrual']
    .filter(Boolean)
    .join(' · ');

export function ReportsPage() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  useDocumentTitle('Reports');
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<RecentReport[]>(() => readRecent());
  const inputRef = useRef<HTMLInputElement>(null);

  const allowed = useMemo(() => REPORTS.filter(r => !r.financial || ws.can('accounting.view')), [ws]);
  const hiddenFinancial = REPORTS.length - allowed.length;
  const q = query.trim().toLowerCase();
  const matches = (r: ReportDef) => !q || [r.title, r.description, ...r.keywords].some(t => t.toLowerCase().includes(q));
  const groups = REPORT_GROUPS.map(g => ({ ...g, items: allowed.filter(r => r.group === g.key && matches(r)) })).filter(g => g.items.length);
  const recentItems = q ? [] : recent.map(r => ({ r, def: REPORT_BY_KEY.get(r.key) })).filter((x): x is { r: RecentReport; def: ReportDef } => Boolean(x.def && allowed.includes(x.def))).slice(0, 4);
  const flat = groups.flatMap(g => g.items);

  const open = (d: ReportDef, search = '') => navigate(`/reports/${d.key}${search ? `?${search}` : ''}`);
  const nav = useListNav({ items: flat, getId: d => d.key, onOpen: d => open(d) });
  useHotkeys({ '/': () => inputRef.current?.focus() });

  return (
    <>
      <PageHeader icon={<BarChart3 />} title="Reports" />
      <div className="flex min-h-11 items-center gap-2 border-b px-3 py-1.5">
        <label className="flex h-8 w-full max-w-[360px] items-center gap-1.5 rounded-md border bg-background px-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                setQuery('');
                inputRef.current?.blur();
              } else if (e.key === 'Enter' && flat[0]) {
                open(flat[0]);
              } else if (e.key === 'ArrowDown' && flat[0]) {
                e.preventDefault();
                inputRef.current?.blur();
                nav.setFocusedId(flat[0].key);
              }
            }}
            placeholder="Search reports — rent roll, 1099, delinquency…"
            aria-label="Search reports"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
          />
          {query ? (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <Kbd className="hidden sm:inline-flex">/</Kbd>
          )}
        </label>
        <span className="ml-auto hidden text-sm tabular-nums text-muted-foreground sm:inline">
          {flat.length} {flat.length === 1 ? 'report' : 'reports'}
        </span>
      </div>

      <div ref={nav.scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-24">
        {recentItems.length > 0 && (
          <section className="border-b px-3 py-3 sm:px-5" aria-label="Recently viewed">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> Recently viewed
              </h2>
              <button
                type="button"
                onClick={() => {
                  forgetRecent();
                  setRecent([]);
                }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {recentItems.map(({ r, def }) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => open(def, r.search)}
                  className="group flex min-w-0 items-center gap-2.5 rounded-lg border bg-card px-3 py-2 text-left shadow-2xs transition-colors hover:border-foreground/15 hover:bg-accent/40"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-subtle text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">{REPORT_ICONS[def.key]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{def.title}</span>
                    <span className="block truncate text-sm text-muted-foreground">Viewed {timeAgo(r.at)}{r.search ? ' · with your filters' : ''}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {groups.length === 0 ? (
          <EmptyState
            className="py-20"
            icon={<Search />}
            title={`No reports match “${query.trim()}”`}
            description="Try a different word — “rent”, “owner”, “vacancy”, “1099”."
            action={<button type="button" className="ghost-chip h-9 border-border bg-background" onClick={() => setQuery('')}>Clear search</button>}
          />
        ) : (
          <div role="grid" aria-label="Reports">
            {groups.map(g => (
              <section key={g.key} aria-label={g.label}>
                <div className="sticky top-0 z-10 flex h-9 items-center gap-2 border-b bg-subtle/95 px-3 backdrop-blur sm:px-5">
                  <span className="text-[14px] font-medium">{g.label}</span>
                  <span className="text-[13.5px] tabular-nums text-muted-foreground">{g.items.length}</span>
                </div>
                {g.items.map(d => {
                  const focused = nav.focusedId === d.key;
                  return (
                    <div
                      key={d.key}
                      role="row"
                      data-row-id={d.key}
                      onClick={() => open(d)}
                      onMouseMove={() => !focused && nav.setFocusedId(d.key)}
                      className={cn('group/row relative flex min-h-11 cursor-default items-center gap-3 border-b border-border/60 px-3 py-1.5 sm:px-5', focused ? 'bg-accent/80' : 'hover:bg-accent/50')}
                    >
                      {focused && <span className="absolute inset-y-0 left-0 w-[2px] bg-primary/70" aria-hidden />}
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-subtle text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">{REPORT_ICONS[d.key] ?? <BarChart3 />}</span>
                      <a
                        href={`#/reports/${d.key}`}
                        onClick={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          open(d);
                        }}
                        className="min-w-0 flex-1 outline-none"
                      >
                        <span className="block truncate text-[14px] font-medium sm:inline">{d.title}</span>
                        <span className="block truncate text-[13.5px] text-muted-foreground sm:ml-2.5 sm:inline">{d.description}</span>
                      </a>
                      <span className="hidden shrink-0 text-sm text-muted-foreground lg:inline">{PARAM_HINT(d)}</span>
                      <Tip label="Open report" keys={['↵']}>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70 group-hover/row:text-foreground" />
                      </Tip>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        )}
        {hiddenFinancial > 0 && !q && (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            {hiddenFinancial} financial {hiddenFinancial === 1 ? 'report is' : 'reports are'} hidden because your role can’t see the books.
          </p>
        )}
      </div>
    </>
  );
}
