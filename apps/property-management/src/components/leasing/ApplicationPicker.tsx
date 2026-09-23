import { useMemo, useState, type ReactNode } from 'react';
import { Ban, CalendarDays, CircleCheck, RotateCcw, Undo2, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { applicationRef } from '@project/shared/leases';
import { useWorkspace } from '../../lib/workspace';
import { MemberPicker } from '../pickers/pickers';
import { OptionPicker } from '../pickers/OptionPicker';
import { ApplicationStatusGlyph } from '../primitives/glyphs';
import { addDays, todayString } from '../../lib/format';
import { DateInput } from '../form/fields';
import { useApplicationActions, type Application } from './data';
import type { DecisionKind } from './DecisionDialog';

export type ApplicationPickerKind = 'status' | 'assignee' | 'moveIn';

type Target = Pick<Application, 'id' | 'number' | 'status' | 'assigneeId' | 'desiredMoveIn'>;

/**
 * One picker per application property, for rows, cards, the rail, the bulk bar
 * and the keyboard. Status offers Submitted and Screening directly; the
 * decisions open the decision dialog instead of changing anything here.
 */
export function ApplicationPicker({ kind, targets, trigger, open, onOpenChange, align = 'start', onDecide }: {
  kind: ApplicationPickerKind;
  targets: Target[];
  trigger: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
  onDecide?: (kind: DecisionKind, target: Target) => void;
}) {
  const ws = useWorkspace();
  const { update } = useApplicationActions();
  const first = targets[0];
  const single = targets.length === 1 ? first : null;
  const common = { trigger, open, onOpenChange, align };
  const same = <K extends keyof Target>(key: K) => (targets.every(t => t[key] === first?.[key]) ? first?.[key] : undefined);

  const statusOptions = useMemo(() => {
    const undecided = targets.every(t => t.status === 'Submitted' || t.status === 'Screening');
    const out: Array<{ value: string; label: string; icon: ReactNode; shortcut?: string; group?: string; disabled?: boolean; hint?: ReactNode }> = [
      { value: 'Submitted', label: 'Submitted', icon: <ApplicationStatusGlyph status="Submitted" />, shortcut: '1', disabled: !undecided },
      { value: 'Screening', label: 'Screening', icon: <ApplicationStatusGlyph status="Screening" />, shortcut: '2', disabled: !undecided },
    ];
    if (single && onDecide) {
      if (single.status === 'Submitted' || single.status === 'Screening') {
        out.push({ value: 'approve', label: 'Approve…', icon: <CircleCheck className="h-3.5 w-3.5 text-tone-success" />, group: 'Decision', shortcut: '3' });
        out.push({ value: 'deny', label: 'Deny…', icon: <Ban className="h-3.5 w-3.5 text-tone-danger" />, group: 'Decision', shortcut: '4' });
      }
      if (single.status === 'Approved') out.push({ value: 'deny', label: 'Deny…', icon: <Ban className="h-3.5 w-3.5 text-tone-danger" />, group: 'Decision' });
      if (['Submitted', 'Screening', 'Approved'].includes(single.status)) out.push({ value: 'withdraw', label: 'Withdraw…', icon: <Undo2 className="h-3.5 w-3.5 text-muted-foreground" />, group: 'Decision' });
      if (['Approved', 'Denied', 'Withdrawn'].includes(single.status)) out.push({ value: 'reopen', label: 'Reopen…', icon: <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />, group: 'Decision' });
    }
    return out;
  }, [targets, single, onDecide]);

  switch (kind) {
    case 'status':
      return (
        <OptionPicker
          {...common}
          width={230}
          options={statusOptions}
          value={(same('status') as string) ?? null}
          placeholder={single ? `${applicationRef(single.number)} status…` : `Status for ${targets.length}…`}
          emptyText="No matching status"
          onChange={v => {
            if (!v) return;
            if (v === 'approve' || v === 'deny' || v === 'withdraw' || v === 'reopen') {
              onOpenChange?.(false);
              if (single) onDecide?.(v, single);
              return;
            }
            const movable = targets.filter(t => (t.status === 'Submitted' || t.status === 'Screening') && t.status !== v);
            if (movable.length) void update(movable, { status: v as 'Submitted' | 'Screening' }, { toast: movable.length === 1 ? `${applicationRef(movable[0].number)} → ${v}` : undefined }).catch(() => undefined);
          }}
        />
      );
    case 'assignee':
      return <MemberPicker {...common} value={(same('assigneeId') as string | null) ?? null} onChange={id => void update(targets, { assigneeId: id }, { toast: targets.length === 1 ? (id ? `Assigned to ${id === ws.me.id ? 'you' : ws.memberName(id)}` : 'Unassigned') : undefined }).catch(() => undefined)} filter={m => ['Admin', 'Property Manager', 'Leasing Agent'].includes(m.role)} />;
    case 'moveIn':
      return <MoveInPicker {...common} value={(same('desiredMoveIn') as string | null) ?? null} onChange={d => void update(targets, { desiredMoveIn: d }).catch(() => undefined)} />;
  }
}

const quick = 'flex h-9 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[14px] outline-none hover:bg-accent focus-visible:bg-accent';

/** A move-in date: the usual starts (the 1st, two weeks out) or any day. */
export function MoveInPicker({ value, onChange, trigger, open, onOpenChange, align = 'start' }: { value: string | null; onChange: (day: string | null) => void; trigger: ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void; align?: 'start' | 'center' | 'end' }) {
  const [inner, setInner] = useState(false);
  const isOpen = open ?? inner;
  const set = (o: boolean) => (onOpenChange ? onOpenChange(o) : setInner(o));
  const today = todayString();
  const [y, m] = today.split('-').map(Number);
  const firstOf = (offset: number) => {
    const d = new Date(y, m - 1 + offset, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  };
  const options = [
    { label: 'First of next month', day: firstOf(1) },
    { label: 'In two weeks', day: addDays(14) },
    { label: 'In 30 days', day: addDays(30) },
    { label: 'First of the month after', day: firstOf(2) },
  ];
  const pick = (d: string | null) => {
    onChange(d);
    set(false);
  };
  return (
    <Popover open={isOpen} onOpenChange={set}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="w-[260px] p-1 shadow-lg" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        {options.map(o => (
          <button key={o.label} type="button" className={quick} onClick={() => pick(o.day)}>
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="flex-1">{o.label}</span>
            <span className="text-sm text-muted-foreground">{new Date(`${o.day}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          </button>
        ))}
        <div className="my-1 border-t" />
        <div className="px-1.5 pb-1.5 pt-1">
          <DateInput value={value} onChange={d => d && pick(d)} min={today} />
        </div>
        {value && (
          <button type="button" className={quick} onClick={() => pick(null)}>
            <X className="h-3.5 w-3.5 text-muted-foreground" /> Clear move-in date
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
