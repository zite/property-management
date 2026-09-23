import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Building2, CheckCircle2, Landmark } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { postOwnerFunds, runManagementFees } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { PAYMENT_METHODS, type PaymentMethod } from '@project/shared/constants';
import { formatMoney, fromCents, toCents } from '@project/shared/money';
import { errorMessage } from '../../lib/errors';
import { plural, todayString } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, Segmented, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { RowCheckbox } from '../list/GroupedList';
import { AccountPicker, ChoicePicker, FieldButton } from '../pickers/pickers';
import { OptionPicker } from '../pickers/OptionPicker';
import { EmptyState, SkeletonRows } from '../primitives/bits';
import { Money } from '../primitives/data';
import { PropertySwatch } from '../primitives/glyphs';
import { useFeePreview, useOwnerFunds, type OwnerFundsRow } from './accountingData';
import { afterPosting } from './ledgerData';
import { bankLabel, Notice } from './parts';

export type OwnerMoneyTarget = { direction: 'distribution' | 'contribution'; propertyId?: string | null };

/** Record one owner contribution or distribution for a property. */
export function OwnerMoneyDialog({ target, onOpenChange }: { target: OwnerMoneyTarget | null; onOpenChange: (o: boolean) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const open = target !== null;
  const { data } = useOwnerFunds(open);
  const [direction, setDirection] = useState<'distribution' | 'contribution'>('distribution');
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayString());
  const [method, setMethod] = useState<PaymentMethod>('ACH');
  const [reference, setReference] = useState('');
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<{ property?: string; amount?: string; form?: string }>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDirection(target?.direction ?? 'distribution');
    setPropertyId(target?.propertyId ?? null);
    setAmount(null);
    setDate(todayString());
    setReference('');
    setBankAccountId(null);
    setDescription('');
    setErrors({});
  }, [open]);

  const row = data?.properties.find(p => p.propertyId === propertyId);
  const owner = row?.ownerId ? ws.ownerById.get(row.ownerId) : undefined;
  useEffect(() => {
    if (owner) setMethod((PAYMENT_METHODS as readonly string[]).includes(owner.distributionMethod) ? (owner.distributionMethod as PaymentMethod) : 'ACH');
  }, [owner?.id]);
  const property = propertyId ? ws.propertyById.get(propertyId) : undefined;
  const bank = bankAccountId ? ws.accountById.get(bankAccountId) : property?.bankAccountId ? ws.accountById.get(property.bankAccountId) : ws.accountByKey.get('operating_bank');
  const overAvailable = direction === 'distribution' && row && amount != null && amount > row.available + 0.004;
  const overCash = direction === 'distribution' && row && amount != null && amount > row.cash + 0.004;

  const properties = useMemo(() => (data?.properties ?? []).map(p => ({ value: p.propertyId, label: p.name, icon: <PropertySwatch color={ws.propertyById.get(p.propertyId)?.color} />, hint: p.ownerId ? ws.ownerById.get(p.ownerId)?.name : 'No owner', group: p.ownerId ? ws.ownerById.get(p.ownerId)?.name ?? 'Owner' : 'No owner' })), [data, ws]);

  const submit = async () => {
    const next: typeof errors = {};
    if (!propertyId) next.property = 'Choose the property.';
    else if (!row?.ownerId) next.property = 'This property has no owner yet.';
    if (!amount || amount <= 0) next.amount = 'Enter the amount.';
    else if (overCash) next.amount = `Only ${ws.money(row!.cash)} is in cash for this property.`;
    setErrors(next);
    if (Object.keys(next).length) return;
    setPending(true);
    try {
      await postOwnerFunds({ action: direction, propertyId: propertyId!, amount: amount!, date, paymentMethod: method, reference: reference.trim() || undefined, bankAccountId: bankAccountId ?? undefined, description: description.trim() || undefined });
      afterPosting(qc);
      toast.success(direction === 'distribution' ? `Distributed ${ws.money(amount!)} to ${owner?.name ?? 'the owner'}` : `Recorded ${ws.money(amount!)} from ${owner?.name ?? 'the owner'}`, { description: property?.name });
      onOpenChange(false);
    } catch (e) {
      setErrors({ form: errorMessage(e, 'Couldn’t record that') });
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={direction === 'distribution' ? 'Owner distribution' : 'Owner contribution'} description={direction === 'distribution' ? 'Pay an owner from their property’s cash.' : 'Record money an owner sent in — to cover a repair or top up a reserve.'} onSubmit={submit} pending={pending} submitLabel={direction === 'distribution' ? 'Record distribution' : 'Record contribution'}>
      <div className="space-y-4">
        <Segmented value={direction} onChange={v => setDirection(v as 'distribution' | 'contribution')} options={[{ value: 'distribution', label: 'Distribution' }, { value: 'contribution', label: 'Contribution' }]} />
        <Field label="Property" error={errors.property} hint={owner ? `Owner: ${owner.name}` : undefined}>
          <OptionPicker options={properties} value={propertyId} onChange={v => setPropertyId(v)} width={320} trigger={<FieldButton invalid={Boolean(errors.property)} placeholder="Choose a property" icon={property ? <PropertySwatch color={property.color} /> : <Building2 className="h-3.5 w-3.5 text-muted-foreground" />}>{property?.name}</FieldButton>} />
        </Field>
        {row && (
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border bg-border text-[14px]">
            <div className="bg-subtle/60 px-3 py-2"><div className="text-sm text-muted-foreground">Cash</div><Money value={row.cash} className="font-medium" /></div>
            <div className="bg-subtle/60 px-3 py-2"><div className="text-sm text-muted-foreground">Held back</div><Money value={row.depositsHeld + row.reserve + row.unpaidBills} /></div>
            <div className="bg-subtle/60 px-3 py-2"><div className="text-sm text-muted-foreground">Available</div><Money value={row.available} className={cn('font-medium', row.available < 0 && 'text-tone-danger')} /></div>
          </div>
        )}
        <FieldRow>
          <Field label="Amount" error={errors.amount} hint={overAvailable && !overCash ? <span className="text-tone-warning">More than available — it dips into deposits, reserve or unpaid bills.</span> : undefined}>
            <MoneyInput value={amount} onChange={setAmount} invalid={Boolean(errors.amount)} />
          </Field>
          <Field label="Date">
            <DateInput value={date} onChange={v => v && setDate(v)} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Method">
            <ChoicePicker options={PAYMENT_METHODS} value={method} onChange={v => setMethod(v as PaymentMethod)} trigger={<FieldButton>{method}</FieldButton>} />
          </Field>
          <Field label={method === 'Check' ? 'Check #' : 'Reference'} optional>
            <TextInput value={reference} onChange={e => setReference(e.target.value)} maxLength={80} />
          </Field>
        </FieldRow>
        <Field label={direction === 'distribution' ? 'Paid from' : 'Deposited to'}>
          <AccountPicker kind="bank" value={bank?.id ?? null} onChange={setBankAccountId} trigger={<FieldButton icon={<Landmark className="h-3.5 w-3.5 text-muted-foreground" />}>{bankLabel(bank)}</FieldButton>} />
        </Field>
        <Field label="Memo" optional>
          <TextInput value={description} onChange={e => setDescription(e.target.value)} placeholder={direction === 'distribution' ? 'e.g. September distribution' : 'e.g. Roof repair funding'} maxLength={250} />
        </Field>
        {errors.form && <p role="alert" className="text-[14px] text-tone-danger">{errors.form}</p>}
      </div>
    </FormDialog>
  );
}

/** Distribute to many properties at once: each property's available cash is suggested and can be edited. */
export function DistributionRunDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useOwnerFunds(open);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, number | null>>({});
  const [date, setDate] = useState(todayString());
  const [method, setMethod] = useState<PaymentMethod>('ACH');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(todayString());
    setMethod('ACH');
    setDescription(`${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} owner distribution`);
    setFormError(null);
    setSeeded(false);
    setSelected(new Set());
    setAmounts({});
  }, [open]);

  const suggested = (p: { available: number }) => Math.max(0, Math.floor(p.available * 100) / 100);
  useEffect(() => {
    if (!open || !data || seeded) return;
    const ready = data.properties.filter(p => p.ownerId && p.available > 0.004);
    setSelected(new Set(ready.map(p => p.propertyId)));
    setAmounts(Object.fromEntries(ready.map(p => [p.propertyId, suggested(p)])));
    setSeeded(true);
  }, [open, data, seeded]);

  const toggle = (p: { propertyId: string; available: number }, on: boolean) => {
    setSelected(prev => { const n = new Set(prev); if (on) n.add(p.propertyId); else n.delete(p.propertyId); return n; });
    if (on) setAmounts(a => ({ ...a, [p.propertyId]: a[p.propertyId] ?? (suggested(p) || null) }));
  };

  const rows = useMemo(() => (data?.properties ?? []).filter(p => p.ownerId).sort((a, b) => (ws.ownerById.get(a.ownerId!)?.name ?? '').localeCompare(ws.ownerById.get(b.ownerId!)?.name ?? '') || a.name.localeCompare(b.name)), [data, ws]);
  const chosen = rows.filter(r => selected.has(r.propertyId));
  const total = fromCents(chosen.reduce((s, r) => s + toCents(amounts[r.propertyId] ?? 0), 0));
  const overCash = chosen.filter(r => (amounts[r.propertyId] ?? 0) > r.cash + 0.004);

  const submit = async () => {
    setFormError(null);
    if (!chosen.length) return setFormError('Choose at least one property to distribute from.');
    const blank = chosen.find(r => !(toCents(amounts[r.propertyId] ?? 0) > 0));
    if (blank) return setFormError(`Enter an amount for ${blank.name}, or uncheck it.`);
    if (overCash.length) return setFormError(`${overCash[0].name} only has ${ws.money(overCash[0].cash)} in cash.`);
    setPending(true);
    try {
      const res = await postOwnerFunds({ action: 'run', date, paymentMethod: method, description: description.trim() || undefined, items: chosen.map(r => ({ propertyId: r.propertyId, amount: amounts[r.propertyId]! })) });
      afterPosting(qc);
      if (res.failed.length) toast.error(`${plural(res.failed.length, 'distribution')} didn’t post`, { description: res.failed.map(f => `${f.name}: ${f.message}`).join(' ') });
      if (res.posted.length) toast.success(`Distributed ${ws.money(res.total)} across ${plural(res.posted.length, 'property', 'properties')}`);
      if (!res.failed.length) onOpenChange(false);
    } catch (e) {
      setFormError(errorMessage(e, 'Couldn’t run the distributions'));
    } finally {
      setPending(false);
    }
  };

  let lastOwner = '';
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Distribution run"
      description="Pays owners what each property has available after deposits, reserves and unpaid bills. Adjust any amount before confirming."
      onSubmit={submit}
      pending={pending}
      disabled={!chosen.length}
      submitLabel={chosen.length ? `Distribute ${formatMoney(total, ws.settings.currency)}` : 'Distribute'}
      size="xl"
      footerStart={chosen.length ? `${plural(chosen.length, 'property', 'properties')} · ${plural(new Set(chosen.map(r => r.ownerId)).size, 'owner')}` : null}
    >
      <div className="space-y-4">
        <FieldRow cols={3}>
          <Field label="Date"><DateInput value={date} onChange={v => v && setDate(v)} /></Field>
          <Field label="Method"><ChoicePicker options={PAYMENT_METHODS} value={method} onChange={v => setMethod(v as PaymentMethod)} trigger={<FieldButton>{method}</FieldButton>} /></Field>
          <Field label="Memo"><TextInput value={description} onChange={e => setDescription(e.target.value)} maxLength={250} /></Field>
        </FieldRow>
        {data && data.warnings.length > 0 && <Notice tone="warning"><AlertTriangle className="mr-1.5 inline h-3.5 w-3.5 text-tone-warning" />{data.warnings[0]}</Notice>}
        <div className="overflow-x-auto rounded-lg border">
          {isPending ? (
            <SkeletonRows rows={6} />
          ) : isError ? (
            <EmptyState className="py-10" title="Owner funds didn’t load" description={errorMessage(error, 'Try again in a moment.')} />
          ) : !rows.length ? (
            <EmptyState className="py-10" title="No properties with owners" description="Assign owners to properties to distribute to them." />
          ) : (
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[14px]">
              <thead>
                <tr className="text-sm text-muted-foreground">
                  <th className="h-9 w-9 border-b bg-subtle/80 pl-3" />
                  <th className="h-9 border-b bg-subtle/80 px-3 text-left font-medium">Property</th>
                  <th className="h-9 border-b bg-subtle/80 px-3 text-right font-medium">Cash</th>
                  <th className="h-9 border-b bg-subtle/80 px-3 text-right font-medium">Held back</th>
                  <th className="h-9 border-b bg-subtle/80 px-3 text-right font-medium">Available</th>
                  <th className="h-9 w-36 border-b bg-subtle/80 px-3 text-right font-medium">Distribute</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const ownerName = ws.ownerById.get(r.ownerId!)?.name ?? 'Owner';
                  const showOwner = ownerName !== lastOwner;
                  lastOwner = ownerName;
                  const on = selected.has(r.propertyId);
                  const v = amounts[r.propertyId] ?? null;
                  return [
                    showOwner && (
                      <tr key={`o-${r.propertyId}`}>
                        <td colSpan={6} className="h-9 border-b bg-subtle/40 px-3 text-sm font-medium text-muted-foreground">{ownerName}</td>
                      </tr>
                    ),
                    <tr key={r.propertyId} className={cn('group/row', on && 'bg-primary/[0.04]')}>
                      <td className="h-10 border-b border-border/60 pl-3"><RowCheckbox selected={on} selecting onToggle={() => toggle(r, !on)} /></td>
                      <td className="h-10 border-b border-border/60 px-3"><span className="inline-flex items-center gap-1.5"><PropertySwatch color={ws.propertyById.get(r.propertyId)?.color} />{r.name}</span></td>
                      <td className="num h-10 border-b border-border/60 px-3 text-right"><Money value={r.cash} /></td>
                      <td className="num h-10 border-b border-border/60 px-3 text-right text-muted-foreground"><Money value={r.depositsHeld + r.reserve + r.unpaidBills} /></td>
                      <td className="num h-10 border-b border-border/60 px-3 text-right"><Money value={r.available} className={cn(r.available <= 0 && 'text-muted-foreground', r.available < 0 && 'text-tone-danger')} /></td>
                      <td className="h-10 border-b border-border/60 px-2">{on ? <MoneyInput value={v} onChange={n => setAmounts(a => ({ ...a, [r.propertyId]: n }))} invalid={v == null || v <= 0 || v > r.cash + 0.004} /> : <span className="block pr-2 text-right text-sm text-muted-foreground">{r.available > 0.004 ? 'Skipped' : 'Nothing available'}</span>}</td>
                    </tr>,
                  ];
                })}
              </tbody>
            </table>
          )}
        </div>
        {chosen.some(r => (amounts[r.propertyId] ?? 0) > r.available + 0.004) && !overCash.length && <Notice tone="warning">Some amounts are above what’s available and will dip into deposits, reserves or money owed to vendors.</Notice>}
        {formError && <p role="alert" className="text-[14px] text-tone-danger">{formError}</p>}
      </div>
    </FormDialog>
  );
}

function monthOptions(today: string) {
  const [y, m] = today.split('-').map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 2 - i, 1));
    const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return { value, label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
  });
}

/** Management fees for a closed month: preview collected rent × rate per property, then post what isn't posted yet. */
export function ManagementFeesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const months = useMemo(() => monthOptions(ws.today), [ws.today]);
  const [period, setPeriod] = useState(months[0].value);
  const [date, setDate] = useState(todayString());
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { data, isPending, isError, error, isFetching } = useFeePreview(period, open);

  useEffect(() => {
    if (!open) return;
    setPeriod(months[0].value);
    setDate(todayString());
    setFormError(null);
  }, [open]);

  const rows = data?.rows ?? [];
  const [py, pm] = period.split('-').map(Number);
  const firstAfter = pm === 12 ? `${py + 1}-01-01` : `${py}-${String(pm + 1).padStart(2, '0')}-01`;
  const due = rows.filter(r => !r.posted && r.fee > 0.004);
  const dueTotal = fromCents(due.reduce((s, r) => s + toCents(r.fee), 0));

  const submit = async () => {
    setFormError(null);
    if (!due.length) return setFormError('Every fee for this month is already posted.');
    if (date < firstAfter) return setFormError('Date the fees after the month they’re for.');
    setPending(true);
    try {
      const res = await runManagementFees({ action: 'post', period, date });
      afterPosting(qc);
      void qc.invalidateQueries({ queryKey: ['accounting', 'fees'] });
      if (res.posted.length) toast.success(`Posted ${plural(res.posted.length, 'management fee')} for ${res.label}`, { description: `${ws.money(res.total ?? 0)}${res.skipped ? ` · ${plural(res.skipped, 'property', 'properties')} already posted` : ''}` });
      else toast.success(`Nothing new to post for ${res.label}`, { description: 'Those fees were already posted.' });
      onOpenChange(false);
    } catch (e) {
      setFormError(errorMessage(e, 'Couldn’t post the fees'));
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Management fees"
      description="Rent collected in the month × each property’s fee rate. Fees already posted for the month are skipped, so running this twice never charges twice."
      onSubmit={submit}
      pending={pending}
      disabled={!due.length || isFetching}
      submitLabel={due.length ? `Post ${plural(due.length, 'fee')} · ${formatMoney(dueTotal, ws.settings.currency)}` : 'Nothing to post'}
      size="lg"
    >
      <div className="space-y-4">
        <FieldRow>
          <Field label="Month">
            <OptionPicker options={months} value={period} onChange={v => v && setPeriod(v)} trigger={<FieldButton>{months.find(m => m.value === period)?.label}</FieldButton>} />
          </Field>
          <Field label="Posting date">
            <DateInput value={date} onChange={v => v && setDate(v)} min={firstAfter} invalid={date < firstAfter} />
          </Field>
        </FieldRow>
        <div className="overflow-x-auto rounded-lg border">
          {isPending ? (
            <SkeletonRows rows={6} />
          ) : isError ? (
            <EmptyState className="py-10" title="The preview didn’t load" description={errorMessage(error, 'Try again in a moment.')} />
          ) : !rows.length ? (
            <EmptyState className="py-10" title="No properties" description="Add properties to charge management fees." />
          ) : (
            <table className="w-full min-w-[560px] border-separate border-spacing-0 text-[14px]">
              <thead>
                <tr className="text-sm text-muted-foreground">
                  <th className="h-9 border-b bg-subtle/80 px-3 text-left font-medium">Property</th>
                  <th className="h-9 border-b bg-subtle/80 px-3 text-right font-medium">Rent collected</th>
                  <th className="h-9 border-b bg-subtle/80 px-3 text-right font-medium">Rate</th>
                  <th className="h-9 border-b bg-subtle/80 px-3 text-right font-medium">Fee</th>
                  <th className="h-9 w-40 border-b bg-subtle/80 px-3 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.propertyId} className={cn(r.posted && 'text-muted-foreground')}>
                    <td className="h-10 border-b border-border/60 px-3"><span className="inline-flex items-center gap-1.5"><PropertySwatch color={ws.propertyById.get(r.propertyId)?.color} />{r.name}</span></td>
                    <td className="num h-10 border-b border-border/60 px-3 text-right"><Money value={r.collected} muted0 /></td>
                    <td className="num h-10 border-b border-border/60 px-3 text-right">{r.percent}%</td>
                    <td className="num h-10 border-b border-border/60 px-3 text-right font-medium"><Money value={r.posted ? r.posted.amount : r.fee} muted0 /></td>
                    <td className="h-10 border-b border-border/60 px-3 text-sm">
                      {r.posted ? <span className="inline-flex items-center gap-1 text-tone-success"><CheckCircle2 className="h-3.5 w-3.5" /> Posted #{r.posted.number}</span> : r.fee > 0.004 ? <span className="text-foreground">Will post</span> : 'Nothing collected'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-medium">
                  <td className="h-9 bg-subtle/60 px-3">Total</td>
                  <td className="num h-9 bg-subtle/60 px-3 text-right"><Money value={fromCents(rows.reduce((s, r) => s + toCents(r.collected), 0))} /></td>
                  <td className="h-9 bg-subtle/60" />
                  <td className="num h-9 bg-subtle/60 px-3 text-right"><Money value={fromCents(rows.reduce((s, r) => s + toCents(r.posted ? r.posted.amount : r.fee), 0))} /></td>
                  <td className="h-9 bg-subtle/60 px-3 text-sm text-muted-foreground">{due.length ? `${due.length} to post` : 'All posted'}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
        {formError && <p role="alert" className="text-[14px] text-tone-danger">{formError}</p>}
      </div>
    </FormDialog>
  );
}

export type { OwnerFundsRow };
