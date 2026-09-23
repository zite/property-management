import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CheckCircle2, Download, ExternalLink, FileText, Mail, MoreHorizontal, Phone, Plus, UserMinus, UserRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { updateLease } from 'zitejs/api';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { Switch } from '@project/components/ui/switch';
import { cn } from '@project/components/lib/utils';
import { LEASE_TENANT_ROLES, type LeasePhase } from '@project/shared/constants';
import { termMonths } from '@project/shared/dates';
import { ordinal } from '@project/shared/merge';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { dateTime, fullDate, shortDate, telHref, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { RailRow, RailSection } from '../detail/DetailLayout';
import { OptionPicker } from '../pickers/OptionPicker';
import { Avatar, MemberAvatar } from '../primitives/Avatar';
import { IconButton, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { LeasePhasePill, PropertySwatch } from '../primitives/glyphs';
import { afterLeaseChange, lk, type LeaseDetail } from './data';
import type { LeaseControls } from './LeaseOverview';
import { ExpiryChip, termText } from './LeaseRow';

const chip = 'ghost-chip h-8 max-w-full justify-start gap-1.5 px-1.5 text-[14px] [&_svg]:shrink-0';
const plain = 'flex h-8 min-w-0 items-center gap-1.5 px-1.5 text-[14px]';
const DUE_DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

/** The lease's properties: where, when, how much, and who — editable where the office owns the value. */
export function LeaseRail({ detail, controls }: { detail: LeaseDetail; controls: LeaseControls }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const l = detail.lease;
  const property = l.propertyId ? ws.propertyById.get(l.propertyId) : undefined;
  const unit = l.unitId ? ws.unitById.get(l.unitId) : undefined;
  const closed = l.status === 'Ended' || l.status === 'Canceled';
  const [dueOpen, setDueOpen] = useState(false);
  const months = termMonths(l.startDate, l.endDate);
  const depositShort = l.status === 'Active' && detail.depositHeld + 0.004 < l.deposit && !l.depositSettledAt;

  const patch = async (p: { lateFeeExempt?: boolean; rentDueDay?: number }, success: string) => {
    const key = lk.detail(l.id);
    const prev = qc.getQueryData<LeaseDetail>(key);
    if (prev) qc.setQueryData<LeaseDetail>(key, { ...prev, lease: { ...prev.lease, ...p } });
    try {
      await updateLease({ action: 'patch', leaseId: l.id, patch: p });
      afterLeaseChange(qc);
      toast.success(success);
    } catch (e) {
      if (prev) qc.setQueryData(key, prev);
      toast.error(errorMessage(e, 'Couldn’t update the lease'));
    }
  };

  const person = async (input: { action: 'setRole'; tenantId: string; role: string } | { action: 'removePerson'; tenantId: string }, name: string) => {
    if (input.action === 'removePerson' && !(await app.confirm({ title: `Remove ${name} from the lease?`, description: 'They stay in Residents with their history. Their name comes off this lease and its ledger.', confirmLabel: 'Remove', destructive: true }))) return;
    try {
      const res = input.action === 'setRole' ? await updateLease({ action: 'setRole', leaseId: l.id, tenantId: input.tenantId, role: input.role as 'Primary' }) : await updateLease({ action: 'removePerson', leaseId: l.id, tenantId: input.tenantId });
      afterLeaseChange(qc);
      toast.success(res.message);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t update the people on this lease'));
    }
  };

  return (
    <>
      <RailSection>
        <RailRow label="Phase"><span className={plain}><LeasePhasePill phase={l.phase as LeasePhase} /></span></RailRow>
        <RailRow label="Type"><span className={plain}>{l.leaseType}</span></RailRow>
        <RailRow label="Term">
          <Tip label={l.startDate ? `${fullDate(l.startDate)} – ${l.endDate ? fullDate(l.endDate) : 'month-to-month'}${months ? ` · ${months} months` : ''}` : 'No dates'}>
            <span className={cn(plain, 'tabular-nums')}><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{termText(l)}</span></span>
          </Tip>
        </RailRow>
        {l.status === 'Active' && <RailRow label="Time left"><span className={plain}><ExpiryChip lease={l} className="text-[14px]" /></span></RailRow>}
      </RailSection>

      <RailSection title="Home">
        <RailRow label="Property">
          {property ? <Link to={`/properties/${property.id}`} className={chip}><PropertySwatch color={property.color} /> <span className="truncate">{property.name}</span></Link> : <span className={plain}>—</span>}
        </RailRow>
        <RailRow label="Unit">
          {unit ? <Link to={`/units/${unit.id}`} className={chip}><span className="truncate">{unit.name}</span></Link> : <span className={plain}>—</span>}
        </RailRow>
      </RailSection>

      <RailSection title="Money">
        <RailRow label="Rent"><span className={plain}><Money value={l.rent} className="font-medium" /><span className="text-sm text-muted-foreground">/mo</span></span></RailRow>
        <RailRow label="Deposit">
          <Tip label={depositShort ? `${ws.money(l.deposit - detail.depositHeld)} of the deposit hasn’t been received` : l.depositSettledAt ? `Settled ${fullDate(l.depositSettledAt.slice(0, 10))}` : 'Held in trust for the residents'}>
            <span className={plain}>
              <Money value={detail.depositHeld} className={cn(depositShort && 'text-tone-warning')} />
              <span className="truncate text-sm text-muted-foreground">{depositShort ? <>of <Money value={l.deposit} cents={l.deposit % 1 !== 0} /></> : l.depositSettledAt ? 'settled' : 'held'}</span>
            </span>
          </Tip>
        </RailRow>
        <RailRow label="Balance">
          <Link to={`/leases/${l.id}/ledger`} className={chip}><Money value={detail.balance} tone="balance" className="font-medium" /></Link>
        </RailRow>
        <RailRow label="Rent due">
          {closed ? (
            <span className={plain}>{ordinal(l.rentDueDay)}</span>
          ) : (
            <OptionPicker
              options={DUE_DAYS.map(d => ({ value: String(d), label: `${ordinal(d)} of the month` }))}
              value={String(l.rentDueDay)}
              onChange={v => v && Number(v) !== l.rentDueDay && void patch({ rentDueDay: Number(v) }, `Rent now due on the ${ordinal(Number(v))}`)}
              open={dueOpen}
              onOpenChange={setDueOpen}
              align="end"
              width={200}
              placeholder="Due day…"
              trigger={<button type="button" className={chip}>{ordinal(l.rentDueDay)} of the month</button>}
            />
          )}
        </RailRow>
        <RailRow label="Late fees">
          <label className="flex h-8 cursor-pointer items-center gap-2 px-1.5 text-[14px]">
            <Switch checked={!l.lateFeeExempt} disabled={closed} onCheckedChange={v => void patch({ lateFeeExempt: !v }, v ? 'Late fees apply again' : 'Exempt from late fees')} className="scale-90" aria-label="Charge late fees" />
            <span className="whitespace-nowrap">{l.lateFeeExempt ? 'Exempt' : 'Charged'}</span>
          </label>
        </RailRow>
      </RailSection>

      <RailSection
        title="Residents"
        action={!closed && ws.can('residents.manage') ? <Tip label="Add someone to the lease"><IconButton size="sm" aria-label="Add someone to the lease" onClick={() => controls.open('addPerson')}><Plus /></IconButton></Tip> : undefined}
      >
        {detail.people.length === 0 && <p className="px-1.5 py-1 text-[14px] text-muted-foreground">No one is on this lease.</p>}
        {detail.people.map(p => (
          <div key={p.id} className="group flex min-h-9 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent/40">
            <Avatar name={p.name} color={p.color || undefined} size={22} />
            <div className="min-w-0 flex-1">
              <Link to={`/residents/${p.id}`} className="block truncate text-[14px] font-medium hover:underline">{p.name}</Link>
              <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                {p.role}
                {l.status === 'Pending signature' && (p.role === 'Primary' || p.role === 'Co-tenant') && (p.signedAt ? <><span>·</span><CheckCircle2 className="h-3 w-3 text-tone-success" /> signed</> : <span>· not signed</span>)}
              </p>
            </div>
            {p.phone && <Tip label={p.phone}><a href={telHref(p.phone)} aria-label={`Call ${p.name}`} className="hidden h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground group-hover:flex"><Phone className="h-3.5 w-3.5" /></a></Tip>}
            {p.email && <Tip label={p.email}><a href={`mailto:${p.email}`} aria-label={`Email ${p.name}`} className="hidden h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground group-hover:flex"><Mail className="h-3.5 w-3.5" /></a></Tip>}
            {!closed && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton size="sm" aria-label={`Options for ${p.name}`} className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100"><MoreHorizontal /></IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem asChild className="h-9 gap-2 text-[14px]"><Link to={`/residents/${p.id}`}><UserRound className="h-3.5 w-3.5" /> Open resident</Link></DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-2xs font-medium text-muted-foreground">Role</DropdownMenuLabel>
                  {LEASE_TENANT_ROLES.map(r => (
                    <DropdownMenuItem key={r} className="h-9 gap-2 text-[14px]" disabled={r === p.role} onSelect={() => void person({ action: 'setRole', tenantId: p.id, role: r }, p.name)}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', r === p.role ? 'bg-primary' : 'bg-transparent')} /> {r}
                    </DropdownMenuItem>
                  ))}
                  {p.role !== 'Primary' && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="h-9 gap-2 text-[14px] text-tone-danger focus:text-tone-danger" onSelect={() => void person({ action: 'removePerson', tenantId: p.id }, p.name)}><UserMinus className="h-3.5 w-3.5" /> Remove from lease</DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}
      </RailSection>

      {(l.sentForSignatureAt || l.signatures.length > 0 || l.countersignedAt || l.documentUrl) && (
        <RailSection title="Signatures" className="hidden lg:block">
          {l.sentForSignatureAt && <RailRow label="Sent"><Tip label={dateTime(l.sentForSignatureAt)}><span className={plain}>{timeAgo(l.sentForSignatureAt)}</span></Tip></RailRow>}
          {l.signatures.map(s => (
            <RailRow key={`${s.tenantId}-${s.signedAt}`} label={<span className="block truncate">{s.name.split(' ')[0]}</span>}>
              <Tip label={`Signed as “${s.name}” ${dateTime(s.signedAt)}${s.by === 'staff' ? ' — recorded by the office' : ' in the portal'}`}>
                <span className={plain}><CheckCircle2 className="h-3.5 w-3.5 text-tone-success" /> {shortDate(s.signedAt.slice(0, 10))}{s.by === 'staff' && <span className="text-sm text-muted-foreground">· office</span>}</span>
              </Tip>
            </RailRow>
          ))}
          {l.countersignedAt && (
            <RailRow label="Countersigned">
              <Tip label={dateTime(l.countersignedAt)}>
                <span className={plain}>{l.countersignedById && <MemberAvatar member={ws.memberById.get(l.countersignedById)} size={16} />} {shortDate(l.countersignedAt.slice(0, 10))}</span>
              </Tip>
            </RailRow>
          )}
          {l.documentUrl && (
            <RailRow label="Document">
              <a href={l.documentUrl} target="_blank" rel="noreferrer" className={chip}><Download className="h-3.5 w-3.5 text-muted-foreground" /> Signed PDF</a>
            </RailRow>
          )}
        </RailSection>
      )}

      <RailSection title="Details" className="hidden lg:block">
        {detail.application && (
          <RailRow label="Application">
            <Link to={`/applications/${detail.application.number}`} className={chip}><FileText className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{detail.application.ref} · {detail.application.applicantName}</span></Link>
          </RailRow>
        )}
        {l.previousLeaseId && (
          <RailRow label="Previous">
            <Link to={`/leases/${l.previousLeaseId}`} className={chip}><ExternalLink className="h-3.5 w-3.5 text-muted-foreground" /> Previous lease</Link>
          </RailRow>
        )}
        {l.createdAt && (
          <RailRow label="Created">
            <Tip label={dateTime(l.createdAt)}>
              <span className={plain}>{l.createdById && <MemberAvatar member={ws.memberById.get(l.createdById)} size={16} />} {timeAgo(l.createdAt)}</span>
            </Tip>
          </RailRow>
        )}
        {l.notes && <Notes text={l.notes} />}
      </RailSection>
    </>
  );
}

function Notes({ text }: { text: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const long = text.length > 160;
  return (
    <div className="px-1.5 pt-1">
      <p className={cn('whitespace-pre-line break-words text-sm text-muted-foreground', !open && long && 'line-clamp-3')}>{text}</p>
      {long && <button type="button" className="mt-0.5 text-sm text-muted-foreground hover:text-foreground" onClick={() => setOpen(v => !v)}>{open ? 'Less' : 'More'}</button>}
    </div>
  );
}
