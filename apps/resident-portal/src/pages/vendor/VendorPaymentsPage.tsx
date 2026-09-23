import { Banknote, FileText, Receipt } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { AreaSkeleton, LoadError, PageHeader, Panel, Segmented, StatTile, money } from '../../components/owner/kit';
import { useVendorBills, type VendorBills } from '../../components/vendor/data';
import { Card, Container, EmptyState, StatusPill } from '../../components/ui';
import { dueLabel, plural, shortDate } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * What the office owes the vendor and what it has paid: bills with their
 * status and due dates, payments sent, and this year's total for their 1099.
 */
export default function VendorPaymentsPage() {
  useDocumentTitle('Payments');
  const q = useVendorBills();
  if (q.isPending) return <AreaSkeleton tiles={3} variant="list" />;
  if (q.isError || !q.data) return <LoadError error={q.error} onRetry={() => q.refetch()} what="your payments" home={{ to: '/vendor', label: 'Work orders' }} />;
  const d = q.data;
  const lastPayment = d.payments[0];

  return (
    <div className="animate-fade-in">
      <PageHeader eyebrow={d.vendorName} title="Payments" subtitle="Bills the office has entered for your work, and the payments it has sent you." />
      <Container className="space-y-5 pb-4 pt-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label={`Paid to you in ${d.year}`} value={money(d.ytdPaid, d.currency)} detail={lastPayment ? `Last payment ${shortDate(lastPayment.date)}` : 'No payments yet this year'} />
          <StatTile label="Waiting to be paid" value={money(d.openTotal, d.currency)} detail={`${plural(d.bills.filter(b => b.open > 0).length, 'open bill')}`} />
          <StatTile label="Past due" value={money(d.overdueTotal, d.currency)} tone={d.overdueTotal > 0 ? 'danger' : undefined} detail={d.overdueTotal > 0 ? 'Call the office if you haven’t heard about it' : 'Nothing past due'} />
        </div>
        <p className="text-sm text-muted-foreground">The {d.year} total is what the office has paid you so far this calendar year — the figure your 1099 will be based on.</p>
        <Bills d={d} />
        <Payments d={d} />
      </Container>
    </div>
  );
}

function Bills({ d }: { d: VendorBills }) {
  const openBills = d.bills.filter(b => b.open > 0);
  // Open bills first when there are any; otherwise the history is the useful view.
  const [tab, setTab] = useState<'open' | 'all'>(() => (openBills.length ? 'open' : 'all'));
  const rows = useMemo(() => (tab === 'open' ? openBills : d.bills), [tab, openBills, d.bills]);
  if (d.bills.length === 0) {
    return (
      <Card>
        <EmptyState icon={Receipt} title="No bills yet">
          After you finish a job and send your invoice, the office enters a bill for it. You’ll see each one here with its due date.
        </EmptyState>
      </Card>
    );
  }
  return (
    <Panel
      title="Bills"
      icon={Receipt}
      flush
      action={
        <Segmented
          label="Bills"
          value={tab}
          onChange={v => setTab(v as 'open' | 'all')}
          options={[
            { value: 'open', label: 'Open', count: openBills.length },
            { value: 'all', label: 'All', count: d.bills.length },
          ]}
        />
      }
    >
      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-[15px] text-muted-foreground">
          Every bill has been paid.{' '}
          <button type="button" onClick={() => setTab('all')} className="font-medium text-primary hover:underline">
            See all bills
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[15px]">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-sm text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">For</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Invoice</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Due</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Amount</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium sm:px-5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(b => {
                const due = b.open > 0 ? dueLabel(b.dueDate) : null;
                return (
                  <tr key={b.id} className="align-top">
                    <td className="px-4 py-3 sm:px-5">
                      <span className="block break-words font-medium leading-snug">{b.description}</span>
                      <span className="block text-sm text-muted-foreground">
                        {b.propertyName}
                        {b.workOrderNumber ? (
                          <>
                            {' · '}
                            <Link to={`/vendor/work-orders/${b.workOrderNumber}`} className="text-primary hover:underline">
                              WO-{b.workOrderNumber}
                            </Link>
                          </>
                        ) : null}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {b.invoiceNumber || '—'}
                      <span className="block text-sm text-muted-foreground">Entered {shortDate(b.date)}</span>
                    </td>
                    <td className={cn('whitespace-nowrap px-3 py-3', due?.tone === 'overdue' && 'text-tone-danger')}>{b.open > 0 ? due?.label ?? '—' : b.dueDate ? shortDate(b.dueDate) : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      {money(b.amount, d.currency)}
                      {b.paid > 0 && b.open > 0 && <span className="block text-sm text-muted-foreground">{money(b.open, d.currency)} left</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right sm:px-5">
                      <StatusPill tone={b.status === 'Paid' ? 'success' : b.status === 'Overdue' ? 'danger' : b.status === 'Partially paid' ? 'warning' : 'info'}>{b.status === 'Paid' && b.paidOn ? `Paid ${shortDate(b.paidOn)}` : b.status}</StatusPill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Payments({ d }: { d: VendorBills }) {
  if (d.payments.length === 0) {
    return (
      <Panel title="Payments received" icon={Banknote}>
        <p className="text-[15px] text-muted-foreground">No payments yet. When the office pays a bill, the check number or transfer shows here.</p>
      </Panel>
    );
  }
  return (
    <Panel title="Payments received" icon={Banknote} flush>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-[15px]">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-sm text-muted-foreground">
              <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">Date</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Method</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Paid for</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium sm:px-5">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {d.payments.map(p => (
              <tr key={p.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-3 sm:px-5">{shortDate(p.date)}</td>
                <td className="whitespace-nowrap px-3 py-3">
                  {p.method || '—'}
                  {p.reference && <span className="text-muted-foreground"> {p.method === 'Check' ? `#${p.reference}` : `· ${p.reference}`}</span>}
                </td>
                <td className="px-3 py-3">
                  {p.paidFor.length ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      <span className="break-words">{p.paidFor.join(', ')}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{p.direct ? `Paid directly · ${p.description}` : p.description}</span>
                  )}
                  {p.propertyName && <span className="block text-sm text-muted-foreground">{p.propertyName}</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums sm:px-5">{money(p.amount, d.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
