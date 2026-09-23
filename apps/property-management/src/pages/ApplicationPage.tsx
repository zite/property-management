import { Ban, ChevronDown, ChevronUp, CircleCheck, FileSignature, KeyRound, Link2, MoreHorizontal, RotateCcw, Undo2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { applicationRef, leaseRef } from '@project/shared/leases';
import { DetailLayout } from '../components/detail/DetailLayout';
import { ApplicationMain, ApplicationRail } from '../components/leasing/ApplicationDetail';
import type { ApplicationPickerKind } from '../components/leasing/ApplicationPicker';
import { APP_NAV_ORDER_KEY, useApplication, useApplicationActions } from '../components/leasing/data';
import { DecisionDialog, leaseDefaultsFor, type DecisionKind } from '../components/leasing/DecisionDialog';
import { EmptyState, IconButton, SkeletonRows, Tip } from '../components/primitives/bits';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { copyText } from '../lib/clipboard';
import { errorMessage } from '../lib/errors';
import { appUrl } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { useWorkspace } from '../lib/workspace';

function useNeighbours(number: number) {
  let order: number[] = [];
  try {
    order = JSON.parse(sessionStorage.getItem(APP_NAV_ORDER_KEY) ?? '[]');
  } catch {
    /* storage unavailable */
  }
  const i = order.indexOf(number);
  return { prev: i > 0 ? order[i - 1] : null, next: i >= 0 && i < order.length - 1 ? order[i + 1] : null, index: i, total: order.length };
}

const ghost = 'inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] font-medium shadow-2xs hover:bg-accent [&_svg]:h-3.5 [&_svg]:w-3.5';
const primary = 'inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 [&_svg]:h-3.5 [&_svg]:w-3.5';

/**
 * A rental application: everything the applicant told us, the screening
 * checklist, the conversation, and the decision. Approve and deny live in the
 * header; an approved application turns into a lease from here.
 */
export function ApplicationPage() {
  const ws = useWorkspace();
  const actions = useAppActions();
  const params = useParams();
  const number = Number(params.number);
  const navigate = useNavigate();
  const { data, isPending, isError, error } = useApplication(Number.isFinite(number) && number > 0 ? number : null);
  const { update } = useApplicationActions();
  const [picker, setPicker] = useState<ApplicationPickerKind | null>(null);
  const [decision, setDecision] = useState<DecisionKind | null>(null);
  const a = data?.application;
  useDocumentTitle(a ? `${applicationRef(a.number)} ${a.applicantName}` : 'Application');
  const { prev, next, index, total } = useNeighbours(number);
  const busy = Boolean(picker || decision);
  useHotkeys(
    {
      k: () => prev && navigate(`/applications/${prev}`),
      j: () => next && navigate(`/applications/${next}`),
      esc: () => navigate('/leasing/applications'),
      s: () => a && setPicker('status'),
      a: () => a && setPicker('assignee'),
      m: () => a && setPicker('moveIn'),
      i: () => a && a.assigneeId !== ws.me.id && void update([a], { assigneeId: ws.me.id }, { toast: 'Assigned to you' }).catch(() => undefined),
    },
    { enabled: !busy },
  );

  const undecided = a?.status === 'Submitted' || a?.status === 'Screening';
  const header = (
    <PageHeader
      breadcrumb={{ to: '/leasing/applications', label: 'Applications' }}
      icon={<UserPlus />}
      title={a ? applicationRef(a.number) : 'Application'}
      actions={
        <>
          {index >= 0 && total > 1 && <span className="mr-1 hidden text-sm tabular-nums text-muted-foreground sm:inline">{index + 1} / {total}</span>}
          <Tip label="Previous" keys={['K']}><IconButton aria-label="Previous application" disabled={!prev} onClick={() => prev && navigate(`/applications/${prev}`)}><ChevronUp /></IconButton></Tip>
          <Tip label="Next" keys={['J']}><IconButton aria-label="Next application" disabled={!next} onClick={() => next && navigate(`/applications/${next}`)}><ChevronDown /></IconButton></Tip>
          <Tip label="Copy link"><IconButton aria-label="Copy link" onClick={() => void copyText(appUrl(`/applications/${number}`), 'Link copied')}><Link2 /></IconButton></Tip>
          {a && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><IconButton aria-label="More actions"><MoreHorizontal /></IconButton></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {['Submitted', 'Screening', 'Approved'].includes(a.status) && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => setDecision('withdraw')}><Undo2 className="h-3.5 w-3.5" /> Withdraw…</DropdownMenuItem>}
                  {['Approved', 'Denied', 'Withdrawn'].includes(a.status) && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => setDecision('reopen')}><RotateCcw className="h-3.5 w-3.5" /> Reopen…</DropdownMenuItem>}
                  {a.status === 'Approved' && <DropdownMenuItem className="h-9 gap-2 text-[14px] text-tone-danger focus:text-tone-danger" onSelect={() => setDecision('deny')}><Ban className="h-3.5 w-3.5" /> Deny…</DropdownMenuItem>}
                  {a.email && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void copyText(a.email, 'Email copied')}><Link2 className="h-3.5 w-3.5" /> Copy email</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
              {undecided && (
                <>
                  <button type="button" className={ghost} onClick={() => setDecision('deny')}><Ban /> <span className="hidden sm:inline">Deny</span></button>
                  <button type="button" className={primary} onClick={() => setDecision('approve')}><CircleCheck /> Approve</button>
                </>
              )}
              {a.status === 'Approved' && (data.lease ? (
                <Link to={`/leases/${data.lease.id}`} className={ghost}><KeyRound /> {leaseRef(data.lease.number)}</Link>
              ) : ws.can('residents.manage') ? (
                <button type="button" className={primary} onClick={() => actions.openCreate('lease', leaseDefaultsFor(a))}><FileSignature /> <span className="hidden sm:inline">Create lease</span></button>
              ) : null)}
              {a.status === 'Leased' && data.lease && <Link to={`/leases/${data.lease.id}`} className={ghost}><KeyRound /> Leased → {leaseRef(data.lease.number)}</Link>}
              {(a.status === 'Denied' || a.status === 'Withdrawn') && <button type="button" className={ghost} onClick={() => setDecision('reopen')}><RotateCcw /> Reopen</button>}
            </>
          )}
        </>
      }
    />
  );

  if (isPending) {
    return (
      <DetailLayout header={header}>
        <div className="skeleton h-8 w-56" />
        <div className="skeleton mt-2 h-4 w-80" />
        <div className="skeleton mt-6 h-20 w-full" />
        <SkeletonRows rows={6} className="mt-6 -mx-5" />
      </DetailLayout>
    );
  }
  if (isError || !data || !a) {
    return (
      <DetailLayout header={header}>
        <EmptyState icon={<UserPlus />} title="Application not found" description={errorMessage(error, 'It may have been withdrawn before it was sent, or the link is wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => navigate('/leasing/applications')}>Back to applications</button>} />
      </DetailLayout>
    );
  }

  const otherOpen = data.others.filter(o => ['Submitted', 'Screening', 'Approved'].includes(o.status)).length;
  return (
    <DetailLayout header={header} rail={<ApplicationRail detail={data} picker={picker} setPicker={setPicker} onDecide={setDecision} />}>
      <ApplicationMain detail={data} onDecide={setDecision} />
      <DecisionDialog kind={decision} target={a} otherOpen={otherOpen} onOpenChange={o => !o && setDecision(null)} />
    </DetailLayout>
  );
}
