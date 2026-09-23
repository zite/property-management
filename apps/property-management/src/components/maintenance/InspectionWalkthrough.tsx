import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Camera, Check, ChevronDown, Flag, ImagePlus, Loader2, MoreHorizontal, NotebookPen, Plus, RotateCcw, Trash2, Wrench, X } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { saveInspection } from 'zitejs/api';
import { uploadFile } from 'zitejs/upload';
import { cn } from '@project/components/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { ITEM_CONDITIONS } from '@project/shared/constants';
import { areaStats, type InspectionArea, type InspectionItem } from '@project/shared/inspections';
import { workOrderRef } from '@project/shared/leases';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { longDate } from '../../lib/format';
import { useHotkeys } from '../../lib/hotkeys';
import { IconButton, ProgressBar, Tip } from '../primitives/bits';
import { Pill, WorkOrderStatusGlyph } from '../primitives/glyphs';
import { ConditionPill } from './bits';
import { CONDITION_RANK, isFlagged, mk, type InspectionDetail } from './data';
import type { ItemPatch, SaveState } from './useInspectionAutosave';

type Autosave = {
  change: (areaId: string, itemId: string, patch: ItemPatch, delay?: number) => void;
  retry: (areaId: string, itemId: string) => void;
  enqueue: <T>(fn: () => Promise<T>) => Promise<T>;
  states: Record<string, SaveState>;
};

/** Stable callbacks for item cards, so tapping one item doesn't re-render the other fifty. */
type ItemActions = {
  focus: (itemId: string) => void;
  createWorkOrder: (area: InspectionArea, item: InspectionItem) => void;
  remove: (area: InspectionArea, item: InspectionItem) => void;
};

type Condition = (typeof ITEM_CONDITIONS)[number];

const CONDITION_STYLE: Record<Condition, string> = {
  Good: 'border-tone-success/45 bg-tone-success/[0.12] text-tone-success',
  Fair: 'border-tone-warning/45 bg-tone-warning/[0.12] text-tone-warning',
  Poor: 'border-tone-danger/45 bg-tone-danger/[0.1] text-tone-danger',
  Damaged: 'border-tone-danger/45 bg-tone-danger/[0.14] text-tone-danger',
  Missing: 'border-tone-danger/45 bg-tone-danger/[0.1] text-tone-danger',
  'N/A': 'border-foreground/25 bg-muted text-foreground',
};

/** Work order category for an inspection item, from what the item is. */
export function categoryFor(areaName: string, itemName: string) {
  const s = `${itemName} ${areaName}`.toLowerCase();
  if (/smoke|carbon|extinguisher|detector/.test(s)) return 'Safety';
  if (/lock|key/.test(s)) return 'Locks & keys';
  if (/faucet|sink|toilet|tub|shower|water heater|drain/.test(s)) return 'Plumbing';
  if (/heating|air condition|furnace|hvac/.test(s)) return 'HVAC';
  if (/refrigerator|range|oven|dishwasher|washer|dryer|microwave|disposal/.test(s)) return 'Appliance';
  if (/outlet|switch|lighting|light|fan|electrical/.test(s)) return 'Electrical';
  if (/floor|carpet/.test(s)) return 'Flooring';
  if (/wall|ceiling|paint/.test(s)) return 'Painting';
  if (/window|screen|blind|door|closet/.test(s)) return 'Doors & windows';
  return 'General';
}

export const workOrderTitle = (area: string, item: string) => `${item} — ${area}`;

type Baseline = Map<string, string | null>;

/** Move-in conditions by item id, falling back to "area|item" names for checklists built before ids lined up. */
export function baselineIndex(areas: InspectionArea[] | undefined) {
  const byId: Baseline = new Map();
  const byName: Baseline = new Map();
  for (const a of areas ?? []) for (const i of a.items) {
    byId.set(i.id, i.condition);
    byName.set(`${a.name}|${i.name}`.toLowerCase(), i.condition);
  }
  return (area: InspectionArea, item: InspectionItem): string | null | undefined => (byId.has(item.id) ? byId.get(item.id) : byName.get(`${area.name}|${item.name}`.toLowerCase()));
}

export const isWorse = (was: string | null | undefined, now: string | null | undefined) => Boolean(was && now && CONDITION_RANK[was] != null && CONDITION_RANK[now] != null && CONDITION_RANK[now] > CONDITION_RANK[was]);

const ItemCard = memo(function ItemCard({ area, item, locked, state, focused, was, compare, workOrders, actions, change, retry, noteRequest }: {
  area: InspectionArea;
  item: InspectionItem;
  locked: boolean;
  state: SaveState | undefined;
  focused: boolean;
  was: string | null | undefined;
  compare: boolean;
  workOrders: InspectionDetail['workOrders'];
  actions: { current: ItemActions };
  change: Autosave['change'];
  retry: Autosave['retry'];
  noteRequest: number;
}) {
  const [notes, setNotes] = useState(item.notes);
  const [noteOpen, setNoteOpen] = useState(Boolean(item.notes));
  const [uploading, setUploading] = useState(0);
  const typing = useRef(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const photos = useRef(item.photos);
  photos.current = item.photos;
  const flagged = isFlagged(item.condition);
  const worse = compare && isWorse(was, item.condition);

  useEffect(() => {
    if (!typing.current) setNotes(item.notes);
    if (item.notes) setNoteOpen(true);
  }, [item.notes]);

  useEffect(() => {
    if (!noteRequest || locked) return;
    setNoteOpen(true);
    window.setTimeout(() => noteRef.current?.focus(), 0);
  }, [noteRequest]);

  useEffect(() => {
    const el = noteRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.max(44, el.scrollHeight)}px`;
  }, [notes, noteOpen]);

  const addPhotos = async (files: FileList) => {
    const list = [...files].filter(f => {
      if (!f.type.startsWith('image/') && !/\.(heic|heif)$/i.test(f.name)) {
        toast.error(`${f.name} isn’t a photo`);
        return false;
      }
      if (f.size > 20 * 1024 * 1024) {
        toast.error(`${f.name} is larger than 20 MB`);
        return false;
      }
      return true;
    });
    setUploading(n => n + list.length);
    // Uploads run side by side; each finished photo is saved (in order) as soon as it lands.
    await Promise.all(
      list.map(async file => {
        try {
          const { fileUrl } = await uploadFile({ data: file, filename: file.name });
          if (!fileUrl) throw new Error('The upload didn’t finish');
          photos.current = [...photos.current, { url: fileUrl, name: file.name }];
          change(area.id, item.id, { photos: photos.current });
        } catch (e) {
          toast.error(errorMessage(e, `Couldn’t upload ${file.name}`));
        } finally {
          setUploading(n => n - 1);
        }
      }),
    );
  };

  const matching = workOrders.filter(w => w.title === workOrderTitle(area.name, item.name));

  const saveState = (
    <>
      {state === 'saving' && <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> <span className="hidden sm:inline">Saving</span></span>}
      {state === 'saved' && <span className="inline-flex items-center gap-1"><Check className="h-3 w-3 text-tone-success" /> <span className="hidden sm:inline">Saved</span></span>}
      {state === 'error' && (
        <button type="button" onClick={() => retry(area.id, item.id)} className="inline-flex items-center gap-1 rounded px-1 text-tone-danger hover:bg-tone-danger/10">
          <AlertTriangle className="h-3 w-3" /> Didn’t save · Retry
        </button>
      )}
    </>
  );
  const menu = !locked && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="sm" aria-label={`More for ${item.name}`}><MoreHorizontal /></IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {item.condition && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => change(area.id, item.id, { condition: null })}><RotateCcw className="h-3.5 w-3.5" /> Clear rating</DropdownMenuItem>}
        <DropdownMenuItem className="h-9 gap-2 text-[14px] text-tone-danger focus:text-tone-danger" onSelect={() => actions.current.remove(area, item)}><Trash2 className="h-3.5 w-3.5" /> Remove item</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const openNote = () => { setNoteOpen(true); window.setTimeout(() => noteRef.current?.focus(), 0); };

  return (
    <li
      data-item-id={item.id}
      onFocusCapture={() => !focused && actions.current.focus(item.id)}
      onPointerDown={() => !focused && actions.current.focus(item.id)}
      className={cn('relative scroll-mt-32 px-3 py-3 sm:px-4 lg:py-2', focused && 'bg-accent/40', worse && 'bg-tone-danger/[0.035]')}
    >
      {focused && <span className="absolute inset-y-0 left-0 hidden w-[2px] bg-primary/70 sm:block" aria-hidden />}
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { if (e.target.files?.length) void addPhotos(e.target.files); e.target.value = ''; }} />
      <input ref={library} type="file" accept="image/*" multiple className="hidden" onChange={e => { if (e.target.files?.length) void addPhotos(e.target.files); e.target.value = ''; }} />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
        <div className="flex min-w-0 items-start gap-2 lg:w-52 lg:shrink-0">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15px] font-medium sm:text-[14.5px] lg:text-[14px]">{item.name}</span>
            {flagged && <Flag className="h-3.5 w-3.5 text-tone-danger" aria-label="Flagged" />}
            {focused && !locked && <span className="hidden basis-full text-[12px] text-muted-foreground lg:block">1–6 to rate · N for a note</span>}
            {compare && was !== undefined && (
              <Tip label={was ? `Rated ${was} at move-in` : 'Not rated at move-in'}>
                <span className={cn('inline-flex h-5 items-center whitespace-nowrap rounded-[5px] border px-1.5 text-[12px]', worse ? 'border-tone-danger/40 text-tone-danger' : 'text-muted-foreground')}>
                  Move-in: {was ?? '—'}{worse ? ' · worse' : ''}
                </span>
              </Tip>
            )}
          </div>
          <span className="flex h-6 shrink-0 items-center gap-1 text-sm text-muted-foreground lg:hidden">{saveState}{menu}</span>
        </div>

        <div role="radiogroup" aria-label={`Condition of ${item.name}`} className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 lg:min-w-0 lg:flex-1 lg:gap-1">
          {ITEM_CONDITIONS.map((c, i) => {
            const on = item.condition === c;
            return (
              <button
                key={c}
                title={focused && !locked ? `${c} (${i + 1})` : undefined}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={locked}
                onClick={() => !on && change(area.id, item.id, { condition: c })}
                className={cn(
                  'relative h-11 rounded-md border text-[15px] font-medium transition-colors sm:h-9 sm:text-[13.5px] lg:h-8 lg:text-[13px]',
                  on ? CONDITION_STYLE[c] : 'border-input/70 bg-background text-foreground/80 hover:border-input hover:bg-accent/60',
                  locked && !on && 'opacity-45',
                  locked && 'cursor-default',
                )}
              >
                {c}
              </button>
            );
          })}
        </div>

        <span className="hidden h-8 shrink-0 items-center gap-0.5 text-sm text-muted-foreground lg:flex">
          {saveState}
          {!locked && (
            <>
              <Tip label="Take a photo"><IconButton aria-label="Take a photo" onClick={() => camera.current?.click()}><Camera /></IconButton></Tip>
              <Tip label="Add photos"><IconButton aria-label="Add photos" onClick={() => library.current?.click()}><ImagePlus /></IconButton></Tip>
              <Tip label="Note" keys={['N']}><IconButton aria-label="Add a note" active={noteOpen || flagged} onClick={openNote}><NotebookPen /></IconButton></Tip>
            </>
          )}
          {menu}
        </span>
      </div>

      {(noteOpen || flagged) && (!locked || notes) && (
        <textarea
          ref={noteRef}
          value={notes}
          readOnly={locked}
          rows={1}
          onFocus={() => (typing.current = true)}
          onBlur={() => {
            typing.current = false;
            if (notes !== item.notes) change(area.id, item.id, { notes }, 0);
          }}
          onChange={e => {
            setNotes(e.target.value);
            change(area.id, item.id, { notes: e.target.value }, 900);
          }}
          onKeyDown={e => e.key === 'Escape' && (e.target as HTMLTextAreaElement).blur()}
          placeholder={flagged ? 'What’s wrong, where, how big? This goes on the report and any work order.' : 'Add a note…'}
          maxLength={4000}
          className="field mt-2 min-h-[44px] resize-none py-2 text-[15px] leading-relaxed sm:text-[14px] lg:min-h-[36px] lg:py-1.5"
        />
      )}

      {(item.photos.length > 0 || uploading > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.photos.map(p => (
            <div key={p.url} className="group/photo relative h-16 w-16 overflow-hidden rounded-md border bg-muted sm:h-14 sm:w-14">
              <a href={p.url} target="_blank" rel="noreferrer" title={p.name}><img src={p.url} alt={p.name} loading="lazy" className="h-full w-full object-cover" /></a>
              {!locked && (
                <button type="button" aria-label={`Remove ${p.name}`} onClick={() => change(area.id, item.id, { photos: item.photos.filter(x => x.url !== p.url) })} className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white sm:opacity-0 sm:group-hover/photo:opacity-100 sm:focus-visible:opacity-100">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {Array.from({ length: uploading }, (_, i) => (
            <div key={`u${i}`} className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed sm:h-14 sm:w-14"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ))}
        </div>
      )}

      {(!locked || flagged) && (
        <div className={cn('mt-2 flex flex-wrap items-center gap-1', !flagged && 'lg:hidden')}>
          {!locked && (
            <span className="flex items-center gap-1 lg:hidden">
              <button type="button" onClick={() => camera.current?.click()} className="ghost-chip h-9 gap-1.5 px-2 text-[14px] text-muted-foreground hover:text-foreground sm:h-8"><Camera className="h-4 w-4 sm:h-3.5 sm:w-3.5" /> Photo</button>
              <button type="button" onClick={() => library.current?.click()} aria-label="Choose photos" className="ghost-chip h-9 px-2 text-muted-foreground hover:text-foreground sm:h-8"><ImagePlus className="h-4 w-4 sm:h-3.5 sm:w-3.5" /></button>
              {!noteOpen && !flagged && <button type="button" onClick={openNote} className="ghost-chip h-9 gap-1.5 px-2 text-[14px] text-muted-foreground hover:text-foreground sm:h-8"><NotebookPen className="h-4 w-4 sm:h-3.5 sm:w-3.5" /> Note</button>}
            </span>
          )}
          {flagged && (
            <span className="ml-auto flex flex-wrap items-center justify-end gap-1">
              {matching.map(w => (
                <Link key={w.number} to={`/work-orders/${w.number}`} className="chip h-8 gap-1.5 bg-background hover:bg-accent"><WorkOrderStatusGlyph status={w.status} size={12} /> {workOrderRef(w.number)}</Link>
              ))}
              {/* Work orders are raised after completion too — it doesn't change the report. */}
              <button type="button" onClick={() => actions.current.createWorkOrder(area, item)} className="ghost-chip h-9 gap-1.5 border-border bg-background px-2.5 text-[14px] sm:h-8">
                <Wrench className="h-3.5 w-3.5" /> {matching.length ? 'Another work order' : 'Create work order'}
              </button>
            </span>
          )}
        </div>
      )}
    </li>
  );
});

/**
 * The walkthrough: a sticky progress bar with jump-to-room chips, then each
 * room with its items. Built for a phone in one hand — big condition targets,
 * the camera one tap away, notes that open when something's wrong — and for a
 * keyboard at a desk: J/K between items, 1–6 to rate, N for a note.
 */
export function InspectionWalkthrough({ detail, autosave, locked, keyboard }: { detail: InspectionDetail; autosave: Autosave; locked: boolean; keyboard: boolean }) {
  const app = useAppActions();
  const qc = useQueryClient();
  const i = detail.inspection;
  const areas = detail.areas;
  const stats = i.stats;
  const hasBaseline = Boolean(detail.baseline);
  const [compare, setCompare] = useState(hasBaseline);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [noteRequest, setNoteRequest] = useState<{ id: string; n: number } | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newItem, setNewItem] = useState('');
  const [newArea, setNewArea] = useState<string | null>(null);
  const [activeArea, setActiveArea] = useState<string | null>(areas[0]?.id ?? null);
  const baseline = useMemo(() => baselineIndex(detail.baseline?.areas), [detail.baseline]);
  const flat = useMemo(() => areas.flatMap(a => a.items.map(item => ({ area: a, item }))), [areas]);

  useEffect(() => setCompare(hasBaseline), [hasBaseline]);

  // Track which room is on screen so its jump chip lights up.
  useEffect(() => {
    const els = areas.map(a => document.getElementById(`area-${a.id}`)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const io = new IntersectionObserver(entries => {
      const top = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setActiveArea(top.target.id.replace(/^area-/, ''));
    }, { rootMargin: '-120px 0px -60% 0px' });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [areas.map(a => a.id).join(',')]);

  const focusAt = (n: number) => {
    const next = flat[Math.max(0, Math.min(flat.length - 1, n))];
    if (!next) return;
    setFocusedId(next.item.id);
    window.setTimeout(() => document.querySelector(`[data-item-id="${CSS.escape(next.item.id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0);
  };
  const focusIndex = focusedId ? flat.findIndex(f => f.item.id === focusedId) : -1;
  const focused = focusIndex >= 0 ? flat[focusIndex] : null;
  const rate = (c: Condition) => focused && !locked && focused.item.condition !== c && autosave.change(focused.area.id, focused.item.id, { condition: c });

  useHotkeys(
    {
      j: () => focusAt(focusIndex + 1),
      down: () => focusAt(focusIndex + 1),
      k: () => focusAt(focusIndex < 0 ? 0 : focusIndex - 1),
      up: () => focusAt(focusIndex < 0 ? 0 : focusIndex - 1),
      ...Object.fromEntries(ITEM_CONDITIONS.map((c, n) => [String(n + 1), () => rate(c)])),
      n: () => focused && !locked && setNoteRequest(r => ({ id: focused.item.id, n: (r?.n ?? 0) + 1 })),
    },
    { enabled: keyboard },
  );

  const mergeAreas = (server: InspectionArea[]) =>
    qc.setQueryData<InspectionDetail>(mk.inspection(i.id), old => {
      if (!old) return old;
      // The server's structure, with this device's (possibly newer) item values kept.
      const local = new Map(old.areas.flatMap(a => a.items.map(it => [`${a.id}/${it.id}`, it] as const)));
      const next = server.map(a => ({ ...a, items: a.items.map(it => local.get(`${a.id}/${it.id}`) ?? it) }));
      return { ...old, areas: next, inspection: { ...old.inspection, stats: areaStats(next) } };
    });

  const structural = async (label: string, fn: () => Promise<{ areas?: InspectionArea[] }>) => {
    try {
      const res = await autosave.enqueue(fn);
      if (res.areas) mergeAreas(res.areas);
    } catch (e) {
      toast.error(errorMessage(e, label));
    }
  };

  const addItem = async (area: InspectionArea) => {
    const name = newItem.trim();
    if (!name) return setAddingTo(null);
    setNewItem('');
    await structural('Couldn’t add the item', () => saveInspection({ action: 'addItem', id: i.id, areaId: area.id, name }) as Promise<{ areas?: InspectionArea[] }>);
  };

  const removeItem = async (area: InspectionArea, item: InspectionItem) => {
    if ((item.condition || item.notes || item.photos.length) && !(await app.confirm({ title: `Remove ${item.name}?`, description: 'Its rating, notes and photos are removed from this inspection.', confirmLabel: 'Remove item', destructive: true }))) return;
    await structural('Couldn’t remove the item', () => saveInspection({ action: 'removeItem', id: i.id, areaId: area.id, itemId: item.id }) as Promise<{ areas?: InspectionArea[] }>);
  };

  const removeArea = async (area: InspectionArea) => {
    const s = areaStats([area]);
    if (!(await app.confirm({ title: `Remove ${area.name}?`, description: s.rated ? `${s.rated} rated ${s.rated === 1 ? 'item' : 'items'} and their notes and photos are removed from this inspection.` : 'The room and its items are removed from this inspection’s checklist.', confirmLabel: 'Remove room', destructive: true }))) return;
    await structural('Couldn’t remove the room', () => saveInspection({ action: 'removeArea', id: i.id, areaId: area.id }) as Promise<{ areas?: InspectionArea[] }>);
  };

  const addArea = async () => {
    const name = (newArea ?? '').trim();
    setNewArea(null);
    if (!name) return;
    await structural('Couldn’t add the room', () => saveInspection({ action: 'addArea', id: i.id, name }) as Promise<{ areas?: InspectionArea[] }>);
    window.setTimeout(() => document.getElementById(`area-${areas[areas.length - 1]?.id}`)?.nextElementSibling?.scrollIntoView({ behavior: 'smooth' }), 150);
  };

  const fillArea = async (area: InspectionArea, condition: Condition) => {
    const unrated = area.items.filter(it => !it.condition);
    if (!unrated.length) return;
    qc.setQueryData<InspectionDetail>(mk.inspection(i.id), old => {
      if (!old) return old;
      const next = old.areas.map(a => (a.id !== area.id ? a : { ...a, items: a.items.map(it => (it.condition ? it : { ...it, condition })) }));
      return { ...old, areas: next, inspection: { ...old.inspection, status: old.inspection.status === 'Scheduled' ? 'In progress' : old.inspection.status, stats: areaStats(next) } };
    });
    try {
      await autosave.enqueue(() => saveInspection({ action: 'fillArea', id: i.id, areaId: area.id, condition }));
      toast.success(`${unrated.length} ${unrated.length === 1 ? 'item' : 'items'} in ${area.name} marked ${condition}`);
    } catch (e) {
      toast.error(errorMessage(e, `Couldn’t update ${area.name}`));
      void qc.invalidateQueries({ queryKey: mk.inspection(i.id) });
    }
  };

  const createWorkOrder = (area: InspectionArea, item: InspectionItem) => {
    const when = i.completedAt ?? i.scheduledFor;
    app.openCreate('workOrder', {
      propertyId: i.propertyId,
      unitId: i.unitId,
      title: workOrderTitle(area.name, item.name),
      description: [`Rated ${item.condition} during the ${i.type.toLowerCase()} inspection${when ? ` on ${longDate(when.slice(0, 10))}` : ''}.`, item.notes.trim(), item.photos.length ? `${item.photos.length} ${item.photos.length === 1 ? 'photo is' : 'photos are'} on the inspection.` : ''].filter(Boolean).join('\n\n'),
      category: categoryFor(area.name, item.name),
      priority: item.condition === 'Damaged' ? 'High' : 'Normal',
      source: 'Inspection',
      inspectionId: i.id,
    });
  };

  const actions = useRef<ItemActions>({ focus: setFocusedId, createWorkOrder, remove: (a, it) => void removeItem(a, it) });
  actions.current = { focus: setFocusedId, createWorkOrder, remove: (a, it) => void removeItem(a, it) };

  const worse = hasBaseline ? flat.filter(f => isWorse(baseline(f.area, f.item), f.item.condition)) : [];
  const done = stats.total > 0 && stats.rated === stats.total;

  return (
    <div>
      <div className="sticky top-0 z-20 -mx-5 border-b bg-background/95 px-5 pb-2 pt-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:-mx-8 sm:px-8">
        <div className="flex items-center gap-3">
          <ProgressBar value={stats.total ? stats.rated / stats.total : 0} tone={done ? 'success' : 'primary'} className="h-2 flex-1" />
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            <span className="font-medium text-foreground">{stats.rated}</span>/{stats.total}
            {stats.issues > 0 && <span className="ml-2 text-tone-danger">{stats.issues} flagged</span>}
          </span>
        </div>
        <nav aria-label="Jump to room" className="-mx-1 mt-2 flex gap-1 overflow-x-auto px-1 pb-0.5 scrollbar-none">
          {areas.map(a => {
            const s = areaStats([a]);
            const complete = s.total > 0 && s.rated === s.total;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => document.getElementById(`area-${a.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className={cn('flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[13.5px] transition-colors sm:h-8', activeArea === a.id ? 'border-foreground/20 bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')}
              >
                {complete ? <Check className="h-3 w-3 text-tone-success" /> : s.issues ? <Flag className="h-3 w-3 text-tone-danger" /> : null}
                {a.name}
                <span className="tabular-nums text-muted-foreground">{s.rated}/{s.total}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {hasBaseline && detail.baseline && (
        <section className="mt-5 rounded-lg border bg-card">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-[14px] font-medium">Compared with move-in</h2>
              <p className="text-sm text-muted-foreground">
                <Link to={`/inspections/${detail.baseline.id}`} className="hover:underline">{detail.baseline.title}</Link>
                {detail.baseline.completedAt && ` · ${longDate(detail.baseline.completedAt.slice(0, 10))}`}
                {!detail.baseline.sameLease && ' · a previous lease on this unit'}
              </p>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" /> Show on each item
            </label>
          </div>
          <div className="border-t px-4 py-3">
            {worse.length === 0 ? (
              <p className="text-[14px] text-muted-foreground">{stats.rated ? 'Nothing is worse than at move-in so far.' : 'Rate items to see what changed since move-in.'}</p>
            ) : (
              <>
                <p className="mb-2 text-[14px]"><span className="font-medium text-tone-danger">{worse.length} {worse.length === 1 ? 'item is' : 'items are'} worse</span> than at move-in — the basis for any deposit deductions.</p>
                <div className="-mx-4 overflow-x-auto">
                  <table className="w-full min-w-[460px] text-[14px]">
                    <thead>
                      <tr className="whitespace-nowrap text-left text-sm text-muted-foreground">
                        <th className="px-4 pb-1.5 font-medium">Item</th>
                        <th className="pb-1.5 font-medium">Move-in</th>
                        <th className="pb-1.5 font-medium">Now</th>
                        <th className="px-4 pb-1.5 font-medium">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {worse.map(({ area, item }) => (
                        <tr key={`${area.id}/${item.id}`} className="border-t align-top">
                          <td className="px-4 py-2"><button type="button" className="text-left hover:underline" onClick={() => { setFocusedId(item.id); document.querySelector(`[data-item-id="${CSS.escape(item.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}><span className="text-muted-foreground">{area.name} ·</span> {item.name}</button></td>
                          <td className="py-2"><ConditionPill condition={baseline(area, item)} /></td>
                          <td className="py-2"><ConditionPill condition={item.condition} /></td>
                          <td className="px-4 py-2 text-muted-foreground">{item.notes || '—'}{item.photos.length ? ` · ${item.photos.length} photo${item.photos.length === 1 ? '' : 's'}` : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {detail.lease && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Settle the deposit from the <Link to={`/leases/${detail.lease.id}/ledger`} className="text-primary hover:underline">lease ledger</Link>.
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {areas.map(area => {
        const s = areaStats([area]);
        return (
          <section key={area.id} id={`area-${area.id}`} className="mt-6 scroll-mt-28">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-[16px] font-semibold tracking-tight sm:text-[15px]">{area.name}</h2>
              <span className="text-sm tabular-nums text-muted-foreground">{s.rated}/{s.total}</span>
              {s.issues > 0 && <Pill tone="danger"><Flag className="h-3 w-3" /> {s.issues}</Pill>}
              {!locked && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton size="sm" className="ml-auto" aria-label={`More for ${area.name}`}><ChevronDown /></IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="h-9 gap-2 text-[14px]" disabled={s.rated === s.total}><Check className="h-3.5 w-3.5" /> Rate the rest…</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-40">
                        {ITEM_CONDITIONS.filter(c => c === 'Good' || c === 'Fair' || c === 'N/A').map(c => (
                          <DropdownMenuItem key={c} className="h-9 text-[14px]" onSelect={() => void fillArea(area, c)}>{c}</DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => { setAddingTo(area.id); setNewItem(''); }}><Plus className="h-3.5 w-3.5" /> Add item</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="h-9 gap-2 text-[14px] text-tone-danger focus:text-tone-danger" onSelect={() => void removeArea(area)}><Trash2 className="h-3.5 w-3.5" /> Remove room</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <ul className="divide-y overflow-hidden rounded-lg border bg-card shadow-2xs">
              {area.items.map(item => (
                <ItemCard
                  key={item.id}
                  area={area}
                  item={item}
                  locked={locked}
                  state={autosave.states[`${area.id}/${item.id}`]}
                  focused={keyboard && focusedId === item.id}
                  was={hasBaseline ? baseline(area, item) : undefined}
                  compare={compare}
                  workOrders={detail.workOrders}
                  actions={actions}
                  change={autosave.change}
                  retry={autosave.retry}
                  noteRequest={noteRequest?.id === item.id ? noteRequest.n : 0}
                />
              ))}
              {area.items.length === 0 && <li className="px-4 py-4 text-[14px] text-muted-foreground">No items in this room{locked ? '.' : ' yet.'}</li>}
              {!locked && (
                <li className="px-3 py-1.5 sm:px-4">
                  {addingTo === area.id ? (
                    <input
                      autoFocus
                      value={newItem}
                      onChange={e => setNewItem(e.target.value)}
                      onBlur={() => void addItem(area)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); void addItem(area).then(() => setAddingTo(area.id)); }
                        if (e.key === 'Escape') { setNewItem(''); setAddingTo(null); }
                      }}
                      placeholder="Item name, e.g. Ceiling fan — Enter to add"
                      maxLength={80}
                      className="field my-1 h-9"
                    />
                  ) : (
                    <button type="button" onClick={() => { setAddingTo(area.id); setNewItem(''); }} className="flex h-9 w-full items-center gap-1.5 text-[14px] text-muted-foreground hover:text-foreground sm:h-9">
                      <Plus className="h-3.5 w-3.5" /> Add item
                    </button>
                  )}
                </li>
              )}
            </ul>
          </section>
        );
      })}

      {!locked && (
        <div className="mt-6">
          {newArea !== null ? (
            <input
              autoFocus
              value={newArea}
              onChange={e => setNewArea(e.target.value)}
              onBlur={() => void addArea()}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); void addArea(); }
                if (e.key === 'Escape') setNewArea(null);
              }}
              placeholder="Room name, e.g. Garage — Enter to add"
              maxLength={80}
              className="field h-10"
            />
          ) : (
            <button type="button" onClick={() => setNewArea('')} className="flex h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed text-[14px] text-muted-foreground hover:bg-accent/40 hover:text-foreground">
              <Plus className="h-3.5 w-3.5" /> Add a room
            </button>
          )}
        </div>
      )}
    </div>
  );
}
