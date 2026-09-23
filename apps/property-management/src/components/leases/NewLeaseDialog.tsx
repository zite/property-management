import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Building2, Plus, Receipt, Search, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { createLeaseStaff, getResident, type CreateLeaseStaffOutputType } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { LEASE_TENANT_ROLES } from '@project/shared/constants';
import { addDays as addDayStr, addPeriods, periodOf, periodStart, prorateToMonthEnd } from '@project/shared/dates';
import { defaultEndDate } from '@project/shared/leases';
import { ordinal } from '@project/shared/merge';
import { errorMessage } from '../../lib/errors';
import { fullDate, shortDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, NumberInput, Segmented, SwitchRow, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { AccountPicker, ChoicePicker, FieldButton, RecordSearchPicker, UnitPicker } from '../pickers/pickers';
import { IconButton } from '../primitives/bits';
import { Money } from '../primitives/data';
import { OccupancyGlyph } from '../primitives/glyphs';
import type { CreateDialogProps } from '../shell/CreateDialogs';
import { afterLeaseChange, tallyText } from './data';

/**
 * New lease — the move-in flow, in one dialog.
 *
 * Defaults it reads: `unitId`, `propertyId`, `applicationId`, `startDate`,
 * `rent`, `deposit`, `tenantName`, `tenantEmail`, `tenantPhone`, `tenantId`.
 *
 * Choosing a unit fills rent and deposit from the unit and starts the lease
 * the day after the current household leaves. Overlapping leases are checked
 * as you type. It ends as a draft, a lease sent for signature, or — for a
 * lease already signed on paper — an active lease with its move-in charges posted.
 */

type Role = (typeof LEASE_TENANT_ROLES)[number];
type Person = { key: number; tenantId: string | null; name: string; email: string; phone: string; role: Role };
type Extra = { key: number; accountId: string | null; description: string; amount: number | null };
type Next = 'draft' | 'send' | 'activate';
type Conflict = NonNullable<Extract<CreateLeaseStaffOutputType, { conflicts: unknown }>['conflicts']>[number];

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const numOr = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const EXTRA_PRESETS = [
  { key: 'pet_income', description: 'Pet rent', amount: 35 },
  { key: 'parking_income', description: 'Parking', amount: 75 },
  { key: 'utility_income', description: 'Water, sewer & trash', amount: 65 },
] as const;

export default function NewLeaseDialog({ open, onOpenChange, defaults = {} }: CreateDialogProps) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = useRef(1);
  const nextKey = () => key.current++;
  const firstOfNextMonth = periodStart(addPeriods(periodOf(ws.today), 1));

  const suggestedStart = (unitId: string | null) => {
    const u = unitId ? ws.unitById.get(unitId) : undefined;
    if (u?.moveOutDate) return addDayStr(u.moveOutDate, 1 as number);
    if (u?.currentLeaseId && u.leaseEnd && u.leaseEnd >= ws.today) return addDayStr(u.leaseEnd, 1);
    if (u?.availableOn && u.availableOn > firstOfNextMonth) return u.availableOn;
    return firstOfNextMonth;
  };

  const [unitId, setUnitId] = useState<string | null>(null);
  const [leaseType, setLeaseType] = useState<'Fixed term' | 'Month-to-month'>('Fixed term');
  const [start, setStart] = useState<string | null>(firstOfNextMonth);
  const [months, setMonths] = useState<number | null>(12);
  const [end, setEnd] = useState<string | null>(defaultEndDate(firstOfNextMonth, 12));
  const [rent, setRent] = useState<number | null>(null);
  const [deposit, setDeposit] = useState<number | null>(null);
  const [dueDay, setDueDay] = useState<number | null>(ws.settings.rentDueDay || 1);
  const [people, setPeople] = useState<Person[]>([]);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [next, setNext] = useState<Next>('send');
  const [welcome, setWelcome] = useState(true);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [pending, setPending] = useState(false);
  const touched = useRef({ start: false, end: false, rent: false, deposit: false });

  useEffect(() => {
    if (!open) return;
    const u = str(defaults.unitId);
    const s = str(defaults.startDate) ?? suggestedStart(u);
    const unit = u ? ws.unitById.get(u) : undefined;
    touched.current = { start: Boolean(defaults.startDate), end: false, rent: defaults.rent != null, deposit: defaults.deposit != null };
    setUnitId(u);
    setLeaseType('Fixed term');
    setStart(s);
    setMonths(12);
    setEnd(defaultEndDate(s, 12));
    setRent(numOr(defaults.rent) ?? (unit?.marketRent || null));
    setDeposit(numOr(defaults.deposit) ?? (unit ? unit.depositAmount || unit.marketRent || null : null));
    setDueDay(ws.settings.rentDueDay || 1);
    const tenantId = str(defaults.tenantId);
    const name = str(defaults.tenantName);
    setPeople(tenantId || name ? [{ key: nextKey(), tenantId, name: name ?? '', email: str(defaults.tenantEmail) ?? '', phone: str(defaults.tenantPhone) ?? '', role: 'Primary' }] : [{ key: nextKey(), tenantId: null, name: '', email: '', phone: '', role: 'Primary' }]);
    setExtras([]);
    setNext('send');
    setWelcome(Boolean(ws.templates.find(t => t.trigger === 'Welcome')?.enabled));
    setErrors({});
  }, [open]);

  // A tenant passed by id without a name: look the name up.
  const nameless = people.find(p => p.tenantId && !p.name);
  const { data: namedTenant } = useQuery({ queryKey: ['residents', 'detail', nameless?.tenantId], queryFn: () => getResident({ id: nameless!.tenantId! }), enabled: open && Boolean(nameless) });
  useEffect(() => {
    if (namedTenant) setPeople(ps => ps.map(p => (p.tenantId === namedTenant.tenant.id && !p.name ? { ...p, name: namedTenant.tenant.name, email: namedTenant.tenant.email, phone: namedTenant.tenant.phone } : p)));
  }, [namedTenant]);

  const unit = unitId ? ws.unitById.get(unitId) : undefined;
  const clear = (k: string) => errors[k] && setErrors(e => ({ ...e, [k]: undefined }));

  const chooseUnit = (id: string | null) => {
    setUnitId(id);
    clear('unit');
    const u = id ? ws.unitById.get(id) : undefined;
    if (!u) return;
    if (!touched.current.rent) setRent(u.marketRent || null);
    if (!touched.current.deposit) setDeposit(u.depositAmount || u.marketRent || null);
    if (!touched.current.start) {
      const s = suggestedStart(id);
      setStart(s);
      if (!touched.current.end && months) setEnd(defaultEndDate(s, months));
    }
  };

  // ── Overlap check, as the unit and dates change ──
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  useEffect(() => {
    setConflicts([]);
    if (!open || !unitId || !start) return;
    const endForCheck = leaseType === 'Month-to-month' ? null : end;
    const t = window.setTimeout(() => {
      createLeaseStaff({ action: 'check', unitId, startDate: start, endDate: endForCheck })
        .then(res => 'conflicts' in res && setConflicts(res.conflicts ?? []))
        .catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(t);
  }, [open, unitId, start, end, leaseType]);

  const prorated = start && rent && start.slice(8, 10) !== '01' ? prorateToMonthEnd(rent, start) : 0;
  const firstFull = start ? (start.endsWith('-01') ? start : periodStart(addPeriods(periodOf(start), 1))) : null;
  const extrasTotal = extras.reduce((s, x) => s + (x.amount ?? 0), 0);

  const setPerson = (k: number, patch: Partial<Person>) => {
    setPeople(ps => {
      let next = ps.map(p => (p.key === k ? { ...p, ...patch } : p));
      // One primary resident: making someone primary makes the previous one a co-tenant.
      if (patch.role === 'Primary') next = next.map(p => (p.key !== k && p.role === 'Primary' ? { ...p, role: 'Co-tenant' } : p));
      return next;
    });
    clear('people');
  };
  const addExisting = (hit: { id: string; label: string; sublabel: string } | null) => {
    if (!hit) return;
    if (people.some(p => p.tenantId === hit.id)) return toast.info(`${hit.label} is already on this lease`);
    setPeople(ps => {
      const blank = ps.find(p => !p.tenantId && !p.name.trim() && !p.email.trim());
      const role: Role = ps.some(p => p.role === 'Primary' && p !== blank) ? 'Co-tenant' : 'Primary';
      const person: Person = { key: nextKey(), tenantId: hit.id, name: hit.label, email: hit.sublabel.split(' · ').find(s => s.includes('@')) ?? '', phone: '', role };
      return blank ? ps.map(p => (p === blank ? person : p)) : [...ps, person];
    });
    clear('people');
  };

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!unitId) e.unit = 'Choose the unit.';
    if (!start) e.start = 'Choose the start date.';
    if (leaseType === 'Fixed term' && !end) e.end = 'Choose the end date.';
    if (start && end && leaseType === 'Fixed term' && end < start) e.end = 'The lease can’t end before it starts.';
    if (!rent || rent <= 0) e.rent = 'Enter the monthly rent.';
    if (deposit != null && deposit < 0) e.deposit = 'The deposit can’t be negative.';
    const filled = people.filter(p => p.tenantId || p.name.trim() || p.email.trim());
    if (!filled.length) e.people = 'Add at least one resident.';
    else if (filled.some(p => !p.tenantId && !p.name.trim())) e.people = 'Every new resident needs a name.';
    else if (filled.some(p => !p.tenantId && p.email.trim() && !EMAIL.test(p.email.trim()))) e.people = 'One of the email addresses doesn’t look right.';
    else if (!filled.some(p => p.role === 'Primary')) e.people = 'Mark one person as the primary resident.';
    if (extras.some(x => !x.accountId || !x.description.trim() || !x.amount)) e.extras = 'Each extra charge needs an account, a description and an amount.';
    if (conflicts.length) e.unit = 'Another lease covers these dates.';
    if (next === 'send' && !filled.some(p => (p.role === 'Primary' || p.role === 'Co-tenant') && (p.email.trim() || p.tenantId))) e.people = 'Add an email for the primary resident so they can sign, or save as a draft.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setPending(true);
    try {
      const res = await createLeaseStaff({
        action: 'create',
        unitId: unitId!,
        leaseType,
        startDate: start!,
        endDate: leaseType === 'Month-to-month' ? null : end,
        rent: rent!,
        deposit: deposit ?? 0,
        rentDueDay: dueDay ?? undefined,
        tenants: filled.map(p => ({ tenantId: p.tenantId, name: p.name.trim() || undefined, email: p.tenantId ? undefined : p.email.trim() || undefined, phone: p.tenantId ? undefined : p.phone.trim() || undefined, role: p.role })),
        recurringCharges: extras.map(x => ({ accountId: x.accountId!, description: x.description.trim(), amount: x.amount! })),
        next,
        sendWelcome: next === 'activate' ? welcome : undefined,
        applicationId: str(defaults.applicationId),
      });
      if (!('id' in res)) throw new Error('The lease wasn’t created.');
      afterLeaseChange(qc, { money: next === 'activate' });
      const title = next === 'draft' ? `${res.ref} saved as a draft` : next === 'send' ? `${res.ref} sent for signature` : `${res.ref} is active`;
      const description = [res.name, next === 'send' ? tallyText(res.tally, 'Signature request') : next === 'activate' && res.posted ? `${res.posted} move-in ${res.posted === 1 ? 'charge' : 'charges'} posted` : null, res.applicationName ? `${res.applicationName}’s application is marked Leased` : null].filter(Boolean).join(' · ');
      (res.tally?.templateOff ? toast.warning : toast.success)(title, { description, action: { label: 'Open lease', onClick: () => navigate(`/leases/${res.id}`) } });
      onOpenChange(false);
    } catch (err) {
      const msg = errorMessage(err, 'Couldn’t create the lease');
      if (/covers those dates|overlap/i.test(msg)) setErrors({ unit: msg });
      else toast.error(msg);
    } finally {
      setPending(false);
    }
  };

  const submitLabel = next === 'draft' ? 'Save draft' : next === 'send' ? 'Create & send for signature' : 'Create & activate';
  const occupancyHint = unit
    ? unit.currentLeaseId
      ? unit.moveOutDate
        ? `${unit.residentNames.split(',')[0] || 'Current residents'} moving out ${shortDate(unit.moveOutDate)}`
        : `Occupied by ${unit.residentNames || 'current residents'}${unit.leaseEnd ? ` through ${shortDate(unit.leaseEnd)}` : ''}`
      : unit.upcomingLeaseId
        ? 'Has an upcoming lease'
        : `Vacant · ${unit.readiness.toLowerCase()}${unit.marketRent ? ` · asking ${ws.money(unit.marketRent, { cents: false })}` : ''}`
    : undefined;

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New lease" description={str(defaults.applicationId) ? 'From an approved application — the application is marked Leased when this is created.' : undefined} onSubmit={submit} pending={pending} submitLabel={submitLabel} size="xl" disabled={conflicts.length > 0}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ── Terms ── */}
        <div className="space-y-4">
          <Field label="Unit" error={errors.unit} hint={!errors.unit ? occupancyHint : undefined}>
            <UnitPicker
              value={unitId}
              onChange={id => chooseUnit(id)}
              trigger={
                <FieldButton data-autofocus placeholder="Find a unit" invalid={Boolean(errors.unit)} icon={unit ? <OccupancyGlyph occupancy={unit.occupancy} /> : <Building2 className="h-3.5 w-3.5 text-muted-foreground" />}>
                  {unit ? ws.unitLabel(unit.id) : null}
                </FieldButton>
              }
            />
          </Field>
          {conflicts.length > 0 && (
            <div role="alert" className="flex gap-2 rounded-md border border-tone-danger/30 bg-tone-danger/[0.05] px-3 py-2 text-[14px]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-tone-danger" />
              <div>
                {conflicts.map(c => (
                  <p key={c.id}>
                    <span className="font-medium">{c.ref} · {c.name}</span> {c.status === 'Pending signature' ? 'is waiting for signatures and' : ''} covers these dates
                    {c.moveOutDate ? <> — they move out {fullDate(c.moveOutDate)}. Start on or after {fullDate(addDayStr(c.moveOutDate, 1))}.</> : c.status === 'Active' ? <>. Record their notice and move-out date first.</> : c.startDate ? <> from {fullDate(c.startDate)}.</> : '.'}
                  </p>
                ))}
              </div>
            </div>
          )}

          <Field label="Lease type">
            <Segmented value={leaseType} onChange={v => setLeaseType(v as 'Fixed term' | 'Month-to-month')} options={[{ value: 'Fixed term', label: 'Fixed term' }, { value: 'Month-to-month', label: 'Month-to-month' }]} />
          </Field>
          <FieldRow cols={leaseType === 'Fixed term' ? 3 : 2}>
            <Field label="Starts" error={errors.start}>
              <DateInput
                value={start}
                onChange={v => {
                  touched.current.start = true;
                  setStart(v);
                  clear('start');
                  if (v && !touched.current.end && months) setEnd(defaultEndDate(v, months));
                }}
                invalid={Boolean(errors.start)}
              />
            </Field>
            {leaseType === 'Fixed term' && (
              <Field label="Term">
                <NumberInput
                  value={months}
                  onChange={m => {
                    setMonths(m);
                    if (m && start && m > 0 && m <= 120) {
                      touched.current.end = false;
                      setEnd(defaultEndDate(start, m));
                    }
                  }}
                  min={1}
                  max={120}
                  suffix="months"
                />
              </Field>
            )}
            {leaseType === 'Fixed term' ? (
              <Field label="Ends" error={errors.end}>
                <DateInput value={end} onChange={v => { touched.current.end = true; setEnd(v); clear('end'); }} min={start ?? undefined} invalid={Boolean(errors.end)} />
              </Field>
            ) : (
              <Field label="Rent due" hint="Day of the month">
                <NumberInput value={dueDay} onChange={setDueDay} min={1} max={28} />
              </Field>
            )}
          </FieldRow>
          <FieldRow cols={leaseType === 'Fixed term' ? 3 : 2}>
            <Field label="Monthly rent" error={errors.rent}>
              <MoneyInput value={rent} onChange={v => { touched.current.rent = true; setRent(v); clear('rent'); }} invalid={Boolean(errors.rent)} />
            </Field>
            <Field label="Security deposit" error={errors.deposit}>
              <MoneyInput value={deposit} onChange={v => { touched.current.deposit = true; setDeposit(v); clear('deposit'); }} />
            </Field>
            {leaseType === 'Fixed term' && (
              <Field label="Rent due" hint="Day of the month">
                <NumberInput value={dueDay} onChange={setDueDay} min={1} max={28} />
              </Field>
            )}
          </FieldRow>

          <div>
            <div className="mb-1.5 space-y-1.5">
              <span className="block text-[13.5px] font-medium text-foreground/90">Extra monthly charges <span className="font-normal text-muted-foreground">(optional)</span></span>
              <div className="flex flex-wrap gap-1">
                {EXTRA_PRESETS.map(p => (
                  <button key={p.description} type="button" className="chip hover:bg-accent" onClick={() => setExtras(x => [...x, { key: nextKey(), accountId: ws.accountByKey.get(p.key)?.id ?? null, description: p.description, amount: p.amount }])}>
                    <Plus className="h-3 w-3" /> {p.description}
                  </button>
                ))}
                <button type="button" className="chip hover:bg-accent" onClick={() => setExtras(x => [...x, { key: nextKey(), accountId: ws.accountByKey.get('other_income')?.id ?? null, description: '', amount: null }])}><Plus className="h-3 w-3" /> Other</button>
              </div>
            </div>
            {extras.length > 0 && (
              <div className="space-y-2">
                {extras.map(x => {
                  const account = x.accountId ? ws.accountById.get(x.accountId) : undefined;
                  return (
                    <div key={x.key} className="grid grid-cols-[minmax(0,1fr)_120px_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_170px_120px_auto]">
                      <TextInput value={x.description} onChange={e => setExtras(xs => xs.map(y => (y.key === x.key ? { ...y, description: e.target.value } : y)))} placeholder="Description" maxLength={120} aria-label="Charge description" />
                      <div className="hidden sm:block">
                        <AccountPicker kind="charge" value={x.accountId} onChange={id => setExtras(xs => xs.map(y => (y.key === x.key ? { ...y, accountId: id } : y)))} trigger={<FieldButton icon={<Receipt className="h-3.5 w-3.5 text-muted-foreground" />} className="text-[13.5px]">{account?.name}</FieldButton>} />
                      </div>
                      <MoneyInput value={x.amount} onChange={v => setExtras(xs => xs.map(y => (y.key === x.key ? { ...y, amount: v } : y)))} />
                      <IconButton aria-label="Remove charge" onClick={() => setExtras(xs => xs.filter(y => y.key !== x.key))} className="self-center"><X /></IconButton>
                    </div>
                  );
                })}
              </div>
            )}
            {errors.extras && <p role="alert" className="mt-1 text-sm text-tone-danger">{errors.extras}</p>}
          </div>
        </div>

        {/* ── People and what happens ── */}
        <div className="space-y-4 lg:border-l lg:pl-6">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[13.5px] font-medium text-foreground/90">Residents</span>
              <div className="flex items-center gap-1">
                <RecordSearchPicker
                  kinds={['tenants']}
                  value={null}
                  onChange={addExisting}
                  placeholder="Search residents…"
                  align="end"
                  width={300}
                  trigger={<button type="button" className="ghost-chip h-8 text-sm"><Search className="h-3.5 w-3.5" /> Existing</button>}
                />
                <button type="button" className="ghost-chip h-8 text-sm" onClick={() => setPeople(ps => [...ps, { key: nextKey(), tenantId: null, name: '', email: '', phone: '', role: ps.some(p => p.role === 'Primary') ? 'Co-tenant' : 'Primary' }])}>
                  <UserPlus className="h-3.5 w-3.5" /> New
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {people.map(p => (
                <div key={p.key} className={cn('rounded-lg border bg-card p-2.5', errors.people && !p.tenantId && !p.name.trim() && 'border-tone-danger/60')}>
                  <div className="flex items-center gap-2">
                    {p.tenantId ? (
                      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{p.name || 'Loading…'} <span className="text-sm font-normal text-muted-foreground">existing</span></span>
                    ) : (
                      <TextInput value={p.name} onChange={e => setPerson(p.key, { name: e.target.value })} placeholder="Full name" maxLength={120} aria-label="Resident name" className="h-9 flex-1" />
                    )}
                    <ChoicePicker options={LEASE_TENANT_ROLES} value={p.role} onChange={v => setPerson(p.key, { role: v as Role })} align="end" trigger={<button type="button" className="ghost-chip h-8 shrink-0 text-sm">{p.role}</button>} />
                    {people.length > 1 && <IconButton size="sm" aria-label={`Remove ${p.name || 'resident'}`} onClick={() => setPeople(ps => ps.filter(x => x.key !== p.key))}><X /></IconButton>}
                  </div>
                  {!p.tenantId && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <TextInput type="email" value={p.email} onChange={e => setPerson(p.key, { email: e.target.value })} placeholder="Email" maxLength={200} aria-label="Resident email" className="h-9" />
                      <TextInput value={p.phone} onChange={e => setPerson(p.key, { phone: e.target.value })} placeholder="Phone" maxLength={40} aria-label="Resident phone" className="h-9" />
                    </div>
                  )}
                  {p.tenantId && p.email && <p className="mt-0.5 truncate text-sm text-muted-foreground">{p.email}</p>}
                </div>
              ))}
            </div>
            {errors.people ? <p role="alert" className="mt-1.5 text-sm text-tone-danger">{errors.people}</p> : <p className="mt-1.5 text-sm text-muted-foreground">Primary and co-tenants sign. Someone with an existing email is matched to their record.</p>}
          </div>

          <div className="overflow-hidden rounded-lg border text-[14px]">
            <div className="border-b bg-subtle/60 px-3 py-1.5 text-sm font-medium text-muted-foreground">On activation</div>
            <ul className="divide-y">
              <li className="flex h-9 items-center justify-between px-3"><span>Security deposit</span><Money value={deposit ?? 0} muted0 /></li>
              {prorated > 0 && start && <li className="flex h-9 items-center justify-between px-3"><span className="truncate">Prorated rent {shortDate(start)}–month end</span><Money value={prorated} /></li>}
              <li className="flex min-h-10 items-center justify-between gap-2 px-3 py-1">
                <span className="min-w-0">
                  <span className="block truncate">Then every month</span>
                  <span className="block truncate text-sm text-muted-foreground">{firstFull ? `From ${shortDate(firstFull)}, ` : ''}due the {ordinal(dueDay || 1)}{extrasTotal ? ` · includes ${ws.money(extrasTotal)} extras` : ''}</span>
                </span>
                <Money value={(rent ?? 0) + extrasTotal} className="font-medium" />
              </li>
            </ul>
          </div>

          <div>
            <span className="mb-1.5 block text-[13.5px] font-medium text-foreground/90">When you create it</span>
            <div className="space-y-1.5">
              {([
                { value: 'send', label: 'Send for signature', hint: 'Signers get an email to sign in the portal. Countersign when they’re done.' },
                { value: 'draft', label: 'Save as a draft', hint: 'Nothing is sent or billed. Finish it later.' },
                { value: 'activate', label: 'Activate now', hint: 'Already signed on paper: posts the deposit and first month.' },
              ] as const).map(o => (
                <label key={o.value} className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors', next === o.value ? 'border-primary/50 bg-primary/[0.05]' : 'hover:bg-accent/40')}>
                  <input type="radio" name="lease-next" value={o.value} checked={next === o.value} onChange={() => setNext(o.value)} className="mt-0.5 accent-[hsl(var(--primary))]" />
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium">{o.label}</span>
                    <span className="block text-sm text-muted-foreground">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {next === 'activate' && (
              <div className="mt-2 rounded-lg border px-3 py-1">
                <SwitchRow label="Send the Welcome email" checked={welcome} onChange={setWelcome} disabled={!ws.templates.find(t => t.trigger === 'Welcome')?.enabled} description={ws.templates.find(t => t.trigger === 'Welcome')?.enabled ? undefined : 'The Welcome template is switched off.'} />
              </div>
            )}
          </div>
        </div>
      </div>
    </FormDialog>
  );
}
