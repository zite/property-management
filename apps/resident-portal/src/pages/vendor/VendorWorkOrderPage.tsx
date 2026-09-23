import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Camera, CheckCircle2, DoorClosed, DoorOpen, ExternalLink, FileText, Hourglass, MapPin, MessagesSquare, Phone, Receipt, Siren } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { addVendorWorkOrderMessage } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { Conversation } from '../../components/owner/Conversation';
import { Thumb } from '../../components/owner/Thumb';
import { AreaSkeleton, LoadError, PageHeader, Panel, money, telHref, workOrderTone } from '../../components/owner/kit';
import { InvoiceDialog, JobActions, canDo } from '../../components/vendor/actions';
import { useVendorWorkOrder, vendorKeys, type VendorWorkOrderDetail } from '../../components/vendor/data';
import { visitLabel } from '../../components/vendor/format';
import { Alert, Button, Container, StatusPill } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { mediumDateTime, shortDate } from '../../lib/format';
import { qk } from '../../lib/queries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * One job for the vendor: what's wrong and where, how to get in, the
 * schedule, the next step, messages with the office, and the invoice.
 */
export default function VendorWorkOrderPage() {
  const { number: raw = '' } = useParams();
  const number = Number(raw);
  const q = useVendorWorkOrder(number);
  useDocumentTitle(q.data ? `${q.data.workOrder.ref} · ${q.data.workOrder.title}` : 'Work order');

  if (!Number.isInteger(number) || number <= 0) return <LoadError error={new Error('API call failed (404): {"message":"We couldn\'t find that work order."}')} onRetry={() => undefined} what="that work order" home={{ to: '/vendor', label: 'All work orders' }} />;
  if (q.isPending) return <AreaSkeleton variant="detail" />;
  if (q.isError || !q.data) return <LoadError error={q.error} onRetry={() => q.refetch()} what="that work order" home={{ to: '/vendor', label: 'All work orders' }} />;
  const d = q.data;
  const w = d.workOrder;
  const emergency = w.priority === 'Emergency' && w.open;

  return (
    <div className="animate-fade-in">
      <PageHeader
        back={{ to: '/vendor', label: 'Work orders' }}
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums">{w.ref}</span>
            <span aria-hidden>·</span>
            <span>{w.category}</span>
            {emergency ? <StatusPill tone="danger">Emergency</StatusPill> : w.priority === 'High' && w.open ? <StatusPill tone="warning" dot={false}>High priority</StatusPill> : null}
            <StatusPill tone={workOrderTone(w.status)}>{w.status}</StatusPill>
          </span>
        }
        title={w.title}
        subtitle={w.propertyName}
      />
      <Container className="space-y-5 pb-4 pt-4">
        {emergency && d.office.emergencyPhone && (
          <Alert tone="danger" icon={Siren} title="Emergency job" action={<a href={telHref(d.office.emergencyPhone)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-tone-danger px-3 text-sm font-medium text-white dark:text-[hsl(240_10%_6%)]"><Phone className="h-4 w-4" aria-hidden /> Call {d.office.emergencyPhone}</a>}>
            Please respond as soon as you can. Call the emergency line if you can’t get there today.
          </Alert>
        )}
        {w.awaitingApproval && w.open && (
          <Alert tone="warning" icon={Hourglass} title={w.approvalDeclined ? 'The owner declined this estimate' : 'Waiting for the owner’s approval'}>
            {w.approvalDeclined ? 'Don’t start any work. The office will be in touch about next steps.' : 'Hold off on scheduling or starting until the office confirms. You can still message them below.'}
          </Alert>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-5">
            <Panel title="The job">
              {w.description ? <p className="whitespace-pre-line break-words text-[15px] leading-relaxed">{w.description}</p> : <p className="text-[15px] text-muted-foreground">No description was added. Message the office if you need more detail.</p>}
              <dl className="mt-4 grid gap-x-6 gap-y-3 text-[15px] sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-muted-foreground">Reported</dt>
                  <dd>{w.reportedAt ? mediumDateTime(w.reportedAt) : '—'}</dd>
                </div>
                {w.dueDate && w.open && (
                  <div>
                    <dt className="text-sm text-muted-foreground">Needed by</dt>
                    <dd>{shortDate(w.dueDate)}</dd>
                  </div>
                )}
                {w.estimate != null && (
                  <div>
                    <dt className="text-sm text-muted-foreground">Your estimate</dt>
                    <dd className="tabular-nums">{money(w.estimate, d.currency)}</dd>
                  </div>
                )}
                {w.startedAt && (
                  <div>
                    <dt className="text-sm text-muted-foreground">Started</dt>
                    <dd>{mediumDateTime(w.startedAt)}</dd>
                  </div>
                )}
              </dl>
            </Panel>

            <div className="lg:hidden">
              <SchedulePanel d={d} />
            </div>

            {w.status === 'Completed' && (
              <Panel title="Completed" icon={CheckCircle2}>
                <p className="text-sm text-muted-foreground">
                  {w.completedAt ? mediumDateTime(w.completedAt) : ''}
                  {w.actualCost != null ? ` · ${money(w.actualCost, d.currency)}` : ''}
                </p>
                {w.completionNotes && <p className="mt-2 whitespace-pre-line break-words text-[15px] leading-relaxed">{w.completionNotes}</p>}
              </Panel>
            )}

            <Panel title="Location and access" icon={MapPin}>
              <p className="break-words text-[17px] font-semibold leading-snug">{w.address || w.propertyName}</p>
              {w.unitName && <p className="text-[15px] text-muted-foreground">{w.propertyName} · {w.unitName}</p>}
              <a href={w.mapsUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                Open in Maps <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
              <div className={cn('mt-4 rounded-lg border px-3.5 py-3', w.permissionToEnter ? 'border-tone-success/25 bg-tone-success/[0.05]' : 'border-tone-warning/30 bg-tone-warning/[0.06]')}>
                <p className="flex items-center gap-2 font-medium">
                  {w.permissionToEnter ? <DoorOpen className="h-4 w-4 text-tone-success" aria-hidden /> : <DoorClosed className="h-4 w-4 text-tone-warning" aria-hidden />}
                  {w.permissionToEnter ? 'OK to enter if nobody’s home' : 'Arrange entry before you go'}
                </p>
                {w.entryNotes && <p className="mt-1 whitespace-pre-line break-words text-[15px]">“{w.entryNotes}”</p>}
                {w.resident && (
                  <p className="mt-2 text-[15px]">
                    Contact {w.resident.firstName}
                    {w.resident.phone ? (
                      <>
                        {' '}
                        at{' '}
                        <a href={telHref(w.resident.phone)} className="font-medium text-primary hover:underline">
                          {w.resident.phone}
                        </a>
                      </>
                    ) : ' through the office'}{' '}
                    to set a time.
                  </p>
                )}
                {!w.permissionToEnter && !w.resident && w.open && <p className="mt-1 text-sm text-muted-foreground">Ask the office how to get in.</p>}
              </div>
            </Panel>

            {w.photos.length > 0 && (
              <Panel title="Photos" icon={Camera}>
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {w.photos.map(p => (
                    <li key={p.url}>
                      <Thumb url={p.url} name={p.name} className="aspect-square" />
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            <Messages d={d} />
          </div>

          <aside className="min-w-0 space-y-5">
            <div className="hidden lg:block">
              <SchedulePanel d={d} />
            </div>
            <Invoices d={d} />
          </aside>
        </div>
      </Container>
    </div>
  );
}

function SchedulePanel({ d }: { d: VendorWorkOrderDetail }) {
  const w = d.workOrder;
  const can = canDo(w);
  return (
    <Panel title="Schedule" icon={CalendarClock}>
      {w.open ? (
        <>
          <p className={cn('text-xl font-semibold tracking-tight', !w.scheduledFor && 'text-muted-foreground')}>{visitLabel(w.scheduledFor) ?? 'Not scheduled'}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {w.status === 'In progress' ? 'Work is in progress.' : w.awaitingApproval ? 'Waiting on the owner.' : w.scheduledFor ? 'The resident has been told when to expect you.' : 'Pick a time for the visit.'}
          </p>
          {(can.schedule || can.start || can.complete || can.hold) && (
            <div className="mt-4">
              <JobActions job={w} layout="stack" />
            </div>
          )}
        </>
      ) : (
        <p className="text-[15px] text-muted-foreground">{w.status === 'Canceled' ? 'This job was canceled.' : `Completed ${w.completedAt ? shortDate(w.completedAt) : ''}.`}</p>
      )}
      {w.contact && (
        <p className="mt-4 border-t pt-3 text-sm text-muted-foreground">
          Office contact: <span className="font-medium text-foreground">{w.contact.name}</span>
          {w.contact.phone && (
            <>
              {' '}
              ·{' '}
              <a href={telHref(w.contact.phone)} className="whitespace-nowrap text-primary hover:underline">
                {w.contact.phone}
              </a>
            </>
          )}
        </p>
      )}
    </Panel>
  );
}

function Messages({ d }: { d: VendorWorkOrderDetail }) {
  const qc = useQueryClient();
  const w = d.workOrder;
  const key = vendorKeys.workOrder(w.number);
  const send = useMutation({
    mutationFn: (body: string) => addVendorWorkOrderMessage({ number: w.number, body }),
    onMutate: async body => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<VendorWorkOrderDetail>(key);
      const temp = { id: `temp-${Date.now()}`, mine: true, senderName: d.vendorName, subject: '', body, sentAt: new Date().toISOString() };
      qc.setQueryData<VendorWorkOrderDetail>(key, old => (old ? { ...old, messages: [...old.messages, temp] } : old));
      return { prev, tempId: temp.id };
    },
    onSuccess: (msg, _b, ctx) => {
      qc.setQueryData<VendorWorkOrderDetail>(key, old => (old ? { ...old, messages: old.messages.map(m => (m.id === ctx?.tempId ? msg : m)) } : old));
      toast.success('Message sent to the office.');
      qc.invalidateQueries({ queryKey: qk.me });
    },
    onError: (e, _b, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(errorMessage(e, 'Your message didn’t send. Try again.'));
    },
  });
  return (
    <Panel title="Messages with the office" icon={MessagesSquare}>
      <Conversation
        messages={d.messages.map(m => ({ ...m, pending: m.id.startsWith('temp-') }))}
        officeName={d.office.name}
        onSend={body => send.mutateAsync(body)}
        sending={send.isPending}
        emptyText="No messages about this job yet. Ask a question, send an update or flag a problem below."
        composerLabel="Message the office about this job"
        placeholder="Parts on order, found something else, need access…"
        hint="Goes to the person managing this job. Press ⌘ Enter to send."
        disabledReason={w.status === 'Canceled' ? 'This job was canceled, so messages are closed. Call the office if you need to reach someone.' : null}
      />
    </Panel>
  );
}

function Invoices({ d }: { d: VendorWorkOrderDetail }) {
  const [open, setOpen] = useState(false);
  const w = d.workOrder;
  const canInvoice = w.status !== 'Canceled';
  return (
    <Panel title="Invoice and payment" icon={Receipt}>
      {d.bills.length > 0 && (
        <ul className="mb-3 space-y-2">
          {d.bills.map(b => (
            <li key={b.id} className="rounded-lg border px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium tabular-nums">{money(b.amount, d.currency)}</span>
                <StatusPill tone={b.open === 0 ? 'success' : 'info'}>{b.open === 0 ? `Paid ${b.paidOn ? shortDate(b.paidOn) : ''}`.trim() : b.dueDate ? `Due ${shortDate(b.dueDate)}` : 'Entered'}</StatusPill>
              </div>
              <p className="text-sm text-muted-foreground">{b.reference ? `Invoice ${b.reference}` : `Bill #${b.number}`} · entered {shortDate(b.date)}</p>
            </li>
          ))}
        </ul>
      )}
      {d.invoices.length > 0 ? (
        <ul className="space-y-2">
          {d.invoices.map(i => (
            <li key={i.id}>
              <a href={i.url} target="_blank" rel="noreferrer" className="flex items-start gap-2.5 rounded-lg border bg-background px-3 py-2.5 hover:bg-accent">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium">{i.name}</span>
                  <span className="block text-sm text-muted-foreground">Sent {i.uploadedAt ? shortDate(i.uploadedAt) : ''}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        d.bills.length === 0 && <p className="text-[15px] text-muted-foreground">{w.status === 'Completed' ? 'Send your invoice so the office can pay you.' : 'When the work is done, send your invoice here.'}</p>
      )}
      {canInvoice && (
        <Button variant={w.status === 'Completed' && d.invoices.length === 0 && d.bills.length === 0 ? 'primary' : 'secondary'} className="mt-3 w-full" onClick={() => setOpen(true)}>
          <Receipt aria-hidden /> {d.invoices.length ? 'Send another invoice' : 'Send invoice'}
        </Button>
      )}
      <InvoiceDialog job={w} open={open} onOpenChange={setOpen} />
    </Panel>
  );
}
