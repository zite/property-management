import { useQueryClient } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { saveRecurringCharge, updateLease } from 'zitejs/api';
import { LEASE_TENANT_ROLES, LEASE_TYPES, RECURRING_FREQUENCIES } from '@project/shared/constants';
import { addDays as addDayStr, addPeriods, daysBetween, periodOf, periodStart, prorateToMonthEnd } from '@project/shared/dates';
import { defaultEndDate } from '@project/shared/leases';
import { joinNames, ordinal } from '@project/shared/merge';
import { errorMessage } from '../../lib/errors';
import { fullDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, Segmented, SwitchRow, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { AccountPicker, FieldButton, RecordSearchPicker } from '../pickers/pickers';
import { Money } from '../primitives/data';
import { afterLeaseChange, useLeaseLifecycle, type LeaseDetail } from './data';

type Person = LeaseDetail['people'][number];
type Charge = LeaseDetail['recurring'][number];
const signer = (p: { role: string }) => p.role === 'Primary' || p.role === 'Co-tenant';

/** Record a signature the office collected on paper or in person. */
export function RecordSignatureDialog({ detail, person, onOpenChange }: { detail: LeaseDetail; person: Person | null; onOpenChange: (o: boolean) => void }) {
  const { run, pending } = useLeaseLifecycle();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (person) {
      setName(person.name);
      setError(null);
    }
  }, [person?.id]);
  const submit = async () => {
    if (!person) return;
    if (name.trim().length < 2) return setError('Type the name as it was signed.');
    const res = await run({ action: 'recordSignature', leaseId: detail.lease.id, tenantId: person.id, typedName: name.trim() }, { errorFallback: 'Couldn’t record the signature' });
    if (res) onOpenChange(false);
  };
  return (
    <FormDialog open={Boolean(person)} onOpenChange={onOpenChange} title={`Record ${person?.name ?? 'a'}’s signature`} description="For a lease signed on paper or in the office. It’s recorded as collected by you, with today’s date." onSubmit={submit} pending={pending === 'recordSignature'} submitLabel="Record signature" size="sm">
      <Field label="Signed as" error={error} hint="The name exactly as it appears on the signed lease.">
        <TextInput autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={120} invalid={Boolean(error)} />
      </Field>
    </FormDialog>
  );
}

/** Countersign and activate — says exactly what posts and who is marked as signed before it happens. */
export function ActivateDialog({ detail, open, onOpenChange, fromDraft }: { detail: LeaseDetail; open: boolean; onOpenChange: (o: boolean) => void; fromDraft?: boolean }) {
  const ws = useWorkspace();
  const { run, pending } = useLeaseLifecycle();
  const l = detail.lease;
  const welcomeTemplate = ws.templates.find(t => t.trigger === 'Welcome');
  const [welcome, setWelcome] = useState(true);
  useEffect(() => {
    if (open) setWelcome(Boolean(welcomeTemplate?.enabled));
  }, [open]);
  const unsigned = detail.people.filter(p => signer(p) && !p.signedAt);
  const start = l.startDate ?? ws.today;
  const prorated = start.slice(8, 10) !== '01' ? prorateToMonthEnd(l.rent, start) : 0;
  const extras = detail.recurring.filter(r => r.active && !/^rent$/i.test(r.description));
  const submit = async () => {
    const res = await run({ action: 'activate', leaseId: l.id, signAll: unsigned.length > 0, sendWelcome: welcome }, { money: true, what: 'Welcome email', errorFallback: 'Couldn’t activate the lease' });
    if (res) onOpenChange(false);
  };
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={fromDraft ? 'Mark signed and activate' : 'Countersign and activate'} description="The lease becomes active and starts billing. This can’t be undone — to stop it later, record notice and complete a move-out." onSubmit={submit} pending={pending === 'activate'} submitLabel="Activate lease">
      <div className="space-y-4 text-[14px]">
        {unsigned.length > 0 && (
          <p className="rounded-md border border-tone-warning/30 bg-tone-warning/[0.06] px-3 py-2">
            {joinNames(unsigned.map(p => p.name))} {unsigned.length === 1 ? 'hasn’t' : 'haven’t'} signed in the portal. Activating records {unsigned.length === 1 ? 'their signature' : 'their signatures'} as collected by the office — only do this if you have the signed lease.
          </p>
        )}
        <div className="overflow-hidden rounded-lg border">
          <div className="border-b bg-subtle/60 px-3 py-1.5 text-sm font-medium text-muted-foreground">Posts to the ledger now</div>
          <ul className="divide-y">
            {l.deposit > 0 && <Line label="Security deposit" value={<Money value={l.deposit} />} />}
            {prorated > 0 && <Line label={`Prorated rent, ${fullDate(start)} to month end`} value={<Money value={prorated} />} />}
            {start <= ws.today && <Line label="Rent and recurring charges already due" value={<span className="text-muted-foreground">as scheduled</span>} />}
            {l.deposit <= 0 && prorated <= 0 && start > ws.today && <Line label="Nothing until rent is due" value={<span className="text-muted-foreground">—</span>} />}
          </ul>
          <div className="border-t bg-subtle/60 px-3 py-1.5 text-sm text-muted-foreground">
            Then <Money value={l.rent} /> rent{extras.length ? ` + ${extras.map(e => `${e.description} ${ws.money(e.amount)}`).join(' + ')}` : ''} monthly on the {ordinal(l.rentDueDay)}.
          </div>
        </div>
        <SwitchRow
          label="Send the Welcome email"
          description={welcomeTemplate && !welcomeTemplate.enabled ? 'The Welcome template is switched off in Settings.' : 'Links residents to the portal, with your emergency maintenance line.'}
          checked={welcome}
          onChange={setWelcome}
          disabled={!welcomeTemplate?.enabled}
        />
      </div>
    </FormDialog>
  );
}

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <li className="flex h-9 items-center justify-between gap-3 px-3">
      <span className="truncate">{label}</span>
      <span className="shrink-0">{value}</span>
    </li>
  );
}

/** Record notice to vacate, or change the move-out date on notice already given. */
export function NoticeDialog({ detail, open, onOpenChange }: { detail: LeaseDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const ws = useWorkspace();
  const { run, pending } = useLeaseLifecycle();
  const l = detail.lease;
  const updating = Boolean(l.noticeGivenOn || l.moveOutDate);
  const [noticeDate, setNoticeDate] = useState<string | null>(ws.today);
  const [moveOut, setMoveOut] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [forwarding, setForwarding] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setNoticeDate(l.noticeGivenOn ?? ws.today);
    setMoveOut(l.moveOutDate ?? (l.endDate && l.endDate >= ws.today ? l.endDate : addDayStr(ws.today, 30)));
    setReason(l.moveOutReason);
    setForwarding(l.forwardingAddress);
    setError(null);
  }, [open]);
  const days = noticeDate && moveOut ? daysBetween(noticeDate, moveOut) : null;
  const submit = async () => {
    if (!moveOut) return setError('Choose the move-out date.');
    if (moveOut < ws.today) return setError('Choose a move-out date from today onward.');
    const res = updating
      ? await run({ action: 'updateNotice', leaseId: l.id, moveOutDate: moveOut, reason: reason.trim(), forwardingAddress: forwarding.trim() }, { errorFallback: 'Couldn’t save the move-out details' })
      : await run({ action: 'giveNotice', leaseId: l.id, noticeDate: noticeDate ?? ws.today, moveOutDate: moveOut, reason: reason.trim() || undefined, forwardingAddress: forwarding.trim() || undefined }, { errorFallback: 'Couldn’t record the notice' });
    if (res) onOpenChange(false);
  };
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={updating ? 'Move-out details' : 'Record notice to vacate'} description={updating ? undefined : 'For notice the residents gave by email, phone or letter. They can also give notice in the portal.'} onSubmit={submit} pending={pending === 'giveNotice' || pending === 'updateNotice'} submitLabel={updating ? 'Save' : 'Record notice'}>
      <div className="space-y-4">
        <FieldRow>
          <Field label="Notice given on">
            <DateInput value={noticeDate} onChange={setNoticeDate} max={ws.today} disabled={updating} />
          </Field>
          <Field label="Moving out" error={error} hint={days != null && days >= 0 ? `${days} days’ notice${days < 30 ? ' — less than 30 days' : ''}${l.endDate && moveOut && moveOut < l.endDate ? ` · before the lease ends ${fullDate(l.endDate)}` : ''}` : undefined}>
            <DateInput value={moveOut} onChange={setMoveOut} min={ws.today} invalid={Boolean(error)} />
          </Field>
        </FieldRow>
        <Field label="Reason" optional>
          <TextInput value={reason} onChange={e => setReason(e.target.value)} maxLength={240} placeholder="e.g. Bought a home, relocating for work" />
        </Field>
        <Field label="Forwarding address" optional hint="Where the deposit refund and statement go.">
          <TextArea rows={2} value={forwarding} onChange={e => setForwarding(e.target.value)} maxLength={500} />
        </Field>
      </div>
    </FormDialog>
  );
}

/** Complete the move-out: the lease ends, billing stops, and the unit goes to make-ready. */
export function EndLeaseDialog({ detail, open, onOpenChange }: { detail: LeaseDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const ws = useWorkspace();
  const { run, pending } = useLeaseLifecycle();
  const l = detail.lease;
  const [date, setDate] = useState<string | null>(ws.today);
  const [readiness, setReadiness] = useState<'Make ready' | 'Ready'>('Make ready');
  useEffect(() => {
    if (!open) return;
    setDate(l.moveOutDate && l.moveOutDate <= ws.today ? l.moveOutDate : ws.today);
    setReadiness('Make ready');
  }, [open]);
  const submit = async () => {
    if (!date) return;
    const res = await run({ action: 'endLease', leaseId: l.id, moveOutDate: date, readiness }, { money: true, errorFallback: 'Couldn’t complete the move-out' });
    if (res) onOpenChange(false);
  };
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Complete the move-out" description="The lease ends and stops billing. The unit shows as vacant." onSubmit={submit} pending={pending === 'endLease'} submitLabel="End lease">
      <div className="space-y-4">
        <FieldRow>
          <Field label="Moved out on" hint={l.moveOutDate && l.moveOutDate > ws.today ? `They planned to leave ${fullDate(l.moveOutDate)}.` : undefined}>
            <DateInput value={date} onChange={setDate} max={ws.today} min={l.startDate ?? undefined} />
          </Field>
          <Field label="Unit">
            <Segmented value={readiness} onChange={v => setReadiness(v as 'Make ready' | 'Ready')} options={[{ value: 'Make ready', label: 'Needs make-ready' }, { value: 'Ready', label: 'Ready to rent' }]} />
          </Field>
        </FieldRow>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border text-[14px]">
          <div className="bg-card px-3 py-2"><div className="text-sm text-muted-foreground">Balance</div><Money value={detail.balance} tone="balance" className="font-medium" /></div>
          <div className="bg-card px-3 py-2"><div className="text-sm text-muted-foreground">Deposit held</div><Money value={detail.depositHeld} className="font-medium" /></div>
        </div>
        {!l.depositSettledAt && detail.depositHeld > 0 && <p className="text-sm text-muted-foreground">Settle the deposit afterwards from the lease — deductions, applying it to the balance, and the refund.</p>}
      </div>
    </FormDialog>
  );
}

const PRESETS = [
  { key: 'pet_income', description: 'Pet rent', amount: 35 },
  { key: 'parking_income', description: 'Parking', amount: 75 },
  { key: 'utility_income', description: 'Water, sewer & trash', amount: 65 },
  { key: 'other_income', description: 'Storage', amount: 40 },
] as const;

export type ChargeDialogState = { mode: 'add' } | { mode: 'change'; charge: Charge } | { mode: 'end'; charge: Charge } | null;

/** Add a recurring charge, change one's amount from a date, or end it. */
export function RecurringChargeDialog({ detail, state, onOpenChange }: { detail: LeaseDetail; state: ChargeDialogState; onOpenChange: (o: boolean) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const l = detail.lease;
  const nextMonth = periodStart(addPeriods(periodOf(ws.today), 1));
  const [accountId, setAccountId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [frequency, setFrequency] = useState<string>('Monthly');
  const [start, setStart] = useState<string | null>(nextMonth);
  const [end, setEnd] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const charge = state && state.mode !== 'add' ? state.charge : null;
  const firstUnbilled = charge?.lastPostedPeriod ? periodStart(addPeriods(charge.lastPostedPeriod, 1)) : nextMonth;

  useEffect(() => {
    if (!state) return;
    setError(null);
    if (state.mode === 'add') {
      setAccountId(ws.accountByKey.get('pet_income')?.id ?? ws.chargeAccounts[0]?.id ?? null);
      setDescription('');
      setAmount(null);
      setFrequency('Monthly');
      setStart(l.status === 'Active' && l.startDate && l.startDate <= ws.today ? nextMonth : l.startDate && l.startDate.endsWith('-01') ? l.startDate : nextMonth);
      setEnd(null);
    } else if (state.mode === 'change') {
      setAmount(state.charge.amount);
      setStart(state.charge.startDate && state.charge.startDate > firstUnbilled ? state.charge.startDate : firstUnbilled);
    } else {
      setEnd(state.charge.lastPostedPeriod ? addDayStr(firstUnbilled, -1) : l.moveOutDate ?? addDayStr(nextMonth, -1));
    }
  }, [state]);

  const account = accountId ? ws.accountById.get(accountId) : undefined;
  const submit = async () => {
    setError(null);
    setPending(true);
    try {
      let message = '';
      if (state?.mode === 'add') {
        if (!accountId) throw new Error('Choose what the charge is for.');
        if (!description.trim()) throw new Error('Describe the charge — residents see it on their ledger.');
        if (!amount || amount <= 0) throw new Error('Enter the amount.');
        if (!start) throw new Error('Choose when it starts.');
        message = (await saveRecurringCharge({ action: 'add', leaseId: l.id, accountId, description: description.trim(), amount, frequency: frequency as 'Monthly', startDate: start, endDate: end })).message;
      } else if (state?.mode === 'change' && charge) {
        if (!amount || amount <= 0) throw new Error('Enter the new amount.');
        if (!start) throw new Error('Choose when the new amount starts.');
        message = (await saveRecurringCharge({ action: 'changeAmount', id: charge.id, amount, effectiveDate: start })).message;
      } else if (state?.mode === 'end' && charge) {
        if (!end) throw new Error('Choose the last day it covers.');
        message = (await saveRecurringCharge({ action: 'end', id: charge.id, endDate: end })).message;
      }
      afterLeaseChange(qc, { money: true });
      toast.success(message);
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t save the charge'));
    } finally {
      setPending(false);
    }
  };

  const title = state?.mode === 'add' ? 'Add a recurring charge' : state?.mode === 'change' ? `Change ${charge?.description}` : `End ${charge?.description}`;
  return (
    <FormDialog open={Boolean(state)} onOpenChange={onOpenChange} title={title} description={state?.mode === 'change' ? 'The current amount ends the day before; the new amount bills from the date you choose. Past charges stay as they were.' : undefined} onSubmit={submit} pending={pending} submitLabel={state?.mode === 'add' ? 'Add charge' : state?.mode === 'change' ? 'Change amount' : 'End charge'} size="md">
      <div className="space-y-4">
        {state?.mode === 'add' && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map(p => (
                <button
                  key={p.description}
                  type="button"
                  className="chip hover:bg-accent"
                  onClick={() => {
                    setAccountId(ws.accountByKey.get(p.key)?.id ?? accountId);
                    setDescription(p.description);
                    setAmount(p.amount);
                  }}
                >
                  {p.description}
                </button>
              ))}
            </div>
            <FieldRow>
              <Field label="Charge for">
                <AccountPicker kind="charge" value={accountId} onChange={setAccountId} trigger={<FieldButton icon={<Receipt className="h-3.5 w-3.5 text-muted-foreground" />}>{account?.name}</FieldButton>} />
              </Field>
              <Field label="Description">
                <TextInput value={description} onChange={e => setDescription(e.target.value)} maxLength={120} placeholder="e.g. Pet rent — Miso" />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Amount">
                <MoneyInput value={amount} onChange={setAmount} />
              </Field>
              <Field label="Bills">
                <Segmented value={frequency} onChange={setFrequency} options={RECURRING_FREQUENCIES.map(f => ({ value: f, label: f }))} />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Starts" hint={start && start < periodStart(periodOf(ws.today)) && l.status === 'Active' ? 'Starts in the past — missed months (up to two) bill now.' : `Due on the ${ordinal(l.rentDueDay)}, with rent.`}>
                <DateInput value={start} onChange={setStart} />
              </Field>
              <Field label="Ends" optional>
                <DateInput value={end} onChange={setEnd} min={start ?? undefined} />
              </Field>
            </FieldRow>
          </>
        )}
        {state?.mode === 'change' && charge && (
          <FieldRow>
            <Field label="New amount" hint={`Now ${ws.money(charge.amount)}`}>
              <MoneyInput value={amount} onChange={setAmount} autoFocus />
            </Field>
            <Field label="Starting" hint={charge.lastPostedPeriod ? `Billed through ${fullDate(addDayStr(firstUnbilled, -1))}` : undefined}>
              <DateInput value={start} onChange={setStart} min={charge.lastPostedPeriod ? firstUnbilled : undefined} />
            </Field>
          </FieldRow>
        )}
        {state?.mode === 'end' && charge && (
          <Field label="Last day it covers" hint={charge.lastPostedPeriod ? `Already billed through ${fullDate(addDayStr(firstUnbilled, -1))}.` : 'Nothing has billed yet — you can also remove it.'}>
            <DateInput value={end} onChange={setEnd} min={charge.startDate ?? undefined} />
          </Field>
        )}
        {error && <p role="alert" className="text-[14px] text-tone-danger">{error}</p>}
      </div>
    </FormDialog>
  );
}

/** Add someone to a lease: an existing resident or a new person. */
export function AddPersonDialog({ detail, open, onOpenChange }: { detail: LeaseDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [hit, setHit] = useState<{ id: string; label: string } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<string>('Co-tenant');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!open) return;
    setMode('existing');
    setHit(null);
    setName('');
    setEmail('');
    setPhone('');
    setRole(detail.people.some(p => p.role === 'Primary') ? 'Co-tenant' : 'Primary');
    setError(null);
  }, [open]);
  const submit = async () => {
    setError(null);
    if (mode === 'existing' && !hit) return setError('Search for the resident, or add a new person.');
    if (mode === 'new' && !name.trim()) return setError('Enter their name.');
    setPending(true);
    try {
      const res = await updateLease({ action: 'addPerson', leaseId: detail.lease.id, role: role as 'Co-tenant', ...(mode === 'existing' ? { tenantId: hit!.id } : { name: name.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined }) });
      afterLeaseChange(qc);
      toast.success(res.message);
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t add them to the lease'));
    } finally {
      setPending(false);
    }
  };
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Add someone to the lease" onSubmit={submit} pending={pending} submitLabel="Add to lease" size="md">
      <div className="space-y-4">
        <Segmented value={mode} onChange={v => setMode(v as 'existing' | 'new')} options={[{ value: 'existing', label: 'Existing resident' }, { value: 'new', label: 'New person' }]} />
        {mode === 'existing' ? (
          <Field label="Resident">
            <RecordSearchPicker kinds={['tenants']} value={hit?.id} valueLabel={hit?.label} onChange={h => setHit(h ? { id: h.id, label: h.label } : null)} placeholder="Search residents by name or email…" />
          </Field>
        ) : (
          <>
            <Field label="Name">
              <TextInput autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={120} />
            </Field>
            <FieldRow>
              <Field label="Email" optional hint="How they sign in to the portal.">
                <TextInput type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={200} />
              </Field>
              <Field label="Phone" optional>
                <TextInput value={phone} onChange={e => setPhone(e.target.value)} maxLength={40} />
              </Field>
            </FieldRow>
          </>
        )}
        <Field label="Role" hint={role === 'Occupant' ? 'Lives there but isn’t on the hook for rent and doesn’t sign.' : role === 'Guarantor' ? 'Guarantees the rent but doesn’t live there.' : 'Signs the lease and is responsible for rent.'}>
          <Segmented value={role} onChange={setRole} options={LEASE_TENANT_ROLES.map(r => ({ value: r, label: r }))} />
        </Field>
        {error && <p role="alert" className="text-[14px] text-tone-danger">{error}</p>}
      </div>
    </FormDialog>
  );
}

/** Change a draft's terms before it goes out for signature. */
export function EditTermsDialog({ detail, open, onOpenChange }: { detail: LeaseDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const l = detail.lease;
  const [type, setType] = useState<string>(l.leaseType);
  const [start, setStart] = useState<string | null>(l.startDate);
  const [end, setEnd] = useState<string | null>(l.endDate);
  const [rent, setRent] = useState<number | null>(l.rent);
  const [deposit, setDeposit] = useState<number | null>(l.deposit);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!open) return;
    setType(l.leaseType);
    setStart(l.startDate);
    setEnd(l.endDate);
    setRent(l.rent);
    setDeposit(l.deposit);
    setError(null);
  }, [open]);
  const submit = async () => {
    setError(null);
    if (!start) return setError('Choose the start date.');
    if (type === 'Fixed term' && !end) return setError('A fixed-term lease needs an end date.');
    if (!rent || rent <= 0) return setError('Enter the monthly rent.');
    setPending(true);
    try {
      await updateLease({ action: 'patch', leaseId: l.id, patch: { leaseType: type as 'Fixed term', startDate: start, endDate: type === 'Month-to-month' ? null : end, rent, deposit: deposit ?? 0 } });
      afterLeaseChange(qc);
      toast.success('Draft terms updated');
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t update the terms'));
    } finally {
      setPending(false);
    }
  };
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Edit draft terms" onSubmit={submit} pending={pending} submitLabel="Save terms" size="md">
      <div className="space-y-4">
        <Segmented value={type} onChange={setType} options={LEASE_TYPES.map(t => ({ value: t, label: t }))} />
        <FieldRow>
          <Field label="Starts">
            <DateInput value={start} onChange={v => { setStart(v); if (v && type === 'Fixed term') setEnd(defaultEndDate(v, 12)); }} />
          </Field>
          {type === 'Fixed term' && (
            <Field label="Ends">
              <DateInput value={end} onChange={setEnd} min={start ?? undefined} />
            </Field>
          )}
        </FieldRow>
        <FieldRow>
          <Field label="Monthly rent"><MoneyInput value={rent} onChange={setRent} /></Field>
          <Field label="Security deposit"><MoneyInput value={deposit} onChange={setDeposit} /></Field>
        </FieldRow>
        {error && <p role="alert" className="text-[14px] text-tone-danger">{error}</p>}
      </div>
    </FormDialog>
  );
}
