import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, FileCheck2, FileUp, Hammer, Landmark, Mail, MapPin, Phone, Receipt, Send, ShieldAlert, Star, UserRound } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { messageVendor } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { Switch } from '@project/components/ui/switch';
import { VENDOR_TRADES } from '@project/shared/constants';
import { workOrderRef } from '@project/shared/leases';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { fullDate, shortDate, telHref, timeAgo } from '../../lib/format';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { InlineTabs, RailRow, RailSection, SectionHeading } from '../detail/DetailLayout';
import { DocumentsPanel } from '../detail/DocumentsPanel';
import { Composer, Timeline } from '../detail/Timeline';
import { DateInput } from '../form/fields';
import { DataTable, type Column } from '../list/DataTable';
import { AccountPicker, ChoicePicker } from '../pickers/pickers';
import { EmptyState } from '../primitives/bits';
import { Money, StatTile } from '../primitives/data';
import { Pill, PropertySwatch } from '../primitives/glyphs';
import { WorkOrdersView } from '../workOrders/WorkOrdersView';
import { InsurancePill, VendorGlyph } from './bits';
import { CertificateDialog } from './CertificateDialog';
import { mk, useVendorActions, type VendorDetail as Detail } from './data';

const chip = 'ghost-chip h-8 max-w-full justify-start gap-1.5 px-1.5 text-[14px] [&_svg]:shrink-0';

export type VendorTab = 'work' | 'money' | 'documents' | 'messages' | 'activity';

/** Tabs this person can open: work orders need `maintenance.create`, money needs `accounting.view`. */
export function availableVendorTabs(can: (c: 'maintenance.create') => boolean, canSeeMoney: boolean): VendorTab[] {
  return [...(can('maintenance.create') ? (['work'] as const) : []), ...(canSeeMoney ? (['money'] as const) : []), 'documents', 'messages', 'activity'];
}

/** A value in the rail that becomes a field on click; Enter or blur saves, Esc cancels. */
function InlineValue({ value, display, placeholder, onSave, inputMode, maxLength, parse = v => v, disabled }: {
  value: string;
  display?: ReactNode;
  placeholder: string;
  onSave: (v: string) => void;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email';
  maxLength?: number;
  parse?: (v: string) => string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  if (!editing || disabled) {
    return (
      <button type="button" disabled={disabled} onClick={() => { setText(value); setEditing(true); }} className={cn(chip, 'min-w-0')}>
        {value ? display ?? <span className="truncate">{value}</span> : <span className="text-muted-foreground">{placeholder}</span>}
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    const next = parse(text.trim());
    if (next !== value) onSave(next);
  };
  return (
    <input
      autoFocus
      value={text}
      inputMode={inputMode}
      maxLength={maxLength}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(value);
          setEditing(false);
        }
      }}
      placeholder={placeholder}
      className="field h-8 w-full"
    />
  );
}

/** The properties rail: contact, billing, compliance and portal access, each editable in place. */
export function VendorRail({ detail }: { detail: Detail }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const { update } = useVendorActions();
  const v = detail.vendor;
  const [coiOpen, setCoiOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const account = v.defaultAccountId ? ws.accountById.get(v.defaultAccountId) : undefined;
  const patch = (p: Parameters<typeof update>[1], message?: string) => void update(v.id, p, { toast: message }).catch(() => undefined);
  const inactive = v.status === 'Inactive';

  const invite = async () => {
    const ok = await app.confirm({
      title: `Invite ${v.contactName || v.name} to the vendor portal?`,
      description: `We’ll email ${v.email} with how to sign in${detail.portalLinked ? ' and a link to the portal' : '. The portal’s web address isn’t known yet, so the email won’t include a link — open the portal app once to fix that'}. ${v.portalEnabled ? '' : 'Portal access is turned on.'}`.trim(),
      confirmLabel: 'Send invitation',
    });
    if (!ok) return;
    setInviting(true);
    try {
      const res = await messageVendor({ mode: 'invite', vendorId: v.id });
      invalidate(qc, 'vendors', 'bootstrap', 'messages');
      if (res.delivery === 'Failed') toast.error('The invitation couldn’t be emailed', { description: 'Check the email address. Portal access is on, so they can still sign in.' });
      else toast.success(`Invitation sent to ${v.email}`);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t send the invitation'));
    } finally {
      setInviting(false);
    }
  };

  return (
    <>
      <RailSection title="Contact" action={<button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => app.openCreate('vendor', { vendorId: v.id })}>Edit</button>}>
        <RailRow label="Contact"><InlineValue value={v.contactName} placeholder="Add a contact" onSave={contactName => patch({ contactName })} display={<><UserRound className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{v.contactName}</span></>} maxLength={200} /></RailRow>
        <RailRow label="Phone">
          {v.phone ? (
            <a href={telHref(v.phone)} className={chip}><Phone className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{v.phone}</span></a>
          ) : (
            <InlineValue value="" placeholder="Add a phone" inputMode="tel" onSave={phone => patch({ phone })} maxLength={40} />
          )}
        </RailRow>
        <RailRow label="Email">
          {v.email ? (
            <a href={`mailto:${v.email}`} className={chip}><Mail className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{v.email}</span></a>
          ) : (
            <InlineValue value="" placeholder="Add an email" inputMode="email" onSave={email => patch({ email })} maxLength={200} />
          )}
        </RailRow>
        {v.address && (
          <p className="flex items-start gap-1.5 px-1.5 pt-1 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" /> <span className="whitespace-pre-line break-words">{v.address}</span>
          </p>
        )}
      </RailSection>

      <RailSection title="Billing">
        <RailRow label="Trade">
          <ChoicePicker options={VENDOR_TRADES} value={v.trade as (typeof VENDOR_TRADES)[number]} onChange={trade => patch({ trade })} align="end" trigger={<button type="button" className={chip}><Hammer className="h-3.5 w-3.5 text-muted-foreground" /> {v.trade}</button>} />
        </RailRow>
        <RailRow label="Terms">
          <InlineValue
            value={v.paymentTermsDays != null ? String(v.paymentTermsDays) : ''}
            display={<span>Net {v.paymentTermsDays}</span>}
            placeholder="Set terms"
            inputMode="numeric"
            parse={s => s.replace(/\D/g, '').slice(0, 3)}
            onSave={s => patch({ paymentTermsDays: s ? Math.min(365, Number(s)) : null })}
          />
        </RailRow>
        <RailRow label="Expense acct">
          <AccountPicker kind="expense" value={v.defaultAccountId} onChange={defaultAccountId => patch({ defaultAccountId })} align="end" trigger={<button type="button" className={chip}><Landmark className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{account ? account.name : <span className="text-muted-foreground">Choose account</span>}</span></button>} />
        </RailRow>
        <RailRow label="Hourly rate">
          <InlineValue value={v.hourlyRate != null ? String(v.hourlyRate) : ''} display={<Money value={v.hourlyRate} />} placeholder="Add a rate" inputMode="decimal" parse={s => s.replace(/[^0-9.]/g, '')} onSave={s => patch({ hourlyRate: s && Number.isFinite(Number(s)) ? Number(s) : null })} />
        </RailRow>
        <RailRow label="Rating">
          <InlineValue value={v.rating != null ? String(v.rating) : ''} display={<span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-current text-tone-warning" /> {v.rating?.toFixed(1)} <span className="text-muted-foreground">/ 5</span></span>} placeholder="Rate 0–5" inputMode="decimal" parse={s => s.replace(/[^0-9.]/g, '')} onSave={s => { const n = Number(s); patch({ rating: s && Number.isFinite(n) ? Math.max(0, Math.min(5, Math.round(n * 10) / 10)) : null }); }} />
        </RailRow>
      </RailSection>

      <RailSection title="Compliance">
        <RailRow label="Insurance">
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <button type="button" className={chip} aria-label="Change insurance expiration">
                {v.compliance.insurance === 'Not required' && !v.insuranceExpiresOn ? <span className="text-muted-foreground">Not required</span> : <InsurancePill status={v.compliance.insurance} expiresOn={v.insuranceExpiresOn} />}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3">
              <p className="mb-2 text-sm font-medium">Certificate expires</p>
              <DateInput value={v.insuranceExpiresOn} onChange={d => { setDateOpen(false); patch({ insuranceExpiresOn: d }, d ? `Insurance expiration set to ${shortDate(d)}` : 'Insurance expiration cleared'); }} />
              <div className="mt-2 flex items-center justify-between">
                {v.insuranceExpiresOn ? <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => { setDateOpen(false); patch({ insuranceExpiresOn: null }, 'Insurance expiration cleared'); }}>Clear</button> : <span />}
                <button type="button" className="text-sm text-primary hover:underline" onClick={() => { setDateOpen(false); setCoiOpen(true); }}>Upload certificate…</button>
              </div>
            </PopoverContent>
          </Popover>
        </RailRow>
        <RailRow label="Certificate">
          {detail.certificate ? (
            <a href={detail.certificate.url} target="_blank" rel="noreferrer" className={chip} title={detail.certificate.name}><FileCheck2 className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{detail.certificate.expiresOn ? `Exp. ${shortDate(detail.certificate.expiresOn)}` : 'On file'}</span></a>
          ) : (
            <button type="button" className={chip} onClick={() => setCoiOpen(true)}><FileUp className="h-3.5 w-3.5 text-muted-foreground" /> <span className="text-muted-foreground">Upload COI</span></button>
          )}
        </RailRow>
        <RailRow label="W-9 on file">
          <label className="flex h-8 cursor-pointer items-center gap-2 px-1.5 text-[14px]">
            <Switch checked={v.w9OnFile} onCheckedChange={w9OnFile => patch({ w9OnFile }, w9OnFile ? 'W-9 marked on file' : 'W-9 marked missing')} className="scale-90" aria-label="W-9 on file" />
            <span className={cn(v.compliance.w9Missing && 'text-tone-warning')}>{v.w9OnFile ? 'Yes' : v.is1099 ? 'Missing' : 'No'}</span>
          </label>
        </RailRow>
        <RailRow label="1099">
          <label className="flex h-8 cursor-pointer items-center gap-2 px-1.5 text-[14px]">
            <Switch checked={v.is1099} onCheckedChange={is1099 => patch({ is1099 })} className="scale-90" aria-label="Issue a 1099" />
            <span>{v.is1099 ? 'Issue a 1099' : 'No 1099'}</span>
          </label>
        </RailRow>
        <RailRow label="Tax ID">
          <InlineValue value={v.taxIdLast4} display={<span className="num">•••• {v.taxIdLast4}</span>} placeholder="Last 4 digits" inputMode="numeric" maxLength={4} parse={s => s.replace(/\D/g, '').slice(0, 4)} onSave={taxIdLast4 => (taxIdLast4.length === 4 || !taxIdLast4 ? patch({ taxIdLast4 }) : toast.error('Enter all four digits.'))} />
        </RailRow>
        <RailRow label="License">
          <InlineValue value={v.licenseNumber} placeholder="Add a license" maxLength={80} onSave={licenseNumber => patch({ licenseNumber })} />
        </RailRow>
      </RailSection>

      <RailSection title="Vendor portal">
        <RailRow label="Access">
          <label className="flex h-8 cursor-pointer items-center gap-2 px-1.5 text-[14px]">
            <Switch checked={v.portalEnabled} disabled={inactive} onCheckedChange={portalEnabled => patch({ portalEnabled }, portalEnabled ? 'Portal access turned on' : 'Portal access turned off')} className="scale-90" aria-label="Portal access" />
            <span className={cn(inactive && 'text-muted-foreground')}>{inactive ? 'Off while inactive' : v.portalEnabled ? 'Can sign in' : 'Off'}</span>
          </label>
        </RailRow>
        {!inactive && (
          <button type="button" disabled={inviting || !v.email} onClick={() => void invite()} className={cn(chip, 'mt-1 text-muted-foreground hover:text-foreground disabled:opacity-50')}>
            <Send className="h-3.5 w-3.5" /> {inviting ? 'Sending…' : v.email ? 'Invite to portal' : 'Add an email to invite'}
          </button>
        )}
      </RailSection>

      {v.notes && (
        <RailSection title="Notes">
          <p className="whitespace-pre-line break-words px-1.5 text-[14px] text-foreground/85">{v.notes}</p>
        </RailSection>
      )}

      <CertificateDialog open={coiOpen} onOpenChange={setCoiOpen} vendor={v} />
    </>
  );
}

type Txn = Detail['bills'][number];

export function VendorMain({ detail, tab, setTab, quickActions }: { detail: Detail; tab: VendorTab; setTab: (t: VendorTab) => void; quickActions?: ReactNode }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { update } = useVendorActions();
  const v = detail.vendor;
  const c = v.compliance;
  const [coiOpen, setCoiOpen] = useState(false);
  const inactive = v.status === 'Inactive';
  const unread = v.unreadMessages;

  useEffect(() => {
    if (tab !== 'messages' || unread === 0) return;
    void messageVendor({ mode: 'read', vendorId: v.id })
      .then(() => {
        qc.setQueryData<Detail>(mk.vendor(v.id), old => (old ? { ...old, vendor: { ...old.vendor, unreadMessages: 0 } } : old));
        invalidate(qc, 'bootstrap', 'inbox', 'messages');
      })
      .catch(() => undefined);
  }, [tab, v.id, unread]);

  const send = async ({ body }: { mode: string; body: string }) => {
    try {
      const res = await messageVendor({ mode: 'message', vendorId: v.id, body });
      await qc.invalidateQueries({ queryKey: mk.vendor(v.id) });
      invalidate(qc, 'messages', 'inbox');
      if (res.delivery === 'Failed') toast.error('Saved, but the email couldn’t be delivered', { description: v.portalEnabled ? 'They’ll see it in the vendor portal.' : 'Check their email address.' });
      else toast.success('Message sent');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t send the message'));
      throw e;
    }
  };

  const billColumns: Column<Txn>[] = [
    { key: 'number', header: '#', width: 64, cell: t => <span className="tabular-nums text-muted-foreground">{t.number}</span>, sort: t => t.number },
    { key: 'date', header: 'Date', cell: t => fullDate(t.date), sort: t => t.date, hideBelow: 'sm' },
    { key: 'description', header: 'For', cell: t => (
      <span className="flex min-w-0 items-center gap-1.5">
        {t.propertyId && <PropertySwatch color={ws.propertyById.get(t.propertyId)?.color} />}
        <span className="truncate">{t.description || t.reference || 'Bill'}</span>
        {t.workOrderNumber && <Link to={`/work-orders/${t.workOrderNumber}`} onClick={e => e.stopPropagation()} className="shrink-0 text-sm text-muted-foreground hover:text-foreground hover:underline">{workOrderRef(t.workOrderNumber)}</Link>}
      </span>
    ), className: 'max-w-[280px]' },
    { key: 'due', header: 'Due', cell: t => (t.status === 'Void' ? <Pill>Void</Pill> : t.open > 0.005 ? <span className={cn(t.dueDate && t.dueDate < ws.today && 'text-tone-danger')}>{shortDate(t.dueDate)}</span> : <span className="text-muted-foreground">Paid</span>), sort: t => t.dueDate, hideBelow: 'md' },
    { key: 'amount', header: 'Amount', align: 'right', cell: t => <Money value={t.amount} className={cn(t.status === 'Void' && 'text-muted-foreground line-through')} />, sort: t => t.amount },
    { key: 'open', header: 'Open', align: 'right', cell: t => <Money value={t.status === 'Void' ? 0 : t.open} muted0 />, sort: t => t.open, footer: <Money value={detail.bills.reduce((s, t) => s + (t.status === 'Void' ? 0 : t.open), 0)} /> },
  ];
  const paymentColumns: Column<Txn>[] = [
    { key: 'date', header: 'Date', cell: t => fullDate(t.date), sort: t => t.date },
    { key: 'kind', header: 'Payment', cell: t => <span className="truncate">{t.kind === 'Expense' ? 'Direct expense' : 'Bill payment'}{t.paymentMethod && <span className="text-muted-foreground"> · {t.paymentMethod}{t.reference ? ` ${t.reference}` : ''}</span>}</span>, className: 'max-w-[280px]' },
    { key: 'description', header: 'Memo', cell: t => <span className="block max-w-[240px] truncate text-muted-foreground">{t.description}</span>, hideBelow: 'md' },
    { key: 'amount', header: 'Amount', align: 'right', cell: t => <Money value={t.amount} className={cn(t.status === 'Void' && 'text-muted-foreground line-through')} />, sort: t => t.amount },
  ];

  const tabs = [
    ...(ws.can('maintenance.create') ? [{ value: 'work' as const, label: 'Work orders', count: v.openWorkOrders }] : []),
    ...(detail.canSeeMoney ? [{ value: 'money' as const, label: 'Bills & payments', count: detail.bills.filter(b => b.open > 0.005 && b.status !== 'Void').length }] : []),
    { value: 'documents' as const, label: 'Documents' },
    { value: 'messages' as const, label: 'Messages', count: unread },
    { value: 'activity' as const, label: 'Activity' },
  ];

  return (
    <div>
      <div className="flex items-start gap-3">
        <VendorGlyph name={v.name} color={v.color} size={36} className="mt-0.5 text-[17px]" />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-x-2 text-[22px] font-semibold leading-8 tracking-tight">
            <span className="break-words">{v.name}</span>
            {inactive && <Pill className="align-middle">Inactive</Pill>}
          </h1>
          <p className="text-[14px] text-muted-foreground">
            {v.trade}
            {v.contactName && ` · ${v.contactName}`}
            {v.lastWorkAt && ` · last job ${timeAgo(v.lastWorkAt)}`}
          </p>
        </div>
      </div>

      {quickActions}

      {(c.insurance === 'Expired' || c.insurance === 'Missing' || c.insurance === 'Expiring') && !inactive && (
        <div className={cn('mt-5 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3', c.insurance === 'Expiring' ? 'border-tone-warning/30 bg-tone-warning/[0.06]' : 'border-tone-danger/25 bg-tone-danger/[0.05]')}>
          <ShieldAlert className={cn('h-4 w-4 shrink-0', c.insurance === 'Expiring' ? 'text-tone-warning' : 'text-tone-danger')} />
          <div className="min-w-0 flex-1 text-[14px]">
            <p className="font-medium">
              {c.insurance === 'Missing' ? 'No certificate of insurance on file' : c.insurance === 'Expired' ? `Insurance expired ${shortDate(v.insuranceExpiresOn)}` : `Insurance expires ${shortDate(v.insuranceExpiresOn)}`}
            </p>
            <p className="text-sm text-muted-foreground">{v.openWorkOrders > 0 ? `${v.openWorkOrders} open work ${v.openWorkOrders === 1 ? 'order is' : 'orders are'} assigned to them. ` : ''}Request an updated certificate before assigning more work.</p>
          </div>
          <button type="button" className="ghost-chip h-8 bg-background" onClick={() => setCoiOpen(true)}><FileUp className="h-3.5 w-3.5" /> Upload certificate</button>
        </div>
      )}
      {c.coiPendingReview && c.pendingCoiExpiresOn && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-tone-info/25 bg-tone-info/[0.05] px-4 py-3">
          <CalendarDays className="h-4 w-4 shrink-0 text-tone-info" />
          <p className="min-w-0 flex-1 text-[14px]"><span className="font-medium">A newer certificate is waiting for review.</span> <span className="text-muted-foreground">It expires {shortDate(c.pendingCoiExpiresOn)}. Check it in Documents, then accept the date.</span></p>
          <button type="button" className="ghost-chip h-8 bg-background" onClick={() => setTab('documents')}>View</button>
          <button type="button" className="ghost-chip h-8 bg-background" onClick={() => void update(v.id, { insuranceExpiresOn: c.pendingCoiExpiresOn }, { toast: `Insurance now expires ${shortDate(c.pendingCoiExpiresOn)}` }).catch(() => undefined)}>Accept date</button>
        </div>
      )}
      {c.w9Missing && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5 text-[14px]">
          <FileCheck2 className="h-4 w-4 shrink-0 text-tone-warning" />
          <span className="min-w-0 flex-1">{c.w9PendingReview ? 'They uploaded a W-9. Check it in Documents and mark it on file.' : 'This is a 1099 vendor with no W-9 on file.'}</span>
          {c.w9PendingReview && <button type="button" className="ghost-chip h-8" onClick={() => setTab('documents')}>View</button>}
          <button type="button" className="ghost-chip h-8" onClick={() => void update(v.id, { w9OnFile: true }, { toast: 'W-9 marked on file' }).catch(() => undefined)}>Mark on file</button>
        </div>
      )}

      <div className={cn('mt-5 grid gap-2', detail.canSeeMoney ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3')}>
        <StatTile label="Open work" value={v.openWorkOrders} hint={`${v.totalWorkOrders} all time`} onClick={ws.can('maintenance.create') ? () => setTab('work') : undefined} />
        <StatTile label="Done this year" value={v.completedThisYear} hint={detail.residentRating.count ? <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 fill-current text-tone-warning" /> {detail.residentRating.average?.toFixed(1)} from residents</span> : 'No resident ratings'} />
        {detail.canSeeMoney && <StatTile label="Paid this year" value={<Money value={v.paidThisYear} cents={false} />} hint="Payments and expenses" onClick={() => setTab('money')} />}
        {detail.canSeeMoney ? (
          <StatTile label="Open bills" value={<Money value={v.openBills} cents={false} />} tone={(v.openBills ?? 0) > 0 ? 'warning' : 'default'} hint={v.paymentTermsDays != null ? `Net ${v.paymentTermsDays}` : undefined} onClick={() => setTab('money')} />
        ) : (
          <StatTile label="Schedules" value={detail.activeSchedules} hint="Active recurring jobs" />
        )}
      </div>

      <InlineTabs className="mt-6" value={tab} onChange={t => setTab(t)} tabs={tabs} />

      <div className="mt-4">
        {tab === 'work' && ws.can('maintenance.create') && (
          <div className="flex h-[min(640px,72vh)] min-h-[360px] flex-col overflow-hidden rounded-lg border bg-background">
            <WorkOrdersView
              surfaceKey={`vendor:${v.id}:work-orders`}
              baseFilters={{ vendorIds: [v.id] }}
              lockedFilters={['vendorIds']}
              createDefaults={{ vendorId: v.id }}
              defaults={{ properties: ['priority', 'number', 'location', 'due', 'approval', 'assignee'] }}
              compact
              emptyTitle={`No open work for ${v.name}`}
              emptyDescription={inactive ? 'This vendor is inactive.' : 'Assign them from any work order with V, or create one here.'}
            />
          </div>
        )}

        {tab === 'money' && detail.canSeeMoney && (
          <div>
            <SectionHeading
              className="mt-0"
              count={detail.bills.length}
              action={ws.can('payables.manage') && !inactive && (
                <button type="button" className="ghost-chip h-8 text-sm" onClick={() => app.openCreate('bill', { vendorId: v.id })}><Receipt className="h-3.5 w-3.5" /> Enter bill</button>
              )}
            >
              Bills
            </SectionHeading>
            {detail.bills.length ? (
              <div className="overflow-hidden rounded-lg border">
                <DataTable rows={detail.bills} columns={billColumns} getId={t => t.id} onRowClick={t => navigate(`/accounting/payables/${t.id}`)} stickyHeader={false} caption="Bills" />
              </div>
            ) : (
              <EmptyState className="rounded-lg border py-10" icon={<Receipt />} title="No bills yet" description={ws.can('payables.manage') ? 'Enter a bill when their invoice arrives; it’s paid from Accounting.' : 'Bills from this vendor show up here.'} />
            )}
            <SectionHeading count={detail.payments.length}>Payments</SectionHeading>
            {detail.payments.length ? (
              <div className="overflow-hidden rounded-lg border">
                <DataTable rows={detail.payments} columns={paymentColumns} getId={t => t.id} onRowClick={t => navigate(`/accounting/payables/${t.id}`)} stickyHeader={false} caption="Payments" />
              </div>
            ) : (
              <p className="rounded-lg border px-4 py-6 text-center text-[14px] text-muted-foreground">No payments to {v.name} yet.</p>
            )}
          </div>
        )}

        {tab === 'documents' && <DocumentsPanel scope="vendorId" id={v.id} links={{ vendorId: v.id }} />}

        {tab === 'messages' && (
          <div>
            <p className="mb-3 text-sm text-muted-foreground">Your conversation with {v.name}. Messages about a specific job are on that work order.</p>
            <Timeline activity={[]} messages={detail.messages} emptyText={`No messages with ${v.name} yet.`} />
            {!inactive && ws.can('communications.send') && (
              <Composer
                className="mt-4"
                defaultMode="vendor"
                modes={[{ value: 'vendor', label: `Message ${v.name}`, placeholder: v.email || v.portalEnabled ? `Write to ${v.contactName || v.name}…` : 'Add an email address to message this vendor', hint: v.email ? `Emailed to ${v.email}${v.portalEnabled ? ' and shown in their portal' : ''}.` : v.portalEnabled ? 'Shown in their portal.' : 'They have no email or portal access.' }]}
                onSend={send}
              />
            )}
          </div>
        )}

        {tab === 'activity' && <Timeline activity={detail.activity} newestFirst emptyText="Nothing has happened on this vendor yet." />}
      </div>

      <CertificateDialog open={coiOpen} onOpenChange={setCoiOpen} vendor={v} />
    </div>
  );
}
