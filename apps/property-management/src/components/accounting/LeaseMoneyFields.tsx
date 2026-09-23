import { KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@project/components/lib/utils';
import { shortDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { Field, MoneyInput } from '../form/fields';
import { FieldButton, RecordSearchPicker } from '../pickers/pickers';
import { Money } from '../primitives/data';
import { useLeaseLedger, type OpenCharge } from './ledgerData';

/** Choose the lease money is posted to; shows its balance once chosen. */
export function LeaseField({ leaseId, onChange, error, locked }: { leaseId: string | null; onChange: (id: string | null) => void; error?: string | null; locked?: boolean }) {
  const { data } = useLeaseLedger(leaseId);
  const ws = useWorkspace();
  const label = data?.lease ? data.lease.name : leaseId ? 'Loading…' : null;
  return (
    <Field
      label="Lease"
      error={error}
      hint={data ? (
        <span className="flex flex-wrap gap-x-3">
          <span>Balance <Money value={data.balance} tone="balance" /></span>
          {data.pastDue > 0 && <span>Past due <Money value={data.pastDue} className="text-tone-danger" /></span>}
          {data.depositHeld > 0 && <span>Deposit held <Money value={data.depositHeld} /></span>}
          {data.lease?.unitId && <span className="text-muted-foreground">{ws.unitLabel(data.lease.unitId)}</span>}
        </span>
      ) : undefined}
    >
      {locked ? (
        <div className="field items-center gap-2 bg-muted/40"><KeyRound className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{label}</span></div>
      ) : (
        <RecordSearchPicker
          kinds={['leases']}
          value={leaseId}
          valueLabel={label}
          onChange={hit => onChange(hit?.id ?? null)}
          placeholder="Search by resident, unit or lease…"
          trigger={
            <FieldButton placeholder="Find a lease" invalid={Boolean(error)} icon={<KeyRound className="h-3.5 w-3.5 text-muted-foreground" />} onClear={leaseId ? () => onChange(null) : undefined}>
              {label}
            </FieldButton>
          }
        />
      )}
    </Field>
  );
}

/**
 * Apply money to specific open charges instead of oldest-first. Values are
 * per charge id; anything left over stays as credit and applies automatically.
 */
export function AllocationEditor({ charges, amount, value, onChange }: { charges: OpenCharge[]; amount: number; value: Record<string, number>; onChange: (v: Record<string, number>) => void }) {
  const applied = Object.values(value).reduce((s, n) => s + (n || 0), 0);
  const left = Math.round((amount - applied) * 100) / 100;
  const [touched, setTouched] = useState(false);

  // Start from an oldest-first split so the common case needs no typing.
  useEffect(() => {
    if (touched) return;
    let remaining = amount;
    const next: Record<string, number> = {};
    for (const c of charges) {
      const take = Math.max(0, Math.min(c.open, Math.round(remaining * 100) / 100));
      if (take > 0) next[c.id] = take;
      remaining -= take;
    }
    onChange(next);
  }, [amount, charges.length]);

  if (!charges.length) return <p className="rounded-md border border-dashed px-3 py-3 text-center text-sm text-muted-foreground">No open charges — the whole amount stays as credit.</p>;
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="max-h-[240px] overflow-y-auto">
        {charges.map(c => {
          const v = value[c.id] ?? 0;
          return (
            <label key={c.id} className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                checked={v > 0}
                onChange={e => {
                  setTouched(true);
                  const others = applied - v;
                  onChange({ ...value, [c.id]: e.target.checked ? Math.max(0, Math.min(c.open, Math.round((amount - others) * 100) / 100)) : 0 });
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px]">{c.description}</span>
                <span className="text-sm text-muted-foreground">
                  {c.dueDate ? `Due ${shortDate(c.dueDate)}` : shortDate(c.date)} · <Money value={c.open} /> open
                </span>
              </span>
              <MoneyInput
                value={v || null}
                onChange={n => {
                  setTouched(true);
                  onChange({ ...value, [c.id]: Math.max(0, Math.min(c.open, n ?? 0)) });
                }}
                className="w-28"
              />
            </label>
          );
        })}
      </div>
      <div className={cn('flex items-center justify-between border-t bg-subtle/60 px-3 py-2 text-sm', left < -0.004 ? 'text-tone-danger' : 'text-muted-foreground')}>
        <span>Applied <Money value={applied} /></span>
        <span>{left < -0.004 ? 'More than the amount' : left > 0.004 ? <>Leaves <Money value={left} /> as credit</> : 'Fully applied'}</span>
      </div>
    </div>
  );
}
