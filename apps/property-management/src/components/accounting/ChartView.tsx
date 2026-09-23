import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, CheckCircle2, Download, Landmark, Lock, Pencil, Plus, Power } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { saveAccount } from 'zitejs/api';
import { DropdownMenuItem } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import type { AccountSubtype, AccountType } from '@project/shared/constants';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { shortDate } from '../../lib/format';
import { useCollapsedGroups } from '../../lib/listState';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { GroupedList, RowShell, type ListGroup } from '../list/GroupedList';
import { ListToolbar } from '../list/Toolbar';
import { useListNav } from '../list/useListNav';
import { EmptyState, SkeletonRows, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { Pill } from '../primitives/glyphs';
import { useDocumentTitle } from '../shell/PageHeader';
import { useChart, type ChartAccount } from './accountingData';
import { AccountDialog } from './AccountDialog';
import { AccountingHeader, HeaderButton, menuItem, RowMenu } from './parts';

const TYPE_ORDER: AccountType[] = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'];
const TYPE_LABEL: Record<AccountType, string> = { Asset: 'Assets', Liability: 'Liabilities', Equity: 'Equity', Income: 'Income', Expense: 'Expenses' };
const TYPE_START: Record<AccountType, number> = { Asset: 1000, Liability: 2000, Equity: 3000, Income: 4000, Expense: 5000 };

/**
 * The chart of accounts, grouped by type, each account with its balance from
 * the journal. Open an account for its register; system accounts are marked
 * and can be renamed but not retyped or switched off.
 */
export function ChartView() {
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const navigate = useNavigate();
  useDocumentTitle('Chart of accounts');
  const { data, isPending, isError, error, refetch, isFetching } = useChart();
  const [editing, setEditing] = useState<ChartAccount | null | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [collapsed, toggleCollapsed] = useCollapsedGroups('accounting:chart');
  const canEdit = ws.can('banking.manage');

  const accounts = data?.accounts ?? [];
  const groups: ListGroup<ChartAccount>[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    return TYPE_ORDER.map(type => {
      const items = accounts
        .filter(a => a.accountType === type && (showInactive || a.active) && (!q || `${a.number} ${a.name} ${a.subtype} ${a.description}`.toLowerCase().includes(q)))
        .sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }));
      const total = Math.round(items.reduce((s, a) => s + Math.round(a.balance * 100), 0)) / 100;
      return { key: type, label: TYPE_LABEL[type], items, hint: <Money value={total} /> };
    }).filter(g => g.items.length);
  }, [accounts, search, showInactive]);
  const visible = useMemo(() => groups.flatMap(g => (collapsed.has(g.key) ? [] : g.items)), [groups, collapsed]);
  const open = useCallback((a: ChartAccount) => navigate(`/accounting/${a.subtype === 'Bank' ? 'banking' : 'chart'}/${a.id}`), [navigate]);
  const nav = useListNav({ items: visible, getId: a => a.id, onOpen: open, enabled: editing === undefined });
  const inactiveCount = accounts.filter(a => !a.active).length;

  const suggestNumber = (type: AccountType) => {
    const used = new Set(accounts.map(a => a.number));
    const top = accounts.filter(a => a.accountType === type).map(a => Number(a.number)).filter(Number.isFinite);
    let n = top.length ? Math.floor(Math.max(...top) / 10) * 10 + 10 : TYPE_START[type];
    while (used.has(String(n))) n += 10;
    return String(n);
  };

  const setActive = async (a: ChartAccount, active: boolean) => {
    if (!active && !(await app.confirm({ title: `Deactivate ${a.number} ${a.name}?`, description: 'It keeps its history, but nothing new can be posted to it. You can reactivate it any time.', confirmLabel: 'Deactivate', destructive: true }))) return;
    try {
      await saveAccount({ id: a.id, number: a.number, name: a.name, accountType: a.accountType as AccountType, subtype: (a.subtype || 'Other asset') as AccountSubtype, description: a.description, tenantCharge: a.tenantCharge, billExpense: a.billExpense, bankName: a.bankName, accountLast4: a.accountLast4, active });
      invalidate(qc, 'bootstrap', 'accounting');
      toast.success(active ? `${a.name} reactivated` : `${a.name} deactivated`);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t change the account'));
    }
  };

  return (
    <>
      <AccountingHeader tab="chart" actions={canEdit && <HeaderButton primary icon={<Plus />} label="New account" onClick={() => setEditing(null)} />} />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ListToolbar
          start={
            <>
              {data && (
                <span className={cn('inline-flex items-center gap-1.5 px-1 text-sm', data.trialBalance.balanced ? 'text-muted-foreground' : 'text-tone-danger')}>
                  {data.trialBalance.balanced ? <CheckCircle2 className="h-3.5 w-3.5 text-tone-success" /> : null}
                  {data.trialBalance.balanced ? 'Books balance' : 'Books out of balance'} · debits <Money value={data.trialBalance.debits} /> · credits <Money value={data.trialBalance.credits} />
                </span>
              )}
              {inactiveCount > 0 && <button type="button" onClick={() => setShowInactive(v => !v)} className={cn('ghost-chip h-8 text-sm', showInactive && 'bg-accent text-foreground')}>{showInactive ? 'Hide' : 'Show'} {inactiveCount} inactive</button>}
            </>
          }
          count={isPending ? null : visible.length}
          countLabel={['account', 'accounts']}
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search number or name…"
          fetching={isFetching && !isPending}
          more={<DropdownMenuItem className={menuItem} disabled={!accounts.length} onSelect={() => downloadCsv('chart-of-accounts', ['Number', 'Name', 'Type', 'Subtype', 'Balance', 'Debits', 'Credits', 'Active', 'System'], accounts.map(a => [a.number, a.name, a.accountType, a.subtype, a.balance, a.debits, a.credits, a.active ? 'Yes' : 'No', a.systemKey ? 'Yes' : '']))}><Download /> Export CSV</DropdownMenuItem>}
        />
        <div ref={nav.scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {isPending ? (
            <SkeletonRows rows={14} className="px-3 pt-2" />
          ) : isError ? (
            <EmptyState className="py-20" title="The chart of accounts didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
          ) : !groups.length ? (
            <EmptyState className="py-20" icon={<BookOpen />} title="Nothing matches" description="No accounts match that search." action={<button type="button" className="ghost-chip h-9" onClick={() => setSearch('')}>Clear search</button>} />
          ) : (
            <GroupedList
              label="Chart of accounts"
              groups={groups}
              getId={a => a.id}
              collapsed={collapsed}
              onToggleCollapse={toggleCollapsed}
              renderRow={a => (
                <RowShell id={a.id} selected={false} focused={nav.focusedId === a.id} selecting={false} onClick={() => open(a)} onHover={() => nav.onHover(a)} onToggleSelect={() => undefined} muted={!a.active} className="[&>button:first-of-type]:invisible">
                  <span className="num w-12 shrink-0 text-[13.5px] text-muted-foreground">{a.number}</span>
                  {a.subtype === 'Bank' && <Landmark className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 truncate font-medium">{a.name}</span>
                  {a.systemKey && <Tip label="Posted to automatically — can be renamed, not retyped or deactivated"><Lock className="h-3 w-3 shrink-0 text-muted-foreground/70" /></Tip>}
                  {!a.active && <Pill tone="neutral">Inactive</Pill>}
                  <span className="min-w-4 flex-1" />
                  <span className="hidden min-w-0 items-center gap-2 md:flex">
                    {a.accountLast4 && <span className="text-sm text-muted-foreground">··{a.accountLast4}</span>}
                    {a.tenantCharge && <span className="chip hidden lg:inline-flex">Resident charges</span>}
                    {a.billExpense && <span className="chip hidden lg:inline-flex">Bills</span>}
                    <span className="chip max-w-[150px]"><span className="truncate">{a.subtype || a.accountType}</span></span>
                    <span className="w-24 text-right text-sm tabular-nums text-muted-foreground">{a.lastDate ? `Last ${shortDate(a.lastDate)}` : 'No activity'}</span>
                  </span>
                  <Money value={a.balance} muted0 className={cn('w-[120px] shrink-0 text-right font-medium', a.balance < 0 && a.subtype === 'Bank' && 'text-tone-danger')} />
                  {canEdit ? (
                    <RowMenu label={`Actions for ${a.name}`} width="w-52">
                      <DropdownMenuItem className={menuItem} onSelect={() => open(a)}><BookOpen /> Open register</DropdownMenuItem>
                      <DropdownMenuItem className={menuItem} onSelect={() => setEditing(a)}><Pencil /> Edit…</DropdownMenuItem>
                      {!a.systemKey && <DropdownMenuItem className={menuItem} onSelect={() => void setActive(a, !a.active)}><Power /> {a.active ? 'Deactivate…' : 'Reactivate'}</DropdownMenuItem>}
                    </RowMenu>
                  ) : <span className="w-6" />}
                </RowShell>
              )}
            />
          )}
        </div>
      </div>
      <AccountDialog account={editing} onOpenChange={o => !o && setEditing(undefined)} suggestedNumber={suggestNumber} />
    </>
  );
}
