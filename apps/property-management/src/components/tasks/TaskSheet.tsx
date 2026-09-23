import { CalendarDays, Link2, Pencil, Tag, Trash2, X, Zap } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@project/components/ui/sheet';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../lib/errors';
import { appUrl, dateTime, shortDate, timeAgo } from '../../lib/format';
import { MOD, useHotkeys } from '../../lib/hotkeys';
import { useWorkspace } from '../../lib/workspace';
import { RailRow, RailSection, SectionHeading } from '../detail/DetailLayout';
import { Timeline } from '../detail/Timeline';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { EmptyState, IconButton, SkeletonRows, Tip } from '../primitives/bits';
import { Pill, PriorityGlyph, TaskStatusGlyph } from '../primitives/glyphs';
import { DueChip } from '../workOrders/WorkOrderRow';
import { canManageTasks, glyphPriority, isClosed, relatedList, useTask, useTaskActions, type Task, type TaskPatch } from './data';
import { TaskPicker, type TaskPickerKind } from './TaskPicker';
import { CompletionCircle, RELATED_ICON } from './TaskRow';

const chip = 'ghost-chip h-8 max-w-full justify-start gap-1.5 px-1.5 text-[14px] [&_svg]:shrink-0';

/** Title and description that edit in place, saving on blur, Enter (title) or ⌘↵ (description). */
function InlineText({ value, onSave, placeholder, multiline, className, label }: { value: string; onSave: (v: string) => void; placeholder: string; multiline?: boolean; className?: string; label: string }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  const commit = () => {
    const next = multiline ? text.replace(/\s+$/, '') : text.trim();
    if (next === value) return;
    if (!multiline && !next) {
      setText(value);
      return;
    }
    onSave(next);
  };
  return (
    <textarea
      ref={ref}
      aria-label={label}
      value={text}
      rows={1}
      maxLength={multiline ? 5000 : 240}
      onChange={e => setText(multiline ? e.target.value : e.target.value.replace(/\n/g, ''))}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setText(value);
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      placeholder={placeholder}
      className={cn('block w-full resize-none overflow-hidden rounded-md bg-transparent outline-none placeholder:text-muted-foreground/70 focus:bg-accent/30', className)}
    />
  );
}

/**
 * A task in a side sheet over the list: edit anything in place, see what it's
 * linked to and its history, close without losing your place. Opens from a
 * row, a notification or a dashboard link (`/tasks?task=<id>`).
 */
export function TaskSheet({ id, initial, onClose }: { id: string; initial?: Task | null; onClose: () => void }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const { update, remove } = useTaskActions();
  const { data, isPending, isError, error } = useTask(id);
  const [picker, setPicker] = useState<TaskPickerKind | null>(null);
  const t = data?.task ?? initial ?? null;
  const patch = (p: TaskPatch, undo = false) => t && void update([t], p, { ws, undo, toast: undo ? undefined : false }).catch(() => undefined);
  const toggleDone = () => t && patch({ status: isClosed(t) ? 'To do' : 'Done' }, true);

  useHotkeys(
    {
      s: () => setPicker('status'),
      p: () => setPicker('priority'),
      a: () => setPicker('assignee'),
      d: () => setPicker('due'),
      i: () => t && t.assigneeId !== ws.me.id && patch({ assigneeId: ws.me.id }),
      'mod+shift+enter': toggleDone,
    },
    { enabled: Boolean(t) && !picker, allowInOverlay: true },
  );

  const assignee = t?.assigneeId ? ws.memberById.get(t.assigneeId) : undefined;
  const creator = t?.createdById ? ws.memberById.get(t.createdById) : undefined;
  const related = t ? relatedList(t, ws) : [];
  const closed = t ? isClosed(t) : false;
  const deletable = t && !t.systemKey && (canManageTasks(ws) || t.createdById === ws.me.id);
  const pick = (kind: TaskPickerKind, children: ReactNode) =>
    t && <TaskPicker kind={kind} targets={[t]} open={picker === kind} onOpenChange={o => setPicker(o ? kind : null)} align="end" trigger={<button type="button" className={chip}>{children}</button>} />;

  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[820px] [&>button:first-of-type]:hidden" onOpenAutoFocus={e => e.preventDefault()}>
        <SheetTitle className="sr-only">{t?.title ?? 'Task'}</SheetTitle>
        <SheetDescription className="sr-only">Task details</SheetDescription>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          {t && (
            <>
              <CompletionCircle status={t.status} onToggle={toggleDone} />
              <span className="text-[14px] text-muted-foreground">Task</span>
              {t.systemKey && (
                <Tip label="Opened automatically on the daily run — a lease nearing its end, a move-out, expiring vendor insurance.">
                  <span><Pill tone="accent"><Zap className="h-3 w-3" /> Automatic</Pill></span>
                </Tip>
              )}
              {closed && t.completedAt && <span className="hidden text-sm text-muted-foreground sm:inline">{t.status === 'Done' ? 'Completed' : 'Closed'} {timeAgo(t.completedAt)}</span>}
            </>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            {t && (
              <Tip label="Edit details and links">
                <IconButton aria-label="Edit task" onClick={() => app.openCreate('task', { taskId: t.id })}>
                  <Pencil />
                </IconButton>
              </Tip>
            )}
            <Tip label="Copy link">
              <IconButton aria-label="Copy link" onClick={() => void copyText(appUrl(`/tasks?task=${id}`), 'Link copied')}>
                <Link2 />
              </IconButton>
            </Tip>
            {deletable && (
              <Tip label="Delete task">
                <IconButton
                  aria-label="Delete task"
                  onClick={async () => {
                    const ok = await app.confirm({ title: `Delete “${t!.title.slice(0, 60)}”?`, description: 'It’s removed for everyone and can’t be restored. Mark it done instead if you want to keep a record.', confirmLabel: 'Delete task', destructive: true });
                    if (!ok) return;
                    try {
                      await remove([t!]);
                      onClose();
                    } catch {
                      /* toasted */
                    }
                  }}
                >
                  <Trash2 />
                </IconButton>
              </Tip>
            )}
            <Tip label="Close" keys={['Esc']}>
              <IconButton aria-label="Close" onClick={onClose}>
                <X />
              </IconButton>
            </Tip>
          </div>
        </div>
        {!t && isPending ? (
          <SkeletonRows rows={8} className="p-5" />
        ) : !t || (isError && !data) ? (
          <EmptyState className="flex-1" title="This task didn’t load" description={errorMessage(error, 'It may have been deleted, or it isn’t yours to see.')} action={<button type="button" className="ghost-chip h-9" onClick={onClose}>Close</button>} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
            <div className="min-w-0 flex-1 px-6 pb-16 pt-5 md:overflow-y-auto">
              <InlineText label="Title" value={t.title} onSave={title => patch({ title })} placeholder="Task title" className={cn('-mx-1.5 px-1.5 py-1 text-[18px] font-semibold leading-7 tracking-tight', closed && 'text-muted-foreground line-through decoration-muted-foreground/40')} />
              <InlineText label="Description" value={t.description} onSave={description => patch({ description })} placeholder="Add details — what needs doing, who to call, what done looks like…" multiline className="-mx-1.5 mt-1 min-h-[28px] px-1.5 py-1 text-[15px] leading-relaxed text-foreground/90" />

              <SectionHeading
                count={related.length || undefined}
                action={<button type="button" className="ghost-chip h-8 text-sm text-muted-foreground" onClick={() => app.openCreate('task', { taskId: t.id })}>{related.length ? 'Change' : 'Link a record'}</button>}
              >
                Linked to
              </SectionHeading>
              {related.length ? (
                <div className="overflow-hidden rounded-lg border">
                  {related.map(r => {
                    const body = (
                      <>
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">{RELATED_ICON[r.kind]}</span>
                        <span className="w-[84px] shrink-0 text-sm text-muted-foreground">{r.noun}</span>
                        <span className="min-w-0 flex-1 truncate">{r.label}</span>
                      </>
                    );
                    return r.to ? (
                      <Link key={r.kind} to={r.to} className="flex h-10 items-center gap-2.5 border-b px-3 text-[14px] last:border-b-0 hover:bg-accent/50">{body}</Link>
                    ) : (
                      <div key={r.kind} className="flex h-10 items-center gap-2.5 border-b px-3 text-[14px] last:border-b-0">{body}</div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[14px] text-muted-foreground">Not linked to a property, lease, resident or work order.</p>
              )}

              <SectionHeading>Activity</SectionHeading>
              {data ? <Timeline activity={data.activity} emptyText="No changes yet" /> : <SkeletonRows rows={3} />}
            </div>
            <aside className="order-first border-b bg-subtle/40 md:order-none md:w-[272px] md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-l">
              <RailSection>
                <RailRow label="Status">{pick('status', <><TaskStatusGlyph status={t.status} size={14} /> {t.status}</>)}</RailRow>
                <RailRow label="Priority">{pick('priority', <><PriorityGlyph priority={glyphPriority(t.priority)} /> {t.priority}</>)}</RailRow>
                <RailRow label="Assignee">{pick('assignee', assignee ? <><MemberAvatar member={assignee} size={18} /> <span className="truncate">{assignee.id === ws.me.id ? `${assignee.name} (you)` : assignee.name}</span></> : <><UnassignedAvatar size={18} /> <span className="text-muted-foreground">Unassigned</span></>)}</RailRow>
                <RailRow label="Due">{pick('due', t.dueDate ? <><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" /> <DueChip day={t.dueDate} closed={closed} className="text-[14px]" /></> : <span className="text-muted-foreground">No due date</span>)}</RailRow>
                <RailRow label="Category">{pick('category', <><Tag className="h-3.5 w-3.5 text-muted-foreground" /> {t.category}</>)}</RailRow>
              </RailSection>
              <RailSection title="Details">
                <RailRow label="Created by">
                  <span className="flex min-w-0 items-center gap-1.5 px-1.5 text-[14px]">
                    {t.systemKey ? <><Zap className="h-3.5 w-3.5 text-muted-foreground" /> System</> : creator ? <><MemberAvatar member={creator} size={16} /> <span className="truncate">{creator.name}</span></> : <span className="text-muted-foreground">—</span>}
                  </span>
                </RailRow>
                {t.openedAt && <RailRow label="Opened"><Tip label={dateTime(t.openedAt)}><span className="px-1.5 text-[14px]">{shortDate(t.openedAt.slice(0, 10))}</span></Tip></RailRow>}
                {t.completedAt && <RailRow label={t.status === 'Canceled' ? 'Closed' : 'Completed'}><Tip label={dateTime(t.completedAt)}><span className="px-1.5 text-[14px]">{timeAgo(t.completedAt)}</span></Tip></RailRow>}
              </RailSection>
              <dl className="hidden grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 px-4 py-3 text-sm text-muted-foreground md:grid">
                {[['Change status', ['S']], ['Set priority', ['P']], ['Assign', ['A']], ['Assign to me', ['I']], ['Set due date', ['D']], [closed ? 'Reopen' : 'Mark done', [MOD, '⇧', '↵']]].map(([label, keys]) => (
                  <div key={label as string} className="contents">
                    <dt>{label as string}</dt>
                    <dd className="flex justify-end gap-1">{(keys as string[]).map(k => <kbd key={k} className="kbd">{k}</kbd>)}</dd>
                  </div>
                ))}
              </dl>
            </aside>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
