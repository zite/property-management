import { useQueryClient } from '@tanstack/react-query';
import { Building2, Receipt, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { postBulkCharges } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { splitEvenly, toCents, fromCents } from '@project/shared/money';
import { errorMessage } from '../../lib/errors';
import { plural, todayString } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, Segmented, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { RowCheckbox } from '../list/GroupedList';
import { AccountPicker, FieldButton, PropertyPicker } from '../pickers/pickers';
import { SkeletonRows } from '../primitives/bits';
import { Money } from '../primitives/data';
import { PropertySwatch } from '../primitives/glyphs';
import { useReceivables } from './accountingData';
import { afterPosting } from './ledgerData';

type Mode = 'each' | 'split';

/**
 * Charge many leases at once — a building's water bill split across its
 * units, a parking fee for everyone. Choose leases (a property selects its
 * current leases), then either the same amount for each or a total split
 * evenly; any single amount can still be edited.
 *
 * `leaseIds`: null closes the dialog; [] opens it with nothing selected.
 */
export function BulkChargeDialog({ leaseIds, onOpenChange }: { leaseIds: string[] | null; onOpenChange: (open: boolean) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const open = leaseIds !== null;
  const { data, isPending } = useReceivables();
  const [selected, setSelected] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<Record<string, number | null>>({});
  const [mode, setMode] = useState<Mode>('each');
  const [amount, setAmount] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayString());
  const [dueDate, setDueDate] = useState<string | null>(todayString());
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [errors, setErrors] = useState<{ leases?: string; account?: string; amount?: string; description?: string; form?: string }>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(leaseIds ?? []);
    setAmounts({});
    setMode('each');
    setAmount(null);
    const utility = ws.accountByKey.get('utility_income');
    setAccountId(utility?.id ?? ws.chargeAccounts[0]?.id ?? null);
    setDescription('');
    setDate(todayString());
    setDueDate(todayString());
    setPropertyId(null);
    setQuery('');
    setErrors({});
  }, [open]);

  // Current residents only: a lease still waiting on signatures isn't living there yet.
  const leases = useMemo(() => (data?.leases ?? []).filter(l => l.status === 'Active' || selected.includes(l.id)), [data, selected]);
  const byId = useMemo(() => new Map(leases.map(l => [l.id, l])), [leases]);
  const visible = leases.filter(l => (!propertyId || l.propertyId === propertyId) && (!query || `${l.tenantNames} ${l.name}`.toLowerCase().includes(query.toLowerCase())));

  // Changing the amount or mode rewrites every row; a row edited by hand keeps its amount as other leases are added.
  const edited = useRef(new Set<string>());
  useEffect(() => {
    edited.current.clear();
  }, [mode, amount, open]);
  useEffect(() => {
    if (!open) return;
    if (mode === 'each') setAmounts(prev => Object.fromEntries(selected.map(id => [id, edited.current.has(id) ? prev[id] ?? null : amount])));
    else {
      const parts = amount && selected.length ? splitEvenly(amount, selected.length) : [];
      setAmounts(Object.fromEntries(selected.map((id, i) => [id, parts[i] ?? null])));
    }
  }, [mode, amount, selected.join(','), open]);

  const toggle = (id: string) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));
  const allVisible = visible.length > 0 && visible.every(l => selected.includes(l.id));
  const total = fromCents(selected.reduce((s, id) => s + toCents(amounts[id] ?? 0), 0));
  const account = accountId ? ws.accountById.get(accountId) : undefined;

  const submit = async () => {
    const next: typeof errors = {};
    if (!selected.length) next.leases = 'Choose the leases to charge.';
    if (!accountId) next.account = 'Choose what the charge is for.';
    if (!description.trim()) next.description = 'Describe the charge — residents see it on their ledger.';
    if (selected.length && selected.some(id => !(amounts[id] && (amounts[id] ?? 0) > 0))) next.amount = mode === 'split' ? 'Enter the total to split.' : 'Enter an amount for every lease.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setPending(true);
    try {
      const res = await postBulkCharges({ accountId: accountId!, description: description.trim(), date, dueDate: dueDate ?? date, items: selected.map(id => ({ leaseId: id, amount: amounts[id]! })) });
      afterPosting(qc);
      if (res.failed.length) {
        toast.error(`${plural(res.failed.length, 'charge')} didn’t post`, { description: `${res.failed.slice(0, 2).map(f => `${f.name}: ${f.message}`).join(' ')}${res.posted ? ` The other ${plural(res.posted, 'charge')} posted.` : ''}` });
        setSelected(res.failed.map(f => f.leaseId));
      } else {
        toast.success(`Charged ${plural(res.posted, 'lease')} ${ws.money(res.total)}`, { description: description.trim() });
        onOpenChange(false);
      }
    } catch (e) {
      setErrors({ form: errorMessage(e, 'Couldn’t post the charges') });
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Post charges"
      description="Bill several residents at once — a utility bill-back, a parking fee, an assessment. Each lease gets its own charge."
      onSubmit={submit}
      pending={pending}
      submitLabel={selected.length ? `Charge ${plural(selected.length, 'lease')}` : 'Post charges'}
      size="xl"
      footerStart={selected.length ? <>Total <Money value={total} className="font-medium text-foreground" /></> : null}
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <Field label="Charge for" error={errors.account}>
            <AccountPicker kind="charge" value={accountId} onChange={id => { setAccountId(id); if (!description.trim()) setDescription(ws.accountById.get(id)?.name ?? ''); }} trigger={<FieldButton invalid={Boolean(errors.account)} icon={<Receipt className="h-3.5 w-3.5 text-muted-foreground" />}>{account?.name}</FieldButton>} />
          </Field>
          <Field label="Description" error={errors.description}>
            <TextInput value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Water & sewer — August 2026" maxLength={250} invalid={Boolean(errors.description)} />
          </Field>
          <Field label="Amount" error={errors.amount} action={<Segmented size="sm" value={mode} onChange={v => setMode(v as Mode)} options={[{ value: 'each', label: 'Each lease' }, { value: 'split', label: 'Split a total' }]} />}>
            <MoneyInput value={amount} onChange={setAmount} invalid={Boolean(errors.amount)} placeholder={mode === 'split' ? 'Total to split evenly' : 'Amount per lease'} />
          </Field>
          <FieldRow>
            <Field label="Charge date">
              <DateInput value={date} onChange={v => v && setDate(v)} />
            </Field>
            <Field label="Due">
              <DateInput value={dueDate} onChange={setDueDate} min={date} />
            </Field>
          </FieldRow>
          {errors.form && <p role="alert" className="text-[14px] text-tone-danger">{errors.form}</p>}
        </div>

        <div className="min-w-0">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[13.5px] font-medium text-foreground/90">Leases</span>
            <span className="text-sm text-muted-foreground">{selected.length ? `${selected.length} selected` : 'None selected'}</span>
          </div>
          <div className={cn('overflow-hidden rounded-lg border', errors.leases && 'border-tone-danger')}>
            <div className="flex items-center gap-2 border-b bg-subtle/60 px-2 py-1.5">
              <PropertyPicker allowNone value={propertyId} onChange={setPropertyId} trigger={<button type="button" className="ghost-chip h-8 max-w-[160px] gap-1.5 text-sm"><Building2 className="h-3.5 w-3.5" /><span className="truncate">{propertyId ? ws.propertyName(propertyId) : 'All properties'}</span></button>} />
              <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border bg-background px-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a resident" className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground" />
              </div>
            </div>
            <label className="group/row flex h-9 cursor-pointer items-center gap-2 border-b px-3 text-sm text-muted-foreground">
              <RowCheckbox selected={allVisible} selecting onToggle={() => setSelected(s => (allVisible ? s.filter(id => !visible.some(l => l.id === id)) : [...new Set([...s, ...visible.map(l => l.id)])]))} />
              {allVisible ? 'Deselect' : 'Select'} {propertyId ? `all at ${ws.propertyName(propertyId)}` : 'all'} ({visible.length})
            </label>
            <div className="max-h-[320px] overflow-y-auto">
              {isPending ? (
                <SkeletonRows rows={5} />
              ) : !visible.length ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">{leases.length ? 'No current leases match.' : 'There are no current leases to charge.'}</p>
              ) : (
                visible.map(l => {
                  const on = selected.includes(l.id);
                  return (
                    <div key={l.id} className={cn('group/row flex min-h-10 items-center gap-2 border-b px-3 py-1 last:border-b-0', on && 'bg-primary/[0.05]')}>
                      <RowCheckbox selected={on} selecting onToggle={() => toggle(l.id)} />
                      <button type="button" onClick={() => toggle(l.id)} className="min-w-0 flex-1 text-left leading-tight">
                        <span className="block truncate text-[14px]">{l.tenantNames || l.name}</span>
                        <span className="flex items-center gap-1 truncate text-sm text-muted-foreground"><PropertySwatch color={ws.propertyById.get(l.propertyId ?? '')?.color} size={6} /> {ws.unitLabel(l.unitId, l.propertyId)}</span>
                      </button>
                      {on && <MoneyInput value={amounts[l.id] ?? null} onChange={v => { edited.current.add(l.id); setAmounts(a => ({ ...a, [l.id]: v })); }} className="w-28 shrink-0" />}
                    </div>
                  );
                })
              )}
            </div>
          </div>
          {errors.leases && <p role="alert" className="mt-1.5 text-sm text-tone-danger">{errors.leases}</p>}
          {selected.some(id => !byId.has(id)) && <p className="mt-1.5 text-sm text-muted-foreground">Some selected leases aren’t current and are hidden here.</p>}
        </div>
      </div>
    </FormDialog>
  );
}
