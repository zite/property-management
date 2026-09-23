import { timeOfDay } from '../../lib/format';

/** "Today at 9:00 AM MDT", "Tomorrow at…", "Thu, Sep 17 at…" — in the viewer's own time zone. */
export function visitLabel(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const day = same(d, new Date()) ? 'Today' : same(d, new Date(Date.now() + 86400_000)) ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  return `${day} at ${timeOfDay(iso)}`;
}
