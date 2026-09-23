/**
 * The organization's policy rules, shared by the Settings forms (inline
 * errors as you type) and `updateOrgSettings` (which re-checks everything the
 * form sent). Pure functions only — this file is imported on both sides.
 */

export { lateFeeFor, type LateFeePolicy } from '@project/shared/settings';

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export type SettingsDraft = Partial<{
  organizationName: string;
  legalName: string;
  logoUrl: string | null;
  address: string;
  phone: string;
  supportEmail: string | null;
  websiteUrl: string | null;
  emergencyPhone: string;
  officeHours: string;
  currency: string;
  timezone: string;
  brandColor: string;
  rentDueDay: number | null;
  gracePeriodDays: number | null;
  lateFeeType: 'None' | 'Flat' | 'Percent';
  lateFeeAmount: number | null;
  lateFeePercent: number | null;
  lateFeeMax: number | null;
  chargeDaysAhead: number | null;
  rentReminderDays: number | null;
  renewalNoticeDays: number | null;
  managementFeePercent: number | null;
  ownerApprovalThreshold: number | null;
  applicationFee: number | null;
  incomeMultiple: number | null;
  portalHeadline: string;
  portalIntro: string;
  paymentInstructions: string;
  onlinePayments: boolean;
  allowPartialPayments: boolean;
  maintenanceRequests: boolean;
  applicationsOpen: boolean;
  emailSignature: string;
  leaseTemplate: string;
  defaultRole: 'Property Manager' | 'Leasing Agent' | 'Maintenance' | 'Accountant';
}>;

export type SettingsKey = keyof SettingsDraft;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return /\//.test(tz) || tz === 'UTC';
  } catch {
    return false;
  }
}

export function validCurrency(code: string) {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat('en-US', { style: 'currency', currency: code });
    return true;
  } catch {
    return false;
  }
}

/** A readable sentence per field that is wrong. Only the keys present in `d` are checked. */
export function validateSettings(d: SettingsDraft): Partial<Record<SettingsKey, string>> {
  const e: Partial<Record<SettingsKey, string>> = {};
  const has = (k: SettingsKey) => k in d;
  const range = (k: SettingsKey, min: number, max: number, message: string, integer = true) => {
    if (!has(k)) return;
    const v = d[k];
    if (!(integer ? isInt(v) : isNum(v)) || (v as number) < min || (v as number) > max) e[k] = message;
  };

  if (has('organizationName') && !(d.organizationName ?? '').trim()) e.organizationName = 'Enter your company’s name.';
  if (has('organizationName') && (d.organizationName ?? '').length > 120) e.organizationName = 'Keep the name under 120 characters.';
  if (has('legalName') && (d.legalName ?? '').length > 160) e.legalName = 'Keep the legal name under 160 characters.';
  if (has('brandColor') && !/^#[0-9a-f]{6}$/i.test(d.brandColor ?? '')) e.brandColor = 'Use a six-digit hex colour, like #0f766e.';
  if (has('supportEmail') && d.supportEmail && !EMAIL_RE.test(d.supportEmail.trim())) e.supportEmail = 'That doesn’t look like an email address.';
  if (has('websiteUrl') && d.websiteUrl && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(d.websiteUrl.trim())) e.websiteUrl = 'Enter a full web address, like https://example.com.';
  if (has('logoUrl') && d.logoUrl && !/^https?:\/\//i.test(d.logoUrl)) e.logoUrl = 'Upload the logo again.';
  if (has('phone') && (d.phone ?? '').length > 40) e.phone = 'Keep the phone number under 40 characters.';
  if (has('emergencyPhone') && (d.emergencyPhone ?? '').length > 40) e.emergencyPhone = 'Keep the phone number under 40 characters.';
  if (has('officeHours') && (d.officeHours ?? '').length > 120) e.officeHours = 'Keep office hours under 120 characters.';
  if (has('address') && (d.address ?? '').length > 300) e.address = 'Keep the address under 300 characters.';
  if (has('timezone') && !validTimezone(d.timezone ?? '')) e.timezone = 'Choose a timezone from the list.';
  if (has('currency') && !validCurrency(d.currency ?? '')) e.currency = 'Choose a currency from the list.';
  if (has('emailSignature') && (d.emailSignature ?? '').length > 1000) e.emailSignature = 'Keep the signature under 1,000 characters.';

  range('rentDueDay', 1, 28, 'Rent can be due on any day from the 1st to the 28th.');
  range('gracePeriodDays', 0, 28, 'The grace period must be between 0 and 28 days.');
  range('chargeDaysAhead', 0, 28, 'Post charges between 0 and 28 days ahead.');
  range('rentReminderDays', 0, 28, 'Send reminders between 0 and 28 days ahead. Use 0 to turn them off.');
  range('renewalNoticeDays', 0, 365, 'Use a number of days between 0 and 365.');
  range('managementFeePercent', 0, 100, 'The management fee must be between 0 and 100%.', false);
  range('applicationFee', 0, 10_000, 'The application fee must be between $0 and $10,000.', false);
  range('incomeMultiple', 0, 10, 'The income multiple must be between 0 and 10.', false);

  const type = d.lateFeeType;
  if (has('lateFeeType') && type !== 'None' && type !== 'Flat' && type !== 'Percent') e.lateFeeType = 'Choose how late fees are charged.';
  if (type === 'Flat') {
    if (!isNum(d.lateFeeAmount) || d.lateFeeAmount <= 0) e.lateFeeAmount = 'Enter the late fee, or choose None.';
    else if (d.lateFeeAmount > 100_000) e.lateFeeAmount = 'That late fee is too large.';
  } else if (has('lateFeeAmount') && d.lateFeeAmount != null && (!isNum(d.lateFeeAmount) || d.lateFeeAmount < 0)) {
    e.lateFeeAmount = 'Enter an amount of $0 or more.';
  }
  if (type === 'Percent') {
    if (!isNum(d.lateFeePercent) || d.lateFeePercent <= 0 || d.lateFeePercent > 100) e.lateFeePercent = 'The late fee percent must be more than 0 and at most 100.';
  } else if (has('lateFeePercent') && d.lateFeePercent != null && (!isNum(d.lateFeePercent) || d.lateFeePercent < 0 || d.lateFeePercent > 100)) {
    e.lateFeePercent = 'The late fee percent must be between 0 and 100.';
  }
  if (has('lateFeeMax') && d.lateFeeMax != null && (!isNum(d.lateFeeMax) || d.lateFeeMax < 0)) e.lateFeeMax = 'The maximum must be $0 or more. Leave it empty for no cap.';
  if (has('ownerApprovalThreshold') && d.ownerApprovalThreshold != null && (!isNum(d.ownerApprovalThreshold) || d.ownerApprovalThreshold < 0)) {
    e.ownerApprovalThreshold = 'Enter an amount of $0 or more, or leave it empty.';
  }

  if (has('paymentInstructions') && (d.paymentInstructions ?? '').length > 2000) e.paymentInstructions = 'Keep payment instructions under 2,000 characters.';
  if (has('portalHeadline') && (d.portalHeadline ?? '').length > 120) e.portalHeadline = 'Keep the headline under 120 characters.';
  if (has('portalIntro') && (d.portalIntro ?? '').length > 600) e.portalIntro = 'Keep the introduction under 600 characters.';
  if (has('leaseTemplate') && !(d.leaseTemplate ?? '').trim()) e.leaseTemplate = 'The lease template can’t be empty. Reset it to the default instead.';
  if (has('leaseTemplate') && (d.leaseTemplate ?? '').length > 100_000) e.leaseTemplate = 'The lease template is too long.';
  if (has('defaultRole') && !['Property Manager', 'Leasing Agent', 'Maintenance', 'Accountant'].includes(String(d.defaultRole))) e.defaultRole = 'Choose a role.';
  return e;
}

/** The day rent first counts as late, in words: "the 7th", or "6 days after it’s due" when that runs past the 28th. */
export function firstLateDay(dueDay: number, graceDays: number) {
  const day = dueDay + graceDays + 1;
  return day <= 28 ? `the ${ordinal(day)}` : `${graceDays + 1} days after it’s due`;
}

/** Relative luminance contrast of white text on a hex colour (WCAG). */
export function contrastWithWhite(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 21;
  const n = parseInt(m[1], 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  return 1.05 / (l + 0.05);
}
