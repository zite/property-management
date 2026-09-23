/**
 * Calendar-day arithmetic on `YYYY-MM-DD` strings.
 *
 * Rent is due on a calendar day, not an instant, so everything that decides
 * "is this late" or "which month is this charge for" works on day strings and
 * does its math in UTC, where there is no daylight-saving hour to lose.
 * `todayIn()` is the one place a timezone matters: the organization's own.
 */

export const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, '0');

export const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Any date-ish value (ISO timestamp, Date, day string) to its calendar day. */
export function toDay(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parts(day: string) {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

const utc = (day: string) => {
  const { y, m, d } = parts(day);
  return Date.UTC(y, m - 1, d);
};

const fromUtc = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** Today in an IANA timezone (defaults to UTC), as a day string. */
export function todayIn(timezone?: string | null, now: Date = new Date()): string {
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
    return f.format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export const addDays = (day: string, n: number) => fromUtc(utc(day) + n * DAY_MS);

export const daysInMonth = (year: number, month1: number) => new Date(Date.UTC(year, month1, 0)).getUTCDate();

/** Add calendar months, clamping the day (Jan 31 + 1 month = Feb 28). */
export function addMonths(day: string, n: number) {
  const { y, m, d } = parts(day);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}

/** Whole days from a to b (b later → positive). */
export const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / DAY_MS);

export const compareDay = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const minDay = (a: string, b: string) => (a <= b ? a : b);
export const maxDay = (a: string, b: string) => (a >= b ? a : b);

/** "2026-09" for any day in September 2026. */
export const periodOf = (day: string) => day.slice(0, 7);

export const periodStart = (period: string) => `${period}-01`;

export function periodEnd(period: string) {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${pad(daysInMonth(y, m))}`;
}

export const addPeriods = (period: string, n: number) => periodOf(addMonths(periodStart(period), n));

/** The due date for a period and a due day, clamped to the month's length (due on the 31st → Feb 28). */
export function dueDateIn(period: string, dueDay: number) {
  const [y, m] = period.split('-').map(Number);
  const day = Math.max(1, Math.min(Math.round(dueDay) || 1, daysInMonth(y, m)));
  return `${period}-${pad(day)}`;
}

/** Periods from a to b inclusive ("2026-01".."2026-03" → 3 periods). */
export function periodsBetween(a: string, b: string): string[] {
  const out: string[] = [];
  let p = a;
  for (let i = 0; i < 600 && p <= b; i++) {
    out.push(p);
    p = addPeriods(p, 1);
  }
  return out;
}

/** Whole months between two days, rounding down ("2026-01-15" → "2026-03-14" is 1). */
export function monthsBetween(a: string, b: string) {
  const pa = parts(a);
  const pb = parts(b);
  let months = (pb.y - pa.y) * 12 + (pb.m - pa.m);
  if (pb.d < pa.d) months -= 1;
  return months;
}

/**
 * The share of a monthly amount owed for the days from `from` to the end of its month,
 * inclusive — the prorated first month when someone moves in mid-month.
 */
export function prorateToMonthEnd(monthly: number, from: string) {
  const { y, m, d } = parts(from);
  const days = daysInMonth(y, m);
  const occupied = days - d + 1;
  return Math.round((monthly * occupied * 100) / days) / 100;
}

/** The share of a monthly amount for the days from the start of the month through `to`, inclusive. */
export function prorateFromMonthStart(monthly: number, to: string) {
  const { y, m, d } = parts(to);
  const days = daysInMonth(y, m);
  return Math.round((monthly * d * 100) / days) / 100;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map(m => m.slice(0, 3));

/** "September 2026". */
export function periodLabel(period: string, short = false) {
  const [y, m] = period.split('-').map(Number);
  return `${(short ? SHORT : MONTHS)[m - 1] ?? ''} ${y}`;
}

/** "Sep 14, 2026" — for emails and PDFs, where the browser's locale helpers aren't available. */
export function formatDay(day: string | null | undefined, style: 'short' | 'long' = 'short') {
  if (!day || !isDay(day.slice(0, 10))) return '';
  const { y, m, d } = parts(day);
  return style === 'long' ? `${MONTHS[m - 1]} ${d}, ${y}` : `${SHORT[m - 1]} ${d}, ${y}`;
}

/** Lease term length in whole months, for "12-month lease". */
export function termMonths(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return null;
  return Math.max(0, monthsBetween(start, addDays(end, 1)));
}
