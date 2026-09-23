import { CalendarX2, CircleCheck, Copy, Link2, PanelRight, SquareArrowOutUpRight, UserRoundCheck, Wrench } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger,
} from '@project/components/ui/context-menu';
import { WORK_ORDER_CATEGORIES, WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES } from '@project/shared/constants';
import { workOrderRef } from '@project/shared/leases';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { appUrl } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { PriorityGlyph, WorkOrderStatusGlyph } from '../primitives/glyphs';
import { useWorkOrderActions, type WorkOrder } from './data';
import { tradeFor } from './WorkOrderPicker';

const item = 'h-9 gap-2 text-[14px]';
const sub = 'max-h-[360px] min-w-[210px] overflow-y-auto';

/** Right-click on a work order row or card. Acts on the whole selection when the row is part of it. */
export function WorkOrderMenu({ targets }: { targets: WorkOrder[] }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const { update } = useWorkOrderActions();
  if (!targets.length) return null;
  const single = targets.length === 1 ? targets[0] : null;
  const apply = (patch: Parameters<typeof update>[1]) => void update(targets, patch).catch(() => undefined);
  const vendors = [...ws.activeVendors].sort((a, b) => Number(b.trade === tradeFor(single?.category ?? '')) - Number(a.trade === tradeFor(single?.category ?? '')) || a.name.localeCompare(b.name));
  const manager = ws.can('maintenance.manage');

  return (
    <div onClick={e => e.stopPropagation()}>
      {!single && <div className="px-2 pb-1 pt-1.5 text-2xs font-medium text-muted-foreground">{targets.length} work orders selected</div>}
      {single && (
        <>
          <ContextMenuItem className={item} onSelect={() => navigate(`/work-orders/${single.number}`)}>
            <SquareArrowOutUpRight className="h-3.5 w-3.5" /> Open <ContextMenuShortcut>↵</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem className={item} onSelect={() => app.peekWorkOrder(single.number)}>
            <PanelRight className="h-3.5 w-3.5" /> Peek <ContextMenuShortcut>Space</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuSub>
        <ContextMenuSubTrigger className={item}>
          <WorkOrderStatusGlyph status={single?.status ?? 'In progress'} /> Status
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className={sub}>
          {WORK_ORDER_STATUSES.map((s, i) => (
            <ContextMenuItem key={s} className={item} onSelect={() => apply({ status: s })}>
              <WorkOrderStatusGlyph status={s} /> {s} <ContextMenuShortcut>{i + 1}</ContextMenuShortcut>
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger className={item}>
          <PriorityGlyph priority={single?.priority ?? 'High'} /> Priority
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className={sub}>
          {WORK_ORDER_PRIORITIES.map(p => (
            <ContextMenuItem key={p} className={item} onSelect={() => apply({ priority: p })}>
              <PriorityGlyph priority={p} /> {p}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger className={item}>
          <UserRoundCheck className="h-3.5 w-3.5" /> Assignee
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className={sub}>
          <ContextMenuItem className={item} onSelect={() => apply({ assigneeId: null })}>
            <UnassignedAvatar size={16} /> Unassigned
          </ContextMenuItem>
          {ws.activeMembers.filter(m => m.role !== 'Accountant').map(m => (
            <ContextMenuItem key={m.id} className={item} onSelect={() => apply({ assigneeId: m.id })}>
              <MemberAvatar member={m} size={16} /> {m.id === ws.me.id ? `${m.name} (you)` : m.name}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {manager && (
        <ContextMenuSub>
          <ContextMenuSubTrigger className={item}>
            <Wrench className="h-3.5 w-3.5" /> Vendor
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className={sub}>
            <ContextMenuItem className={item} onSelect={() => apply({ vendorId: null })}>
              In-house
            </ContextMenuItem>
            <ContextMenuSeparator />
            {vendors.map(v => (
              <ContextMenuItem key={v.id} className={item} onSelect={() => apply({ vendorId: v.id })}>
                <span className="min-w-0 flex-1 truncate">{v.name}</span>
                <span className="text-sm text-muted-foreground">{v.trade}</span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuSub>
        <ContextMenuSubTrigger className={item}>
          <span className="w-3.5" /> Category
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className={sub}>
          {WORK_ORDER_CATEGORIES.map(c => (
            <ContextMenuItem key={c} className={item} onSelect={() => apply({ category: c })}>
              {c}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      {!targets.every(t => t.assigneeId === ws.me.id) && (
        <ContextMenuItem className={item} onSelect={() => apply({ assigneeId: ws.me.id })}>
          <UserRoundCheck className="h-3.5 w-3.5" /> Assign to me <ContextMenuShortcut>I</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {!targets.every(t => t.status === 'Completed') && (
        <ContextMenuItem className={item} onSelect={() => apply({ status: 'Completed' })}>
          <CircleCheck className="h-3.5 w-3.5" /> Mark completed
        </ContextMenuItem>
      )}
      {targets.some(t => t.scheduledFor) && (
        <ContextMenuItem className={item} onSelect={() => apply({ scheduledFor: null })}>
          <CalendarX2 className="h-3.5 w-3.5" /> Clear schedule
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        className={item}
        onSelect={() => {
          void copyText(targets.map(t => appUrl(`/work-orders/${t.number}`)).join('\n'), single ? `Copied link to ${workOrderRef(single.number)}` : `Copied ${targets.length} links`);
        }}
      >
        <Link2 className="h-3.5 w-3.5" /> Copy link
      </ContextMenuItem>
      <ContextMenuItem
        className={item}
        onSelect={() => {
          void copyText(targets.map(t => `${workOrderRef(t.number)} ${t.title}`).join('\n'));
        }}
      >
        <Copy className="h-3.5 w-3.5" /> Copy ID and title
      </ContextMenuItem>
    </div>
  );
}
