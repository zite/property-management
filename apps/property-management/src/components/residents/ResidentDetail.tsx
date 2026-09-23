import { useQueryClient } from '@tanstack/react-query';
import { Building2, Car, HeartPulse, Lock, Mail, MessageSquare, PawPrint, Phone, Plus, Send, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { messageResident } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import type { LeasePhase } from '@project/shared/constants';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { dateTime, fullDate, shortDate, telHref, timeAgo } from '../../lib/format';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { RailRow, RailSection, SectionHeading } from '../detail/DetailLayout';
import { Composer, Timeline, type ComposerMode } from '../detail/Timeline';
import { ExpiryChip, termText } from '../leases/LeaseRow';
import { Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { LeasePhasePill, PropertySwatch } from '../primitives/glyphs';
import { rk, type ResidentDetail } from './data';

const chip = 'ghost-chip h-8 max-w-full justify-start gap-1.5 px-1.5 text-[14px] [&_svg]:shrink-0';
const plain = 'flex min-h-8 min-w-0 items-center gap-1.5 px-1.5 text-[14px]';

/** Contact details, emergency contact, household and portal access. */
export function ResidentRail({ detail }: { detail: ResidentDetail }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const app = useAppActions();
  const t = detail.tenant;
  const [inviting, setInviting] = useState(false);

  const invite = async () => {
    setInviting(true);
    try {
      const res = await messageResident({ action: 'invite', tenantId: t.id });
      if (res.failed) toast.warning(res.message);
      else toast.success(res.message, { description: detail.portalConfigured ? undefined : 'The portal link is added once the portal has been opened once.' });
      await qc.invalidateQueries({ queryKey: rk.detail(t.id) });
      invalidate(qc, 'residents', 'messages');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t send the invite'));
    } finally {
      setInviting(false);
    }
  };

  return (
    <>
      <RailSection title="Contact" action={ws.can('residents.manage') ? <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => app.openCreate('tenant', { tenantId: t.id })}>Edit</button> : undefined}>
        {t.email ? <a href={`mailto:${t.email}`} className={chip}><Mail className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{t.email}</span></a> : <span className={cn(plain, 'text-muted-foreground')}><Mail className="h-3.5 w-3.5" /> No email</span>}
        {t.phone ? <a href={telHref(t.phone)} className={chip}><Phone className="h-3.5 w-3.5 text-muted-foreground" /> {t.phone}</a> : <span className={cn(plain, 'text-muted-foreground')}><Phone className="h-3.5 w-3.5" /> No phone</span>}
        {t.altPhone && <a href={telHref(t.altPhone)} className={cn(chip, 'text-muted-foreground')}><Phone className="h-3.5 w-3.5" /> {t.altPhone} <span className="text-sm">alt</span></a>}
        {t.company && <span className={plain}><Building2 className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{t.company}</span></span>}
      </RailSection>

      <RailSection title="Emergency contact">
        {t.emergencyContact || t.emergencyPhone ? (
          <>
            {t.emergencyContact && <span className={plain}><HeartPulse className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{t.emergencyContact}</span></span>}
            {t.emergencyPhone && <a href={telHref(t.emergencyPhone)} className={chip}><Phone className="h-3.5 w-3.5 text-muted-foreground" /> {t.emergencyPhone}</a>}
          </>
        ) : (
          <span className={cn(plain, 'text-muted-foreground')}>None on file</span>
        )}
      </RailSection>

      <RailSection title="Household">
        <RailRow label="Pets"><span className={cn(plain, !t.pets && 'text-muted-foreground')}>{t.pets ? <><PawPrint className="h-3.5 w-3.5 text-muted-foreground" /> <span className="line-clamp-2 break-words">{t.pets}</span></> : 'None'}</span></RailRow>
        <RailRow label="Vehicles"><span className={cn(plain, !t.vehicles && 'text-muted-foreground')}>{t.vehicles ? <><Car className="h-3.5 w-3.5 text-muted-foreground" /> <span className="line-clamp-2 break-words">{t.vehicles}</span></> : 'None'}</span></RailRow>
      </RailSection>

      <RailSection title="Resident portal">
        <RailRow label="Status">
          {t.portalSeenAt ? (
            <Tip label={dateTime(t.portalSeenAt)}><span className={plain}><span className="h-1.5 w-1.5 rounded-full bg-tone-success" /> Active · {timeAgo(t.portalSeenAt)}</span></Tip>
          ) : t.portalInvitedAt ? (
            <Tip label={dateTime(t.portalInvitedAt)}><span className={plain}><span className="h-1.5 w-1.5 rounded-full border border-muted-foreground" /> Invited {shortDate(t.portalInvitedAt.slice(0, 10))}</span></Tip>
          ) : (
            <span className={cn(plain, 'text-muted-foreground')}>Not invited</span>
          )}
        </RailRow>
        {ws.can('communications.send') && (
          <button type="button" disabled={inviting || !t.email} onClick={() => void invite()} className={cn(chip, 'mt-1 w-full justify-center border bg-background')}>
            <Send className="h-3.5 w-3.5" /> {inviting ? 'Sending…' : t.portalInvitedAt || t.portalSeenAt ? 'Resend portal invite' : 'Invite to the portal'}
          </button>
        )}
        {!t.email && <p className="px-1.5 pt-1 text-sm text-muted-foreground">Add an email address to invite them.</p>}
      </RailSection>

      {(t.notes || t.createdAt) && (
        <RailSection title="Details">
          {t.createdAt && <RailRow label="Added"><Tip label={dateTime(t.createdAt)}><span className={plain}>{fullDate(t.createdAt.slice(0, 10))}</span></Tip></RailRow>}
          {t.notes && <p className="whitespace-pre-line break-words px-1.5 pt-1 text-sm text-muted-foreground">{t.notes}</p>}
        </RailSection>
      )}
    </>
  );
}

/** The lease they live under, and every lease they've been on. */
export function ResidentOverview({ detail }: { detail: ResidentDetail }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const current = detail.leases.find(l => l.id === detail.currentLeaseId);
  const others = detail.leases.filter(l => l.id !== detail.currentLeaseId);
  const recent = detail.activity.slice(-6);
  return (
    <div>
      <SectionHeading>{current && current.startDate && current.startDate > ws.today ? 'Upcoming lease' : 'Current lease'}</SectionHeading>
      {current ? (
        <Link to={`/leases/${current.id}`} className="block rounded-lg border bg-card p-4 shadow-2xs transition-colors hover:border-foreground/15">
          <div className="flex flex-wrap items-center gap-2">
            <PropertySwatch color={ws.propertyById.get(current.propertyId ?? '')?.color} />
            <span className="min-w-0 truncate text-[16px] font-semibold">{ws.unitLabel(current.unitId, current.propertyId)}</span>
            <LeasePhasePill phase={current.phase as LeasePhase} />
            <span className="ml-auto text-sm tabular-nums text-muted-foreground">{current.ref} · {current.role}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[14px] sm:grid-cols-4">
            <Fact label="Rent"><Money value={current.rent} /></Fact>
            <Fact label="Balance"><Money value={current.balance} tone="balance" className="font-medium" /></Fact>
            <Fact label="Term">{termText(current)}</Fact>
            <Fact label={current.moveOutDate ? 'Moving out' : 'Ends'}>{current.moveOutDate ? fullDate(current.moveOutDate) : <ExpiryChip lease={current} className="text-[14px]" />}</Fact>
          </div>
          {current.household.length > 0 && <p className="mt-3 truncate text-sm text-muted-foreground">With {current.household.map(h => `${h.name}${h.role === 'Occupant' || h.role === 'Guarantor' ? ` (${h.role.toLowerCase()})` : ''}`).join(', ')}</p>}
        </Link>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-4 py-4 text-[14px] text-muted-foreground">
          <UserRound className="h-4 w-4" />
          <span className="flex-1">{detail.leases.length ? 'Not living in one of your homes right now.' : 'Not on a lease yet.'}</span>
          {ws.can('residents.manage') && (
            <button type="button" className="ghost-chip h-8 bg-background text-[13.5px]" onClick={() => app.openCreate('lease', { tenantId: detail.tenant.id, tenantName: detail.tenant.name, tenantEmail: detail.tenant.email, tenantPhone: detail.tenant.phone })}>
              <Plus className="h-3.5 w-3.5" /> New lease
            </button>
          )}
        </div>
      )}

      {others.length > 0 && (
        <>
          <SectionHeading count={others.length}>{current ? 'Other leases' : 'Leases'}</SectionHeading>
          <div className="overflow-hidden rounded-lg border">
            {others.map(l => (
              <Link key={l.id} to={`/leases/${l.id}`} className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-0.5 border-b px-3 py-1.5 text-[14px] last:border-b-0 hover:bg-accent/50">
                <span className="w-[52px] shrink-0 text-sm tabular-nums text-muted-foreground">{l.ref}</span>
                <span className="min-w-0 flex-1 truncate">{ws.unitLabel(l.unitId, l.propertyId)}</span>
                <span className="hidden text-sm tabular-nums text-muted-foreground sm:inline">{l.startDate ? shortDate(l.startDate) : ''} – {l.moveOutDate ? shortDate(l.moveOutDate) : l.endDate ? shortDate(l.endDate) : 'ongoing'}</span>
                <LeasePhasePill phase={l.phase as LeasePhase} />
                <Money value={l.balance} tone="balance" muted0 className="w-[84px] text-right" />
              </Link>
            ))}
          </div>
        </>
      )}

      <SectionHeading>Recent activity</SectionHeading>
      <Timeline activity={recent} emptyText="Nothing has happened on this resident yet." />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate">{children}</div>
    </div>
  );
}

/** The conversation with the office: messages both ways, notes, and a composer. Opening it marks their replies read. */
export function ResidentMessages({ detail }: { detail: ResidentDetail }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const t = detail.tenant;
  useEffect(() => {
    if (detail.unread > 0) {
      void messageResident({ action: 'read', tenantIds: [t.id] })
        .then(() => {
          void qc.invalidateQueries({ queryKey: rk.detail(t.id) });
          invalidate(qc, 'bootstrap', 'inbox', 'messages', 'residents');
        })
        .catch(() => undefined);
    }
  }, [t.id, detail.unread]);

  const first = t.name.split(' ')[0] || 'them';
  const modes: ComposerMode[] = [
    ...(ws.can('communications.send') ? [
      { value: 'email', label: `Message ${first}`, icon: <Mail />, placeholder: `Write to ${t.name}…`, hint: t.email ? 'Emailed and shown in their portal.' : 'No email on file — shown in their portal only.' },
      { value: 'portal', label: 'Portal only', icon: <MessageSquare />, placeholder: 'Shown in their portal next time they sign in…', hint: 'Not emailed.' },
    ] : []),
    { value: 'note', label: 'Internal note', icon: <Lock />, placeholder: 'Add a note for your team…' },
  ];
  const send = async ({ mode, body }: { mode: string; body: string }) => {
    try {
      if (mode === 'note') await messageResident({ action: 'note', tenantId: t.id, body, leaseId: detail.currentLeaseId ?? undefined });
      else {
        const res = await messageResident({ action: 'send', tenantIds: [t.id], body, leaseId: detail.currentLeaseId ?? undefined, portalOnly: mode === 'portal' });
        if (res.failed) toast.warning(res.message);
        else toast.success(res.message);
      }
      await qc.invalidateQueries({ queryKey: rk.detail(t.id) });
      invalidate(qc, 'messages', 'leases');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t send'));
      throw e;
    }
  };
  return (
    <div>
      <Timeline activity={[]} messages={detail.messages} emptyText={`No messages with ${first} yet.`} />
      <Composer className="mt-4" modes={modes} onSend={send} />
    </div>
  );
}

