import { differenceInCalendarDays, format, formatDistanceToNowStrict, isThisYear, parseISO } from 'date-fns';
import { formatMoney } from '@project/shared/money';

export { formatMoney };

/** Date-only strings are LOCAL days; `new Date('2026-09-12')` is UTC and shifts a day west of Greenwich. */
export function parseDay(day: string) {
  return parseISO(day.length === 10 ? `${day}T00:00:00` : day);
}

export function toDayString(date: Date) {
  return format(date, 'yyyy-MM-dd');
}

export function todayString() {
  return toDayString(new Date());
}

export function addDays(days: number, from?: string) {
  const base = from ? parseDay(from) : new Date();
  return toDayString(new Date(base.getTime() + days * 86_400_000));
}

/** "3m ago", "2h ago", "5d ago", then "Sep 4". */
export function timeAgo(iso: string | null | undefined) {
  if (!iso) return '';
  const d = parseISO(iso);
  const days = Math.abs(differenceInCalendarDays(new Date(), d));
  if (days > 30) return shortDate(iso);
  const s = formatDistanceToNowStrict(d, { roundingMethod: 'floor' });
  const short = s.replace(/ minutes?/, 'm').replace(/ hours?/, 'h').replace(/ days?/, 'd').replace(/ months?/, 'mo').replace(/ seconds?/, 's');
  if (d.getTime() > Date.now() + 60_000) return `in ${short}`;
  if (s.startsWith('0 ') || s.includes('second')) return 'just now';
  return `${short} ago`;
}

export function shortDate(value: string | null | undefined) {
  if (!value) return '';
  const d = parseDay(value);
  return isThisYear(d) ? format(d, 'MMM d') : format(d, 'MMM d, yyyy');
}

/** Always with the year — for ledgers, documents and anything legal. */
export function fullDate(value: string | null | undefined) {
  if (!value) return '';
  return format(parseDay(value), 'MMM d, yyyy');
}

export function longDate(value: string | null | undefined) {
  if (!value) return '';
  return format(parseDay(value), 'MMMM d, yyyy');
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return '';
  return format(parseISO(iso), "MMM d, yyyy 'at' h:mm a");
}

export function shortDateTime(iso: string | null | undefined) {
  if (!iso) return '';
  const d = parseISO(iso);
  return format(d, isThisYear(d) ? 'EEE, MMM d · h:mm a' : 'MMM d, yyyy · h:mm a');
}

export function timeOnly(iso: string | null | undefined) {
  if (!iso) return '';
  return format(parseISO(iso), 'h:mm a');
}

export type DueTone = 'overdue' | 'soon' | 'normal';

/** A due date the way people say it: "Today", "Tomorrow", "Fri", "Sep 30". */
export function dueLabel(day: string | null | undefined): { label: string; tone: DueTone; days: number } | null {
  if (!day) return null;
  const days = differenceInCalendarDays(parseDay(day), new Date());
  if (days < 0) return { label: days === -1 ? 'Yesterday' : shortDate(day), tone: 'overdue', days };
  if (days === 0) return { label: 'Today', tone: 'soon', days };
  if (days === 1) return { label: 'Tomorrow', tone: 'soon', days };
  if (days < 7) return { label: format(parseDay(day), 'EEEE'), tone: days <= 2 ? 'soon' : 'normal', days };
  return { label: shortDate(day), tone: 'normal', days };
}

/** "in 12 days", "3 days ago", "today". */
export function relativeDays(day: string | null | undefined) {
  if (!day) return '';
  const days = differenceInCalendarDays(parseDay(day), new Date());
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export const daysFromToday = (day: string | null | undefined) => (day ? differenceInCalendarDays(parseDay(day), new Date()) : null);

export function initials(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function percent(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** "2 bd · 1 ba · 880 sq ft", "Studio · 1 ba". */
export function bedsBaths(beds: number, baths: number, sqft?: number | null) {
  const parts = [beds === 0 ? 'Studio' : `${beds} bd`, `${Number.isInteger(baths) ? baths : baths.toFixed(1)} ba`];
  if (sqft) parts.push(`${sqft.toLocaleString()} sq ft`);
  return parts.join(' · ');
}

/** A link to this app's own route, for copying. */
export function appUrl(hashPath: string) {
  return `${window.location.origin}${window.location.pathname}#${hashPath.startsWith('/') ? hashPath : `/${hashPath}`}`;
}

export function slugify(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

export const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';

/** Phone numbers as typed, but tel: links need digits. */
export const telHref = (phone: string | null | undefined) => (phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : undefined);
