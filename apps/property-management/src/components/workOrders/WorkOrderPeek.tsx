import { Link2, Maximize2, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@project/components/ui/sheet';
import { workOrderRef } from '@project/shared/leases';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../lib/errors';
import { appUrl } from '../../lib/format';
import { useHotkeys } from '../../lib/hotkeys';
import { EmptyState, IconButton, SkeletonRows, Tip } from '../primitives/bits';
import { PriorityGlyph, WorkOrderStatusGlyph } from '../primitives/glyphs';
import { useWorkOrder } from './data';
import { useWorkOrderShortcuts, WorkOrderMain, WorkOrderRail } from './WorkOrderDetail';
import type { WorkOrderPickerKind } from './WorkOrderPicker';

/**
 * A work order in a side sheet over the list — read it, change it, reply,
 * and close without losing your place. ⇧↵ opens the full page.
 */
export default function WorkOrderPeek({ number, onClose }: { number: number; onClose: () => void }) {
  const navigate = useNavigate();
  const { data, isPending, isError, error } = useWorkOrder(number);
  const [picker, setPicker] = useState<WorkOrderPickerKind | null>(null);
  useWorkOrderShortcuts(data, setPicker, !picker, true);
  useHotkeys({ 'shift+enter': () => navigate(`/work-orders/${number}`) }, { allowInOverlay: true });
  const w = data?.workOrder;

  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[920px] [&>button:first-of-type]:hidden" onOpenAutoFocus={e => e.preventDefault()}>
        <SheetTitle className="sr-only">{w ? `${workOrderRef(w.number)} ${w.title}` : 'Work order'}</SheetTitle>
        <SheetDescription className="sr-only">Work order details</SheetDescription>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          {w && (
            <>
              <PriorityGlyph priority={w.priority} />
              <span className="text-[14px] tabular-nums text-muted-foreground">{workOrderRef(w.number)}</span>
              <WorkOrderStatusGlyph status={w.status} />
              <span className="min-w-0 truncate text-[14px] font-medium">{w.title}</span>
            </>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            <Tip label="Copy link">
              <IconButton aria-label="Copy link" onClick={() => void copyText(appUrl(`/work-orders/${number}`), 'Link copied')}>
                <Link2 />
              </IconButton>
            </Tip>
            <Tip label="Open full page" keys={['⇧', '↵']}>
              <IconButton aria-label="Open full page" onClick={() => navigate(`/work-orders/${number}`)}>
                <Maximize2 />
              </IconButton>
            </Tip>
            <Tip label="Close" keys={['Esc']}>
              <IconButton aria-label="Close" onClick={onClose}>
                <X />
              </IconButton>
            </Tip>
          </div>
        </div>
        {isPending ? (
          <SkeletonRows rows={8} className="p-5" />
        ) : isError || !data ? (
          <EmptyState className="flex-1" title="This work order didn’t load" description={errorMessage(error, 'It may have been deleted.')} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
            <div className="min-w-0 flex-1 px-6 pb-16 pt-5 md:overflow-y-auto">
              <WorkOrderMain detail={data} compact />
            </div>
            <aside className="order-first border-b bg-subtle/40 md:order-none md:w-[280px] md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-l">
              <WorkOrderRail detail={data} picker={picker} setPicker={setPicker} />
            </aside>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
