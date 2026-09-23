import { useEffect, useMemo, useState } from 'react';
import { CONDITIONS } from '@project/shared/constants';
import { areaStats, type InspectionArea, type InspectionItem } from '@project/shared/inspections';
import { Field, Segmented, SwitchRow, TextArea } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { FLAGGED } from './data';
import { baselineIndex, isWorse } from './InspectionWalkthrough';

type Condition = (typeof CONDITIONS)[number];

/** A starting point for the overall condition, from how the items were rated. */
function suggestCondition(areas: InspectionArea[]): Condition {
  const items = areas.flatMap(a => a.items).filter(i => i.condition && i.condition !== 'N/A');
  if (!items.length) return 'Good';
  const bad = items.filter(i => FLAGGED.includes(i.condition!)).length / items.length;
  const fair = items.filter(i => i.condition === 'Fair').length / items.length;
  if (bad >= 0.15) return 'Poor';
  if (bad > 0 || fair >= 0.2) return 'Fair';
  return fair > 0 ? 'Good' : 'Excellent';
}

const line = (area: string, item: InspectionItem, extra = '') => `• ${area} — ${item.name}: ${item.condition!.toLowerCase()}${extra}${item.notes ? ` (${item.notes.trim().replace(/\s+/g, ' ')})` : ''}`;

/** A draft summary listing what was flagged — and, for a move-out, what's worse than at move-in — so the inspector edits rather than retypes. */
function draftSummary(areas: InspectionArea[], baseline?: InspectionArea[] | null) {
  const was = baselineIndex(baseline ?? undefined);
  const worse = baseline ? areas.flatMap(a => a.items.filter(i => isWorse(was(a, i), i.condition)).map(i => line(a.name, i, `, was ${String(was(a, i)).toLowerCase()} at move-in`))) : [];
  const flagged = areas.flatMap(a => a.items.filter(i => i.condition && FLAGGED.includes(i.condition) && !(baseline && isWorse(was(a, i), i.condition))).map(i => line(a.name, i)));
  const parts = [worse.length ? `Worse than at move-in:\n${worse.join('\n')}` : '', flagged.length ? `Needs attention:\n${flagged.join('\n')}` : ''].filter(Boolean);
  return parts.length ? parts.join('\n\n') : baseline ? 'No change from move-in beyond normal wear.' : 'No issues found.';
}

export function CompleteInspectionDialog({ open, onOpenChange, areas, baseline, existingSummary, canShare, type, residentNames, onComplete }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  areas: InspectionArea[];
  baseline?: InspectionArea[] | null;
  existingSummary: string;
  canShare: boolean;
  type: string;
  residentNames: string;
  onComplete: (input: { summary: string; overallCondition: Condition; share: boolean }) => Promise<void>;
}) {
  const stats = useMemo(() => areaStats(areas), [areas]);
  const [summary, setSummary] = useState('');
  const [condition, setCondition] = useState<Condition>('Good');
  const [share, setShare] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSummary(existingSummary || draftSummary(areas, baseline));
    setCondition(suggestCondition(areas));
    setShare(canShare && (type === 'Move-in' || type === 'Move-out'));
  }, [open]);

  const unrated = stats.total - stats.rated;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Complete inspection"
      description={`${stats.rated} of ${stats.total} items checked${stats.issues ? ` · ${stats.issues} flagged` : ''}${stats.photos ? ` · ${stats.photos} photos` : ''}`}
      pending={pending}
      disabled={stats.rated === 0}
      submitLabel="Complete inspection"
      onSubmit={async () => {
        setPending(true);
        try {
          await onComplete({ summary: summary.trim(), overallCondition: condition, share: canShare && share });
          onOpenChange(false);
        } catch {
          /* the caller toasts */
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="space-y-4">
        {stats.rated === 0 ? (
          <p className="rounded-md bg-tone-warning/[0.08] px-3 py-2 text-[14px] text-tone-warning">Rate at least one item before completing the inspection.</p>
        ) : unrated > 0 ? (
          <p className="rounded-md bg-tone-warning/[0.08] px-3 py-2 text-[14px] text-tone-warning">{unrated} {unrated === 1 ? 'item isn’t' : 'items aren’t'} checked. {unrated === 1 ? 'It shows' : 'They show'} as “Not checked” on the report.</p>
        ) : null}
        <Field label="Overall condition">
          <Segmented value={condition} onChange={v => setCondition(v as Condition)} options={CONDITIONS.map(c => ({ value: c, label: c }))} className="w-full [&>button]:flex-1 [&>button]:justify-center" />
        </Field>
        <Field label="Summary" hint="Shown at the top of the report and to residents if you share it.">
          <TextArea data-autofocus rows={6} value={summary} onChange={e => setSummary(e.target.value)} maxLength={10000} />
        </Field>
        {canShare ? (
          <div className="rounded-lg border px-3 py-2">
            <SwitchRow label="Share with residents" description={`${residentNames || 'The residents'} can review the report in their portal and confirm they’ve seen it. They’re emailed when you complete it.`} checked={share} onChange={setShare} />
          </div>
        ) : (
          (type === 'Move-in' || type === 'Move-out') && <p className="text-sm text-muted-foreground">Link a lease to share this report with residents.</p>
        )}
      </div>
    </FormDialog>
  );
}
