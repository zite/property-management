import { CalendarClock, ExternalLink, FileCheck2, Flag, Mail, Phone, Plus, ShieldAlert, ShieldCheck, UserRound, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import type { ApplicationStatus } from '@project/shared/constants';
import { applicationRef, leaseRef, workOrderRef } from '@project/shared/leases';
import { useAppActions } from '../../lib/app-actions';
import { daysFromToday, shortDate, shortDateTime, telHref, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { RailRow, RailSection } from '../detail/DetailLayout';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { Money } from '../primitives/data';
import { APPLICATION_TONE, Pill, PriorityGlyph, PropertySwatch, WorkOrderStatusGlyph } from '../primitives/glyphs';
import type { ThreadDetail } from './data';

/** Who this conversation is with and what's going on with them — so a reply never needs another tab. */

const chip = 'ghost-chip flex h-8 w-fit max-w-full justify-start gap-1.5 px-1.5 text-[14px] [&_svg]:shrink-0';

function MaybeLink({ to, allowed, className, children }: { to: string; allowed: boolean; className?: string; children: ReactNode }) {
  return allowed ? <Link to={to} className={className}>{children}</Link> : <span className={cn(className, 'hover:bg-transparent')}>{children}</span>;
}

function Contact({ email, phone }: { email: string; phone: string }) {
  return (
    <>
      {email ? (
        <a href={`mailto:${email}`} className={cn(chip, 'text-muted-foreground')}><Mail className="h-3.5 w-3.5" /> <span className="truncate">{email}</span></a>
      ) : (
        <span className="flex h-8 items-center gap-1.5 px-1.5 text-[14px] text-tone-warning"><Mail className="h-3.5 w-3.5" /> No email on file</span>
      )}
      {phone && <a href={telHref(phone)} className={cn(chip, 'text-muted-foreground')}><Phone className="h-3.5 w-3.5" /> {phone}</a>}
    </>
  );
}

function WorkList({ items, empty }: { items: ThreadDetail['workOrders']; empty: string }) {
  const ws = useWorkspace();
  const app = useAppActions();
  if (!items.length) return <p className="px-1.5 py-1 text-[14px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="-mx-1.5">
      {items.map(w => (
        <li key={w.id}>
          <button type="button" onClick={() => app.peekWorkOrder(w.number)} className="flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-accent">
            <WorkOrderStatusGlyph status={w.status} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px]">{w.title}</span>
              <span className="block truncate text-sm text-muted-foreground">
                {workOrderRef(w.number)} · {ws.unitLabel(w.unitId, w.propertyId) || 'Common area'}
                {w.estimateAmount != null && <> · <Money value={w.estimateAmount} /></>}
              </span>
            </span>
            <PriorityGlyph priority={w.priority} className="mt-0.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ContextPanel({ detail }: { detail: ThreadDetail }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const { tenant, owner, vendor, application, workOrder } = detail;

  if (tenant) {
    const current = tenant.leases.find(l => l.status === 'Active') ?? tenant.leases[0];
    return (
      <>
        <RailSection>
          <MaybeLink to={`/residents/${tenant.id}`} allowed={ws.can('residents.manage')} className={cn(chip, 'text-[15px] font-medium')}>
            <UserRound className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{tenant.name}</span>
          </MaybeLink>
          {tenant.company && <p className="px-1.5 text-sm text-muted-foreground">{tenant.company}</p>}
          <Contact email={tenant.email} phone={tenant.phone} />
          <p className="px-1.5 pt-1 text-sm text-muted-foreground">{tenant.portalSeenAt ? `Last in the portal ${timeAgo(tenant.portalSeenAt)}` : 'Hasn’t signed in to the portal yet'}</p>
        </RailSection>
        <RailSection title={tenant.leases.length > 1 ? 'Leases' : 'Lease'}>
          {tenant.leases.length === 0 && <p className="px-1.5 text-[14px] text-muted-foreground">Not on a lease</p>}
          {tenant.leases.map(l => (
            <MaybeLink key={l.id} to={`/leases/${l.id}`} allowed={ws.can('residents.manage')} className={cn('-mx-1.5 flex items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-accent', l !== current && 'opacity-80')}>
              <PropertySwatch color={ws.propertyById.get(l.propertyId ?? '')?.color} className="mt-1.5" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{ws.unitLabel(l.unitId, l.propertyId) || l.name}</span>
                <span className="block truncate text-sm text-muted-foreground">
                  {leaseRef(l.number)} · {l.status}{l.endDate ? ` · ends ${shortDate(l.endDate)}` : ''}
                </span>
              </span>
              {l.balance != null && l.status === 'Active' && (
                <span className="text-right">
                  <Money value={l.balance} tone="balance" className="block text-[14px]" />
                  <span className="block text-2xs text-muted-foreground">{l.balance > 0.005 ? 'owed' : l.balance < -0.005 ? 'credit' : 'balance'}</span>
                </span>
              )}
            </MaybeLink>
          ))}
          {current && (
            <RailRow label="Rent"><span className="px-1.5 text-[14px]"><Money value={current.rent} /> / mo</span></RailRow>
          )}
        </RailSection>
        <RailSection
          title="Open work orders"
          action={ws.can('maintenance.create') && current ? (
            <button type="button" className="ghost-chip h-6 px-1.5 text-sm text-muted-foreground" onClick={() => app.openCreate('workOrder', { tenantId: tenant.id, unitId: current.unitId, propertyId: current.propertyId, source: 'Staff' })}><Plus className="h-3 w-3" /> New</button>
          ) : undefined}
        >
          <WorkList items={detail.workOrders} empty="Nothing open" />
        </RailSection>
      </>
    );
  }

  if (owner) {
    const props = ws.orderedProperties.filter(p => p.ownerId === owner.id);
    return (
      <>
        <RailSection>
          <MaybeLink to={`/owners/${owner.id}`} allowed={ws.can('owners.manage')} className={cn(chip, 'text-[15px] font-medium')}>
            <span className="truncate">{owner.name}</span>
          </MaybeLink>
          {owner.contactName && owner.contactName !== owner.name && <p className="px-1.5 text-sm text-muted-foreground">Contact: {owner.contactName}</p>}
          <Contact email={owner.email} phone={owner.phone} />
          <p className="px-1.5 pt-1 text-sm text-muted-foreground">{owner.portalEnabled ? 'Owner portal on' : 'Owner portal off — portal-only messages won’t reach them'}</p>
        </RailSection>
        <RailSection title="Properties">
          {props.length === 0 && <p className="px-1.5 text-[14px] text-muted-foreground">No properties</p>}
          {props.map(p => (
            <Link key={p.id} to={`/properties/${p.id}`} className="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-accent">
              <PropertySwatch color={p.color} />
              <span className="min-w-0 flex-1 truncate text-[14px]">{p.name}</span>
              <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{p.occupied}/{p.unitCount} occupied</span>
            </Link>
          ))}
        </RailSection>
        <RailSection title="Waiting on their approval">
          <WorkList items={detail.workOrders} empty="Nothing waiting" />
        </RailSection>
      </>
    );
  }

  if (vendor) {
    const expires = daysFromToday(vendor.insuranceExpiresOn);
    return (
      <>
        <RailSection>
          <MaybeLink to={`/vendors/${vendor.id}`} allowed={ws.can('vendors.manage')} className={cn(chip, 'text-[15px] font-medium')}>
            <Wrench className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{vendor.name}</span>
          </MaybeLink>
          <p className="px-1.5 text-sm text-muted-foreground">{[vendor.trade, vendor.contactName, vendor.status === 'Inactive' ? 'Inactive' : ''].filter(Boolean).join(' · ')}</p>
          <Contact email={vendor.email} phone={vendor.phone} />
        </RailSection>
        <RailSection title="Compliance">
          <RailRow label="Insurance">
            {vendor.insuranceExpiresOn ? (
              <span className={cn('flex items-center gap-1.5 px-1.5 text-[14px]', expires != null && expires < 0 ? 'text-tone-danger' : expires != null && expires <= 30 ? 'text-tone-warning' : '')}>
                {expires != null && expires < 0 ? <ShieldAlert className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                {expires != null && expires < 0 ? `Expired ${shortDate(vendor.insuranceExpiresOn)}` : `Until ${shortDate(vendor.insuranceExpiresOn)}`}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-1.5 text-[14px] text-tone-warning"><ShieldAlert className="h-3.5 w-3.5" /> No certificate</span>
            )}
          </RailRow>
          <RailRow label="W-9">
            <span className={cn('flex items-center gap-1.5 px-1.5 text-[14px]', !vendor.w9OnFile && 'text-tone-warning')}><FileCheck2 className="h-3.5 w-3.5" /> {vendor.w9OnFile ? 'On file' : 'Missing'}</span>
          </RailRow>
        </RailSection>
        <RailSection title="Open work orders">
          <WorkList items={detail.workOrders} empty="Nothing open" />
        </RailSection>
      </>
    );
  }

  if (application) {
    return (
      <>
        <RailSection>
          <MaybeLink to={application.number ? `/applications/${application.number}` : '/leasing/applications'} allowed={ws.can('leasing.manage')} className={cn(chip, 'text-[15px] font-medium')}>
            <span className="truncate">{application.applicantName}</span>
          </MaybeLink>
          <div className="flex items-center gap-2 px-1.5 pb-1">
            <span className="text-sm tabular-nums text-muted-foreground">{applicationRef(application.number)}</span>
            <Pill tone={APPLICATION_TONE[application.status as ApplicationStatus] ?? 'neutral'}>{application.status}</Pill>
          </div>
          <Contact email={application.email} phone={application.phone} />
        </RailSection>
        <RailSection title="Applying for">
          {application.listingTitle && <p className="px-1.5 text-[14px]">{application.listingTitle}</p>}
          {(application.unitId || application.propertyId) && <p className="px-1.5 text-sm text-muted-foreground">{ws.unitLabel(application.unitId, application.propertyId)}</p>}
          {application.desiredMoveIn && <RailRow label="Move-in"><span className="px-1.5 text-[14px]">{shortDate(application.desiredMoveIn)}</span></RailRow>}
          {application.submittedAt && <RailRow label="Submitted"><span className="px-1.5 text-[14px]">{timeAgo(application.submittedAt)}</span></RailRow>}
        </RailSection>
      </>
    );
  }

  if (workOrder) {
    const assignee = workOrder.assigneeId ? ws.memberById.get(workOrder.assigneeId) : undefined;
    const vendorRow = workOrder.vendorId ? ws.vendorById.get(workOrder.vendorId) : undefined;
    const closed = workOrder.status === 'Completed' || workOrder.status === 'Canceled';
    return (
      <>
        <RailSection>
          <button type="button" onClick={() => app.peekWorkOrder(workOrder.number)} className="-mx-1.5 block w-full rounded-md px-1.5 py-1 text-left hover:bg-accent">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><PriorityGlyph priority={workOrder.priority} /> {workOrderRef(workOrder.number)} · {workOrder.category}</span>
            <span className="mt-0.5 block text-[15px] font-medium leading-snug">{workOrder.title}</span>
          </button>
          {workOrder.description && <p className="line-clamp-4 px-0 pt-1 text-sm leading-relaxed text-muted-foreground">{workOrder.description}</p>}
          {ws.can('maintenance.create') && (
            <Link to={`/work-orders/${workOrder.number}`} className={cn(chip, 'mt-1 text-muted-foreground')}><ExternalLink className="h-3.5 w-3.5" /> Open work order</Link>
          )}
        </RailSection>
        <RailSection>
          <RailRow label="Status"><span className="flex items-center gap-1.5 px-1.5 text-[14px]"><WorkOrderStatusGlyph status={workOrder.status} /> {workOrder.status}</span></RailRow>
          <RailRow label="Location"><span className="truncate px-1.5 text-[14px]">{ws.unitLabel(workOrder.unitId, workOrder.propertyId) || 'Common area'}</span></RailRow>
          <RailRow label="Assignee"><span className="flex min-w-0 items-center gap-1.5 px-1.5 text-[14px]">{assignee ? <><MemberAvatar member={assignee} size={16} /> <span className="truncate">{assignee.name}</span></> : <><UnassignedAvatar size={16} /> <span className="text-muted-foreground">Unassigned</span></>}</span></RailRow>
          <RailRow label="Vendor"><span className="truncate px-1.5 text-[14px]">{vendorRow?.name ?? <span className="text-muted-foreground">In-house</span>}</span></RailRow>
          {workOrder.scheduledFor && <RailRow label="Scheduled"><span className="flex items-center gap-1.5 truncate px-1.5 text-[14px]"><CalendarClock className="h-3.5 w-3.5 text-muted-foreground" /> {shortDateTime(workOrder.scheduledFor)}</span></RailRow>}
          {workOrder.dueDate && <RailRow label="Due"><span className={cn('flex items-center gap-1.5 px-1.5 text-[14px]', !closed && workOrder.dueDate < ws.today && 'text-tone-danger')}><Flag className="h-3.5 w-3.5" /> {shortDate(workOrder.dueDate)}</span></RailRow>}
        </RailSection>
        <RailSection title="People">
          {detail.parties.length === 0 && <p className="px-1.5 text-[14px] text-muted-foreground">No resident or vendor on this work order</p>}
          {detail.parties.map(p => (
            <div key={`${p.kind}:${p.id}`} className="py-0.5">
              <MaybeLink to={p.kind === 'tenant' ? `/residents/${p.id}` : `/vendors/${p.id}`} allowed={p.kind === 'tenant' ? ws.can('residents.manage') : ws.can('vendors.manage')} className={cn(chip, 'font-medium')}>
                {p.kind === 'tenant' ? <UserRound className="h-3.5 w-3.5 text-muted-foreground" /> : <Wrench className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className="truncate">{p.label}</span>
                <span className="text-sm font-normal text-muted-foreground">{p.kind === 'tenant' ? 'Resident' : 'Vendor'}</span>
              </MaybeLink>
              {!p.hasEmail && <p className="px-1.5 text-sm text-tone-warning">No email on file</p>}
            </div>
          ))}
        </RailSection>
      </>
    );
  }

  return <RailSection><p className="text-[14px] text-muted-foreground">This contact no longer exists. The conversation is kept for your records.</p></RailSection>;
}
