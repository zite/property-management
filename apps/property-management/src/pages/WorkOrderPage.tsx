import { ChevronDown, ChevronUp, Link2, Wrench } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { workOrderRef } from '@project/shared/leases';
import { DetailLayout } from '../components/detail/DetailLayout';
import { EmptyState, IconButton, SkeletonRows, Tip } from '../components/primitives/bits';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { NAV_ORDER_KEY, useWorkOrder } from '../components/workOrders/data';
import { useWorkOrderShortcuts, WorkOrderMain, WorkOrderRail } from '../components/workOrders/WorkOrderDetail';
import type { WorkOrderPickerKind } from '../components/workOrders/WorkOrderPicker';
import { copyText } from '../lib/clipboard';
import { errorMessage } from '../lib/errors';
import { appUrl } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';

/** Neighbouring work orders in the order the last list showed them, for J/K between records. */
function useNeighbours(number: number) {
  let order: number[] = [];
  try {
    order = JSON.parse(sessionStorage.getItem(NAV_ORDER_KEY) ?? '[]');
  } catch {
    /* storage unavailable */
  }
  const i = order.indexOf(number);
  return { prev: i > 0 ? order[i - 1] : null, next: i >= 0 && i < order.length - 1 ? order[i + 1] : null, index: i, total: order.length };
}

export function WorkOrderPage() {
  const params = useParams();
  const number = Number(params.number);
  const navigate = useNavigate();
  const { data, isPending, isError, error } = useWorkOrder(Number.isFinite(number) ? number : null);
  const [picker, setPicker] = useState<WorkOrderPickerKind | null>(null);
  const w = data?.workOrder;
  useDocumentTitle(w ? `${workOrderRef(w.number)} ${w.title}` : 'Work order');
  useWorkOrderShortcuts(data, setPicker, !picker);
  const { prev, next, index, total } = useNeighbours(number);
  useHotkeys({
    k: () => prev && navigate(`/work-orders/${prev}`),
    j: () => next && navigate(`/work-orders/${next}`),
    esc: () => navigate('/work-orders'),
  }, { enabled: !picker });

  const header = (
    <PageHeader
      breadcrumb={{ to: '/work-orders', label: 'Work orders' }}
      icon={<Wrench />}
      title={w ? workOrderRef(w.number) : 'Work order'}
      actions={
        <>
          {index >= 0 && total > 1 && (
            <span className="mr-1 hidden text-sm tabular-nums text-muted-foreground sm:inline">
              {index + 1} / {total}
            </span>
          )}
          <Tip label="Previous" keys={['K']}>
            <IconButton aria-label="Previous work order" disabled={!prev} onClick={() => prev && navigate(`/work-orders/${prev}`)}>
              <ChevronUp />
            </IconButton>
          </Tip>
          <Tip label="Next" keys={['J']}>
            <IconButton aria-label="Next work order" disabled={!next} onClick={() => next && navigate(`/work-orders/${next}`)}>
              <ChevronDown />
            </IconButton>
          </Tip>
          <Tip label="Copy link">
            <IconButton aria-label="Copy link" onClick={() => void copyText(appUrl(`/work-orders/${number}`), 'Link copied')}>
              <Link2 />
            </IconButton>
          </Tip>
        </>
      }
    />
  );

  if (isPending) {
    return (
      <DetailLayout header={header}>
        <SkeletonRows rows={10} />
      </DetailLayout>
    );
  }
  if (isError || !data) {
    return (
      <DetailLayout header={header}>
        <EmptyState icon={<Wrench />} title="Work order not found" description={errorMessage(error, 'It may have been deleted, or the link is wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => navigate('/work-orders')}>Back to work orders</button>} />
      </DetailLayout>
    );
  }

  return (
    <DetailLayout header={header} rail={<WorkOrderRail detail={data} picker={picker} setPicker={setPicker} />}>
      <WorkOrderMain detail={data} />
    </DetailLayout>
  );
}
