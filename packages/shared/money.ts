/**
 * Money is stored as decimal currency in the database but every sum, split and
 * comparison here goes through integer cents. Floating point addition of
 * dollars drifts (0.1 + 0.2), and a ledger that is off by a cent never balances.
 */

export const toCents = (n: number | string | null | undefined): number => {
  const v = typeof n === 'string' ? Number(n) : n;
  return Number.isFinite(v) ? Math.round((v as number) * 100) : 0;
};

export const fromCents = (cents: number): number => Math.round(cents) / 100;

/** Round a currency amount to whole cents. */
export const round2 = (n: number | null | undefined): number => fromCents(toCents(n ?? 0));

export const sumMoney = (values: Array<number | string | null | undefined>): number => fromCents(values.reduce<number>((a, v) => a + toCents(v), 0));

/** a − b, in cents. */
export const subMoney = (a: number | null | undefined, b: number | null | undefined): number => fromCents(toCents(a) - toCents(b));

export const isZero = (n: number | null | undefined) => toCents(n) === 0;

/** Percent of an amount, rounded to cents (percent given as 8 for 8%). */
export const percentOf = (amount: number, percent: number) => fromCents(Math.round((toCents(amount) * percent) / 100));

export type MoneyFormat = { compact?: boolean; cents?: boolean; sign?: boolean };

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, opts: MoneyFormat, showCents: boolean) {
  const key = `${currency}|${opts.compact ? 1 : 0}|${showCents ? 1 : 0}|${opts.sign ? 1 : 0}`;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        notation: opts.compact ? 'compact' : 'standard',
        minimumFractionDigits: opts.compact ? 0 : showCents ? 2 : 0,
        maximumFractionDigits: opts.compact ? 1 : showCents ? 2 : 0,
        signDisplay: opts.sign ? 'exceptZero' : 'auto',
      });
    } catch {
      f = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    formatters.set(key, f);
  }
  return f;
}

/**
 * "$1,250.00". Compact ("$12.4K") only for summaries; ledgers always show cents.
 * `cents: false` drops them for round figures like market rent.
 */
export function formatMoney(n: number | string | null | undefined, currency = 'USD', opts: MoneyFormat = {}) {
  const value = typeof n === 'string' ? Number(n) : n ?? 0;
  const safe = Number.isFinite(value) ? (value as number) : 0;
  const showCents = opts.cents ?? true;
  if (opts.compact && Math.abs(safe) < 1000) return formatter(currency, { ...opts, compact: false }, Math.abs(safe % 1) > 0.001 && showCents).format(safe);
  return formatter(currency, opts, showCents).format(safe);
}

/** Split an amount into n parts that add back up exactly (remainder cents go to the first parts). */
export function splitEvenly(amount: number, parts: number): number[] {
  if (parts <= 0) return [];
  const cents = toCents(amount);
  const base = Math.trunc(cents / parts);
  let rest = cents - base * parts;
  return Array.from({ length: parts }, () => {
    const extra = rest > 0 ? 1 : rest < 0 ? -1 : 0;
    rest -= extra;
    return fromCents(base + extra);
  });
}
