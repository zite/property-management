import { CalendarClock, CalendarDays, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { WORK_ORDER_CATEGORIES, WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES, type WorkOrderPriority, type WorkOrderStatus } from '@project/shared/constants';
import { addDays, shortDateTime, todayString } from '../../lib/format';
import { DateInput, DateTimeInput } from '../form/fields';
import { MemberPicker, VendorPicker } from '../pickers/pickers';
import { OptionPicker } from '../pickers/OptionPicker';
import { PriorityGlyph, WorkOrderStatusGlyph } from '../primitives/glyphs';
import { useWorkOrderActions, type WorkOrder, type WorkOrderPatch } from './data';

export type WorkOrderPickerKind = 'status' | 'priority' | 'assignee' | 'vendor' | 'category' | 'due' | 'schedule';

const CATEGORY_TRADE: Record<string, string> = { 'Locks & keys': 'Locksmith', Turnover: 'General', Safety: 'General', 'Doors & windows': 'General' };
export const tradeFor = (category: string) => CATEGORY_TRADE[category] ?? category;

/**
 * One picker for any work order property, applied to one or many work orders.
 * Rows, cards, the detail rail, the bulk bar and the keyboard shortcuts all
 * open this, so a change has one code path.
 */
export function WorkOrderPicker({ kind, targets, trigger, open, onOpenChange, align = 'start', onDone }: {
  kind: WorkOrderPickerKind;
  targets: WorkOrder[];
  trigger: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
  onDone?: () => void;
}) {
  const { update } = useWorkOrderActions();
  const first = targets[0];
  const many = targets.length > 1;
  const same = <K extends keyof WorkOrder>(key: K) => (targets.every(t => t[key] === first?.[key]) ? first?.[key] : undefined);
  const apply = (patch: WorkOrderPatch) => {
    onDone?.();
    void update(targets, patch).catch(() => undefined);
  };
  const common = { trigger, open, onOpenChange, align };

  const statusOptions = useMemo(() => WORK_ORDER_STATUSES.map((s, i) => ({ value: s, label: s, icon: <WorkOrderStatusGlyph status={s} />, shortcut: String(i + 1) })), []);
  const priorityOptions = useMemo(() => WORK_ORDER_PRIORITIES.map((p, i) => ({ value: p, label: p, icon: <PriorityGlyph priority={p} />, shortcut: String(i + 1) })), []);
  const categoryOptions = useMemo(() => WORK_ORDER_CATEGORIES.map(c => ({ value: c, label: c })), []);

  switch (kind) {
    case 'status':
      return <OptionPicker {...common} options={statusOptions} value={(same('status') as WorkOrderStatus) ?? null} onChange={v => v && apply({ status: v })} placeholder={many ? `Status for ${targets.length}…` : 'Change status…'} />;
    case 'priority':
      return <OptionPicker {...common} options={priorityOptions} value={(same('priority') as WorkOrderPriority) ?? null} onChange={v => v && apply({ priority: v })} placeholder="Set priority…" />;
    case 'category':
      return <OptionPicker {...common} options={categoryOptions} value={(same('category') as string) ?? null} onChange={v => v && apply({ category: v as WorkOrderPatch['category'] })} placeholder="Set category…" width={220} />;
    case 'assignee':
      return <MemberPicker {...common} value={(same('assigneeId') as string | null) ?? null} onChange={id => apply({ assigneeId: id })} filter={m => m.role !== 'Accountant'} />;
    case 'vendor':
      return <VendorPicker {...common} value={(same('vendorId') as string | null) ?? null} onChange={id => apply({ vendorId: id })} trade={first ? tradeFor(first.category) : null} />;
    case 'due':
      return <DuePicker {...common} value={(same('dueDate') as string | null) ?? null} onChange={d => apply({ dueDate: d })} />;
    case 'schedule':
      return <SchedulePicker {...common} value={(same('scheduledFor') as string | null) ?? null} onChange={d => apply({ scheduledFor: d })} />;
  }
}

function PopoverShell({ trigger, open, onOpenChange, align, children, width = 248 }: { trigger: ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void; align?: 'start' | 'center' | 'end'; children: (close: () => void) => ReactNode; width?: number }) {
  const [inner, setInner] = useState(false);
  const isOpen = open ?? inner;
  const set = (o: boolean) => (onOpenChange ? onOpenChange(o) : setInner(o));
  return (
    <Popover open={isOpen} onOpenChange={set}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="p-1 shadow-lg" style={{ width }} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        {children(() => set(false))}
      </PopoverContent>
    </Popover>
  );
}

const quick = 'flex h-9 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[14px] hover:bg-accent focus-visible:bg-accent outline-none';

export function DuePicker({ value, onChange, ...rest }: { value: string | null; onChange: (day: string | null) => void; trigger: ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void; align?: 'start' | 'center' | 'end' }) {
  const today = todayString();
  const options = [
    { label: 'Today', day: today },
    { label: 'Tomorrow', day: addDays(1) },
    { label: 'In 3 days', day: addDays(3) },
    { label: 'In a week', day: addDays(7) },
    { label: 'In two weeks', day: addDays(14) },
  ];
  return (
    <PopoverShell {...rest}>
      {close => (
        <div>
          {options.map(o => (
            <button key={o.label} type="button" className={quick} onClick={() => { onChange(o.day); close(); }}>
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1">{o.label}</span>
              <span className="text-sm text-muted-foreground">{new Date(`${o.day}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            </button>
          ))}
          <div className="my-1 border-t" />
          <div className="px-1.5 pb-1.5 pt-1">
            <DateInput value={value} onChange={d => { onChange(d); if (d) close(); }} />
          </div>
          {value && (
            <button type="button" className={quick} onClick={() => { onChange(null); close(); }}>
              <X className="h-3.5 w-3.5 text-muted-foreground" /> Remove due date
            </button>
          )}
        </div>
      )}
    </PopoverShell>
  );
}

export function SchedulePicker({ value, onChange, ...rest }: { value: string | null; onChange: (iso: string | null) => void; trigger: ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void; align?: 'start' | 'center' | 'end' }) {
  const at = (days: number, hour: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const [draft, setDraft] = useState<string | null>(value);
  const options = [
    { label: 'Tomorrow morning', iso: at(1, 9) },
    { label: 'Tomorrow afternoon', iso: at(1, 13) },
    { label: 'In 2 days, 9 AM', iso: at(2, 9) },
    { label: 'Next week, 9 AM', iso: at(7, 9) },
  ];
  return (
    <PopoverShell {...rest} width={272}>
      {close => (
        <div>
          {options.map(o => (
            <button key={o.label} type="button" className={quick} onClick={() => { onChange(o.iso); close(); }}>
              <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1">{o.label}</span>
              <span className="text-sm text-muted-foreground">{shortDateTime(o.iso).replace(/^\w+, /, '')}</span>
            </button>
          ))}
          <div className="my-1 border-t" />
          <div className="flex items-center gap-1.5 px-1.5 pb-1.5 pt-1">
            <DateTimeInput value={draft} onChange={setDraft} className="flex-1" />
            <button type="button" disabled={!draft} onClick={() => { onChange(draft); close(); }} className="h-9 rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground disabled:opacity-40">
              Set
            </button>
          </div>
          {value && (
            <button type="button" className={quick} onClick={() => { onChange(null); close(); }}>
              <X className="h-3.5 w-3.5 text-muted-foreground" /> Clear schedule
            </button>
          )}
        </div>
      )}
    </PopoverShell>
  );
}
