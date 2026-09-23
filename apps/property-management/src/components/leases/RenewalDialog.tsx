import { useEffect, useMemo, useState } from 'react';
import { addDays as addDayStr, addMonths } from '@project/shared/dates';
import { leaseRef } from '@project/shared/leases';
import { fromCents, toCents } from '@project/shared/money';
import { cn } from '@project/components/lib/utils';
import { addDays, fullDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, NumberInput, Segmented, SwitchRow } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { Money } from '../primitives/data';
import { useLeaseLifecycle } from './data';

export type RenewalTarget = { id: string; number: number | null; unitId: string | null; propertyId: string | null; rent: number; endDate: string | null; leaseType: string; status: string; moveOutDate: string | null };

type Mode = 'percent' | 'amount' | 'set';

/** The day after the current term, where a renewal starts — the same rule the engine uses when it's accepted. */
export function renewalTerm(endDate: string | null, today: string, months: number) {
  const start = addDayStr(endDate ?? today, 1);
  return { start, end: addDayStr(addMonths(start, months), -1) };
}

/**
 * Offer renewals to one lease or many: a percentage or dollar increase (or,
 * for one lease, the exact rent), a term, and how long the offer stays open.
 * Each resident gets the Renewal offer email and can accept in the portal.
 */
export function RenewalDialog({ open, onOpenChange, leases, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; leases: RenewalTarget[]; onDone?: () => void }) {
  const ws = useWorkspace();
  const { run, pending } = useLeaseLifecycle();
  const single = leases.length === 1 ? leases[0] : null;
  const [mode, setMode] = useState<Mode>('percent');
  const [percent, setPercent] = useState<number | null>(3);
  const [amount, setAmount] = useState<number | null>(50);
  const [rent, setRent] = useState<number | null>(null);
  const [months, setMonths] = useState<number | null>(12);
  const [expiresOn, setExpiresOn] = useState<string | null>(addDays(14));
  const [roundDollars, setRoundDollars] = useState(true);
  const [send, setSend] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const template = ws.templates.find(t => t.trigger === 'Renewal offer');

  useEffect(() => {
    if (!open) return;
    setMode(single ? 'set' : 'percent');
    setPercent(3);
    setAmount(50);
    setRent(single ? Math.round(single.rent * 1.03) : null);
    setMonths(12);
    setExpiresOn(addDays(14));
    setRoundDollars(true);
    setSend(true);
    setError(null);
  }, [open]);

  const eligible = leases.filter(l => l.status === 'Active' && !l.moveOutDate);
  const skipped = leases.length - eligible.length;
  const offers = useMemo(
    () =>
      eligible.map(l => {
        let next = l.rent;
        if (mode === 'set') next = rent ?? l.rent;
        else if (mode === 'percent') next = fromCents(Math.round(toCents(l.rent) * (1 + (percent ?? 0) / 100)));
        else next = fromCents(toCents(l.rent) + toCents(amount ?? 0));
        if (roundDollars && mode !== 'set') next = Math.round(next);
        const change = l.rent > 0 ? Math.round(((next - l.rent) / l.rent) * 1000) / 10 : 0;
        return { lease: l, rent: next, change, term: renewalTerm(l.endDate, ws.today, months ?? 12) };
      }),
    [eligible, mode, rent, percent, amount, roundDollars, months, ws.today],
  );

  const submit = async () => {
    setError(null);
    if (!months || months < 1 || months > 60) return setError('Choose a term between 1 and 60 months.');
    if (!expiresOn || expiresOn < ws.today) return setError('The offer needs to stay open until today or later.');
    if (!offers.length) return setError('None of these leases can be renewed — they’re not active, or the residents gave notice.');
    if (offers.some(o => !(o.rent > 0))) return setError('Every renewal needs a rent above zero.');
    const res = await run({ action: 'offerRenewal', offers: offers.map(o => ({ leaseId: o.lease.id, rent: o.rent })), termMonths: months, expiresOn, send }, { what: 'Renewal offer', errorFallback: 'Couldn’t send the renewal offers' });
    if (res) {
      onDone?.();
      onOpenChange(false);
    }
  };

  const one = offers[0];
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={single ? `Offer a renewal · ${ws.unitLabel(single.unitId, single.propertyId)}` : `Offer renewals to ${eligible.length} ${eligible.length === 1 ? 'lease' : 'leases'}`}
      description="Residents can accept or decline in the portal. Accepting extends the same lease — the ledger and deposit carry on."
      onSubmit={submit}
      pending={pending === 'offerRenewal'}
      submitLabel={send ? (offers.length > 1 ? `Send ${offers.length} offers` : 'Send offer') : offers.length > 1 ? `Record ${offers.length} offers` : 'Record offer'}
      size={single ? 'md' : 'lg'}
      footerStart={skipped > 0 ? `${skipped} skipped — not active or on notice` : undefined}
    >
      <div className="space-y-4">
        {single ? (
          <FieldRow>
            <Field label="New monthly rent" hint={one ? `Currently ${ws.money(single.rent)} · ${one.change > 0 ? '+' : ''}${one.change}%` : undefined}>
              <MoneyInput value={rent} onChange={setRent} autoFocus />
            </Field>
            <Field label="Quick change">
              <Segmented
                value={String(rent != null && single.rent ? Math.round(((rent - single.rent) / single.rent) * 100) : '')}
                onChange={v => setRent(Math.round(single.rent * (1 + Number(v) / 100)))}
                options={[{ value: '0', label: 'Same' }, { value: '3', label: '+3%' }, { value: '5', label: '+5%' }, { value: '8', label: '+8%' }]}
                className="w-full [&>button]:flex-1 [&>button]:justify-center"
              />
            </Field>
          </FieldRow>
        ) : (
          <FieldRow>
            <Field label="Increase">
              <Segmented value={mode} onChange={v => setMode(v as Mode)} options={[{ value: 'percent', label: 'Percent' }, { value: 'amount', label: 'Dollar amount' }]} className="w-full [&>button]:flex-1 [&>button]:justify-center" />
            </Field>
            <Field label={mode === 'percent' ? 'Percent change' : 'Change per month'} hint="Use a negative number for a decrease.">
              {mode === 'percent' ? <NumberInput value={percent} onChange={setPercent} step={0.5} min={-50} max={100} suffix="%" /> : <MoneyInput value={amount} onChange={setAmount} />}
            </Field>
          </FieldRow>
        )}
        <FieldRow>
          <Field label="Term">
            <div className="flex items-center gap-2">
              <Segmented value={String(months)} onChange={v => setMonths(Number(v))} options={[{ value: '6', label: '6' }, { value: '12', label: '12' }, { value: '18', label: '18' }, { value: '24', label: '24' }]} />
              <NumberInput value={months} onChange={setMonths} min={1} max={60} suffix="mo" className="w-24" />
            </div>
          </Field>
          <Field label="Offer open until" hint={expiresOn ? `${Math.max(0, Math.round((Date.parse(expiresOn) - Date.parse(ws.today)) / 86_400_000))} days to respond` : undefined}>
            <DateInput value={expiresOn} onChange={setExpiresOn} min={ws.today} />
          </Field>
        </FieldRow>
        {single && one && (
          <p className="rounded-md bg-muted/60 px-3 py-2 text-[14px]">
            New term <span className="font-medium">{fullDate(one.term.start)} – {fullDate(one.term.end)}</span> at <Money value={one.rent} className="font-medium" />/mo.
          </p>
        )}
        {!single && (
          <div className="overflow-hidden rounded-lg border">
            <div className="max-h-[260px] overflow-auto">
              <table className="w-full text-[14px]">
                <thead className="sticky top-0 bg-subtle text-sm text-muted-foreground">
                  <tr>
                    <th className="h-9 px-3 text-left font-medium">Lease</th>
                    <th className="px-3 text-right font-medium">Now</th>
                    <th className="px-3 text-right font-medium">Offer</th>
                    <th className="hidden px-3 text-right font-medium sm:table-cell">New term ends</th>
                  </tr>
                </thead>
                <tbody>
                  {offers.map(o => (
                    <tr key={o.lease.id} className="border-t">
                      <td className="h-9 max-w-[220px] truncate px-3"><span className="mr-2 text-sm tabular-nums text-muted-foreground">{leaseRef(o.lease.number)}</span>{ws.unitLabel(o.lease.unitId, o.lease.propertyId)}</td>
                      <td className="px-3 text-right text-muted-foreground"><Money value={o.lease.rent} /></td>
                      <td className="px-3 text-right"><Money value={o.rent} className="font-medium" /> <span className={cn('ml-1 text-sm tabular-nums', o.change > 0 ? 'text-tone-warning' : 'text-muted-foreground')}>{o.change > 0 ? '+' : ''}{o.change}%</span></td>
                      <td className="hidden px-3 text-right tabular-nums text-muted-foreground sm:table-cell">{fullDate(o.term.end)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="rounded-lg border px-3 py-1.5">
          {!single && <SwitchRow label="Round to whole dollars" checked={roundDollars} onChange={setRoundDollars} />}
          <SwitchRow
            label="Email the offer to residents"
            description={template && !template.enabled ? 'The Renewal offer template is switched off in Settings, so nothing will be emailed.' : 'Uses your Renewal offer template, with a link to accept in the portal.'}
            checked={send}
            onChange={setSend}
          />
        </div>
        {error && <p role="alert" className="text-[14px] text-tone-danger">{error}</p>}
      </div>
    </FormDialog>
  );
}
