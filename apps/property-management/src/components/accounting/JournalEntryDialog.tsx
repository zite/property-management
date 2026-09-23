import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, Building2, CheckCircle2, KeyRound, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { postJournal } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { fromCents, toCents } from '@project/shared/money';
import { errorMessage } from '../../lib/errors';
import { todayString } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { AccountPicker, FieldButton, PropertyPicker, RecordSearchPicker } from '../pickers/pickers';
import { IconButton, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { PropertySwatch } from '../primitives/glyphs';
import { afterPosting } from './ledgerData';
import { Notice } from './parts';

type Line = { key: number; accountId: string | null; propertyId: string | null; leaseId: string | null; leaseLabel: string | null; memo: string; debit: number | null; credit: number | null };

/**
 * A manual journal entry. Lines are balanced debits and credits on any
 * account, optionally tagged with a property or lease; the footer shows how
 * far out of balance it is and posting is only possible at zero.
 */
export function JournalEntryDialog({ open, onOpenChange, onPosted }: { open: boolean; onOpenChange: (o: boolean) => void; onPosted?: (id: string) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const seq = useRef(1);
  const [date, setDate] = useState(todayString());
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [errors, setErrors] = useState<{ description?: string; lines?: string; form?: string }>({});
  const [pending, setPending] = useState(false);

  const blank = (): Line => ({ key: seq.current++, accountId: null, propertyId: null, leaseId: null, leaseLabel: null, memo: '', debit: null, credit: null });
  useEffect(() => {
    if (!open) return;
    seq.current = 1;
    setDate(todayString());
    setDescription('');
    setReference('');
    setLines([blank(), blank()]);
    setErrors({});
  }, [open]);

  const patch = (key: number, p: Partial<Line>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...p } : l)));
  const dr = lines.reduce((s, l) => s + toCents(l.debit ?? 0), 0);
  const cr = lines.reduce((s, l) => s + toCents(l.credit ?? 0), 0);
  const used = lines.filter(l => toCents(l.debit ?? 0) > 0 || toCents(l.credit ?? 0) > 0);
  const balanced = dr === cr && dr > 0 && used.length >= 2;
  const receivableLine = used.some(l => {
    const a = l.accountId ? ws.accountById.get(l.accountId) : undefined;
    return a && (a.subtype === 'Receivable' || a.subtype === 'Deposits held') && l.leaseId;
  });

  const submit = async () => {
    const next: typeof errors = {};
    if (!description.trim()) next.description = 'Describe what the entry is for.';
    if (used.length < 2) next.lines = 'Add at least two lines with amounts.';
    else if (used.some(l => !l.accountId)) next.lines = 'Choose an account for every line.';
    else if (dr !== cr) next.lines = `Debits and credits are ${ws.money(Math.abs(fromCents(dr - cr)))} apart.`;
    setErrors(next);
    if (Object.keys(next).length) return;
    setPending(true);
    try {
      const res = await postJournal({
        date, description: description.trim(), reference: reference.trim() || undefined,
        lines: used.map(l => ({ accountId: l.accountId!, debit: l.debit ?? undefined, credit: l.credit ?? undefined, propertyId: l.propertyId ?? undefined, leaseId: l.leaseId ?? undefined, memo: l.memo.trim() || undefined })),
      });
      afterPosting(qc);
      toast.success(`Journal entry #${res.number} posted`, { description: `${ws.money(res.amount)} · ${description.trim()}`, action: onPosted ? { label: 'Open', onClick: () => onPosted(res.id) } : undefined });
      onOpenChange(false);
    } catch (e) {
      setErrors({ form: errorMessage(e, 'Couldn’t post the journal entry') });
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Journal entry"
      description="For corrections, reclassifications and opening balances. Resident charges and payments belong on the lease ledger."
      onSubmit={submit}
      pending={pending}
      submitLabel="Post entry"
      size="xl"
      footerStart={
        balanced ? <span className="inline-flex items-center gap-1.5 text-tone-success"><CheckCircle2 className="h-3.5 w-3.5" /> Balanced · <Money value={fromCents(dr)} /></span>
          : dr || cr ? <span className="text-tone-danger">Out of balance by <Money value={fromCents(Math.abs(dr - cr))} className="font-medium" /></span>
          : 'Debits must equal credits'
      }
    >
      <div className="space-y-4">
        <FieldRow cols={3}>
          <Field label="Date"><DateInput value={date} onChange={v => v && setDate(v)} /></Field>
          <Field label="Description" error={errors.description} className="sm:col-span-1">
            <TextInput value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Reclassify June HOA dues" maxLength={250} invalid={Boolean(errors.description)} />
          </Field>
          <Field label="Reference" optional><TextInput value={reference} onChange={e => setReference(e.target.value)} maxLength={80} /></Field>
        </FieldRow>

        <div className="overflow-x-auto rounded-lg border">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_112px_112px_28px] gap-2 border-b bg-subtle/60 px-2 py-1.5 text-sm text-muted-foreground">
              <span className="pl-1">Account</span>
              <span>Property or lease</span>
              <span>Memo</span>
              <span className="pr-2 text-right">Debit</span>
              <span className="pr-2 text-right">Credit</span>
              <span />
            </div>
            {lines.map((l, i) => {
              const account = l.accountId ? ws.accountById.get(l.accountId) : undefined;
              const property = l.propertyId ? ws.propertyById.get(l.propertyId) : undefined;
              const leaseCapable = account && (account.subtype === 'Receivable' || account.subtype === 'Deposits held' || account.accountType === 'Income');
              return (
                <div key={l.key} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_112px_112px_28px] items-center gap-2 border-b px-2 py-1.5 last:border-b-0">
                  <AccountPicker kind="all" value={l.accountId} onChange={id => patch(l.key, { accountId: id })} trigger={<FieldButton placeholder="Account" icon={<BookOpen className="h-3.5 w-3.5 text-muted-foreground" />} aria-label={`Account for line ${i + 1}`}>{account ? `${account.number} ${account.name}` : null}</FieldButton>} />
                  {leaseCapable && (l.leaseId || !l.propertyId) ? (
                    <RecordSearchPicker kinds={['leases']} value={l.leaseId} valueLabel={l.leaseLabel} onChange={hit => patch(l.key, { leaseId: hit?.id ?? null, leaseLabel: hit?.label ?? null, propertyId: null })} placeholder="Find a lease…" trigger={<FieldButton placeholder="Lease (optional)" icon={<KeyRound className="h-3.5 w-3.5 text-muted-foreground" />} onClear={l.leaseId ? () => patch(l.key, { leaseId: null, leaseLabel: null }) : undefined}>{l.leaseLabel}</FieldButton>} />
                  ) : (
                    <PropertyPicker allowNone value={l.propertyId} onChange={id => patch(l.key, { propertyId: id })} trigger={<FieldButton placeholder="Property (optional)" icon={property ? <PropertySwatch color={property.color} /> : <Building2 className="h-3.5 w-3.5 text-muted-foreground" />} onClear={l.propertyId ? () => patch(l.key, { propertyId: null }) : undefined}>{property?.name}</FieldButton>} />
                  )}
                  <TextInput value={l.memo} onChange={e => patch(l.key, { memo: e.target.value })} placeholder="Optional" maxLength={250} aria-label={`Memo for line ${i + 1}`} />
                  <MoneyInput value={l.debit} onChange={v => patch(l.key, { debit: v, credit: v ? null : l.credit })} />
                  <MoneyInput value={l.credit} onChange={v => patch(l.key, { credit: v, debit: v ? null : l.debit })} />
                  {lines.length > 2 ? <Tip label="Remove line"><IconButton size="sm" aria-label={`Remove line ${i + 1}`} onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}><X /></IconButton></Tip> : <span />}
                </div>
              );
            })}
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_112px_112px_28px] items-center gap-2 border-t bg-subtle/40 px-2 py-1.5">
              <button type="button" onClick={() => setLines(ls => [...ls, blank()])} className="ghost-chip h-8 w-fit gap-1.5 text-sm"><Plus className="h-3.5 w-3.5" /> Add line</button>
              <span />
              <span className="text-right text-sm text-muted-foreground">Totals</span>
              <Money value={fromCents(dr)} className={cn('pr-2.5 text-right text-[14px] font-semibold', !balanced && (dr || cr) ? 'text-tone-danger' : undefined)} />
              <Money value={fromCents(cr)} className={cn('pr-2.5 text-right text-[14px] font-semibold', !balanced && (dr || cr) ? 'text-tone-danger' : undefined)} />
              <span />
            </div>
          </div>
        </div>
        {errors.lines && <p role="alert" className="text-sm text-tone-danger">{errors.lines}</p>}
        {receivableLine && (
          <Notice tone="warning">
            <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5 text-tone-warning" />
            Entries on a resident’s receivable or deposit change their balance but aren’t matched to charges. For write-offs and waivers, post a credit on the lease instead.
          </Notice>
        )}
        {errors.form && <p role="alert" className="text-[14px] text-tone-danger">{errors.form}</p>}
      </div>
    </FormDialog>
  );
}
