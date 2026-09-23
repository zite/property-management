import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Landmark } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { payVendorBills } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { PAYMENT_METHODS, type PaymentMethod } from '@project/shared/constants';
import { formatMoney, fromCents, toCents } from '@project/shared/money';
import { errorMessage } from '../../lib/errors';
import { dueLabel, plural, shortDate, todayString } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { RowCheckbox } from '../list/GroupedList';
import { AccountPicker, ChoicePicker, FieldButton } from '../pickers/pickers';
import { EmptyState, SkeletonRows } from '../primitives/bits';
import { Money } from '../primitives/data';
import { useBills, type BillRow } from './accountingData';
import { afterPosting } from './ledgerData';
import { bankLabel, Notice } from './parts';

/**
 * Pay open bills. Bills are grouped by vendor — one payment (one check) per
 * vendor, each with its own check number — and any amount can be lowered for
 * a partial payment. Before posting it warns when a property's cash would go
 * below zero, splitting bills across buildings the way the ledger does.
 *
 * `billIds`: null closes; [] opens with nothing preselected.
 */
export function PayBillsDialog({ billIds, onOpenChange }: { billIds: string[] | null; onOpenChange: (open: boolean) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const open = billIds !== null;
  const { data, isPending, isError, error } = useBills({ status: 'open' }, open);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, number | null>>({});
  const [date, setDate] = useState(todayString());
  const [method, setMethod] = useState<PaymentMethod>('Check');
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [memo, setMemo] = useState('');
  const [references, setReferences] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(todayString());
    setMethod('Check');
    setBankAccountId(null);
    setMemo('');
    setReferences({});
    setFormError(null);
    setAmounts({});
    setSelected(new Set());
  }, [open]);

  const bills = data?.bills ?? [];
  // Preselect once the list arrives.
  useEffect(() => {
    if (!open || !data || !billIds?.length) return;
    const pre = bills.filter(b => billIds.includes(b.id));
    setSelected(prev => (prev.size ? prev : new Set(pre.map(b => b.id))));
    setAmounts(prev => (Object.keys(prev).length ? prev : Object.fromEntries(pre.map(b => [b.id, b.open]))));
  }, [open, data]);

  const vendors = useMemo(() => {
    const m = new Map<string, { vendorId: string; name: string; bills: BillRow[] }>();
    for (const b of bills) {
      const key = b.vendorId ?? '';
      if (!m.has(key)) m.set(key, { vendorId: key, name: b.vendorName ?? 'No vendor', bills: [] });
      m.get(key)!.bills.push(b);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [bills]);

  const chosen = bills.filter(b => selected.has(b.id));
  const total = fromCents(chosen.reduce((s, b) => s + toCents(amounts[b.id] ?? 0), 0));
  const vendorCount = new Set(chosen.map(b => b.vendorId ?? '')).size;
  const bank = bankAccountId ? ws.accountById.get(bankAccountId) : null;

  // Cash each property would have left, splitting multi-building bills by their payable share.
  const shortfalls = useMemo(() => {
    const out = new Map<string, number>();
    for (const b of chosen) {
      const pay = toCents(amounts[b.id] ?? 0);
      const shares = b.shares.length ? b.shares : [{ propertyId: b.propertyId ?? '', amount: b.amount }];
      const whole = shares.reduce((s, x) => s + toCents(x.amount), 0) || 1;
      let left = pay;
      shares.forEach((sh, i) => {
        const part = i === shares.length - 1 ? left : Math.round((pay * toCents(sh.amount)) / whole);
        left -= part;
        out.set(sh.propertyId, (out.get(sh.propertyId) ?? 0) + part);
      });
    }
    return [...out.entries()]
      .map(([propertyId, cents]) => ({ propertyId, after: fromCents(toCents(data?.cashByProperty[propertyId] ?? 0) - cents) }))
      .filter(x => x.after < -0.004);
  }, [chosen, amounts, data]);

  const setBill = (b: BillRow, on: boolean) => {
    setSelected(prev => { const n = new Set(prev); if (on) n.add(b.id); else n.delete(b.id); return n; });
    setAmounts(a => ({ ...a, [b.id]: on ? a[b.id] ?? b.open : null }));
  };
  const setVendor = (v: { bills: BillRow[] }, on: boolean) => v.bills.forEach(b => setBill(b, on));

  const submit = async () => {
    setFormError(null);
    if (!chosen.length) return setFormError('Choose at least one bill to pay.');
    const blank = chosen.find(b => !(toCents(amounts[b.id] ?? 0) > 0));
    if (blank) return setFormError(`Enter an amount for bill #${blank.number}, or uncheck it.`);
    const over = chosen.find(b => toCents(amounts[b.id] ?? 0) > toCents(b.open));
    if (over) return setFormError(`Bill #${over.number} only has ${ws.money(over.open)} left to pay.`);
    setPending(true);
    try {
      const refs = Object.fromEntries(Object.entries(references).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
      const res = await payVendorBills({ date, paymentMethod: method, bankAccountId: bankAccountId ?? undefined, memo: memo.trim() || undefined, references: refs, items: chosen.map(b => ({ billId: b.id, amount: amounts[b.id]! })) });
      afterPosting(qc);
      if (res.failed.length) {
        toast.error(`${plural(res.failed.length, 'vendor')} wasn’t paid`, { description: res.failed.map(f => `${f.vendorName}: ${f.message}`).join(' ') });
      }
      if (res.payments.length) {
        toast.success(res.payments.length === 1 ? `Paid ${res.payments[0].vendorName} ${ws.money(res.total)}` : `Paid ${plural(res.payments.length, 'vendor')} ${ws.money(res.total)}`, {
          description: res.payments.length === 1 ? `Payment #${res.payments[0].number}` : res.payments.map(p => `#${p.number} ${p.vendorName}`).slice(0, 3).join(' · '),
          action: { label: 'View payments', onClick: () => navigate('/accounting/payables?view=payments') },
        });
      }
      if (!res.failed.length) onOpenChange(false);
      else setSelected(prev => new Set([...prev].filter(id => res.failed.some(f => (bills.find(b => b.id === id)?.vendorId ?? null) === f.vendorId))));
    } catch (e) {
      setFormError(errorMessage(e, 'Couldn’t pay those bills'));
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Pay bills"
      description="One payment per vendor. Lower an amount to pay part of a bill."
      onSubmit={submit}
      pending={pending}
      disabled={!chosen.length}
      submitLabel={chosen.length ? `Pay ${formatMoney(total, ws.settings.currency)}` : 'Pay bills'}
      size="xl"
      footerStart={chosen.length ? `${plural(chosen.length, 'bill')} · ${plural(vendorCount, 'payment')}` : null}
    >
      <div className="space-y-4">
        <FieldRow cols={3}>
          <Field label="Payment date">
            <DateInput value={date} onChange={v => v && setDate(v)} />
          </Field>
          <Field label="Method">
            <ChoicePicker options={PAYMENT_METHODS} value={method} onChange={v => setMethod(v as PaymentMethod)} trigger={<FieldButton>{method}</FieldButton>} />
          </Field>
          <Field label="Pay from" hint={bank ? undefined : 'Each property’s own account'}>
            <AccountPicker kind="bank" value={bankAccountId} onChange={setBankAccountId} trigger={<FieldButton icon={<Landmark className="h-3.5 w-3.5 text-muted-foreground" />} placeholder="Property’s bank account" onClear={bankAccountId ? () => setBankAccountId(null) : undefined}>{bank ? bankLabel(bank) : null}</FieldButton>} />
          </Field>
        </FieldRow>

        {shortfalls.length > 0 && (
          <Notice tone="warning">
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tone-warning" />
              <span>
                {shortfalls.map((s, i) => (
                  <span key={s.propertyId}>{i > 0 && '; '}{ws.propertyName(s.propertyId) || 'Unassigned'} would have <Money value={s.after} className="font-medium text-tone-danger" /> in cash</span>
                ))}
                . Paying now spends other owners’ money — ask for an owner contribution first.
              </span>
            </span>
          </Notice>
        )}

        <div className="overflow-hidden rounded-lg border">
          {isPending ? (
            <SkeletonRows rows={6} />
          ) : isError ? (
            <EmptyState className="py-10" title="Open bills didn’t load" description={errorMessage(error, 'Try again in a moment.')} />
          ) : !vendors.length ? (
            <EmptyState className="py-10" title="Nothing to pay" description="Every bill is paid." />
          ) : (
            <div className="max-h-[46vh] overflow-y-auto">
              {vendors.map(v => {
                const onCount = v.bills.filter(b => selected.has(b.id)).length;
                const all = onCount === v.bills.length;
                const vendorTotal = fromCents(v.bills.filter(b => selected.has(b.id)).reduce((s, b) => s + toCents(amounts[b.id] ?? 0), 0));
                return (
                  <section key={v.vendorId} aria-label={v.name}>
                    <div className="group/row sticky top-0 z-10 flex min-h-9 flex-wrap items-center gap-2 border-b bg-subtle/95 px-3 py-1 backdrop-blur">
                      <RowCheckbox selected={all} selecting onToggle={() => setVendor(v, !all)} />
                      <span className="min-w-0 truncate text-[14px] font-medium">{v.name}</span>
                      <span className="text-sm tabular-nums text-muted-foreground">{onCount ? `${onCount} of ${v.bills.length}` : v.bills.length}</span>
                      <span className="ml-auto flex items-center gap-2">
                        {onCount > 0 && (
                          <input
                            value={references[v.vendorId] ?? ''}
                            onChange={e => setReferences(r => ({ ...r, [v.vendorId]: e.target.value }))}
                            placeholder={method === 'Check' ? 'Check #' : 'Reference'}
                            aria-label={`${method === 'Check' ? 'Check number' : 'Reference'} for ${v.name}`}
                            maxLength={80}
                            className="field h-8 w-28 text-sm"
                          />
                        )}
                        {onCount > 0 && <Money value={vendorTotal} className="w-24 text-right text-[14px] font-medium" />}
                      </span>
                    </div>
                    {v.bills.map(b => {
                      const on = selected.has(b.id);
                      const due = dueLabel(b.dueDate);
                      return (
                        <div key={b.id} className={cn('group/row flex min-h-10 items-center gap-2 border-b px-3 py-1 pl-6 last:border-b-0', on && 'bg-primary/[0.04]')}>
                          <RowCheckbox selected={on} selecting onToggle={() => setBill(b, !on)} />
                          <button type="button" onClick={() => setBill(b, !on)} className="min-w-0 flex-1 text-left leading-tight">
                            <span className="block truncate text-[14px]">#{b.number} · {b.description}</span>
                            <span className="block truncate text-sm text-muted-foreground">
                              {b.propertyCount > 1 ? `${b.propertyCount} properties` : ws.propertyName(b.propertyId)}
                              {b.reference ? ` · ${b.reference}` : ''}
                              {b.dueDate ? <span className={cn(due?.tone === 'overdue' && 'text-tone-danger')}> · due {shortDate(b.dueDate)}</span> : null}
                              {b.paid > 0 ? ` · ${ws.money(b.open)} of ${ws.money(b.amount)} left` : ''}
                            </span>
                          </button>
                          {on ? (
                            <MoneyInput value={amounts[b.id]} onChange={n => setAmounts(a => ({ ...a, [b.id]: n }))} className="w-28 shrink-0" invalid={toCents(amounts[b.id] ?? 0) > toCents(b.open) || !(toCents(amounts[b.id] ?? 0) > 0)} />
                          ) : (
                            <Money value={b.open} className="w-28 shrink-0 pr-2.5 text-right text-muted-foreground" />
                          )}
                        </div>
                      );
                    })}
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <Field label="Memo" optional>
          <TextInput value={memo} onChange={e => setMemo(e.target.value)} placeholder="Printed on the payment, e.g. August invoices" maxLength={250} />
        </Field>
        {formError && <p role="alert" className="text-[14px] text-tone-danger">{formError}</p>}
      </div>
    </FormDialog>
  );
}
